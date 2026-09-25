import { moderationDecision, normalizeComment, normalizeNickname } from "./moderation.mjs";
import { chooseReply, generateGroundedReply, templateReply } from "./ai-reply.mjs";
import { createRaceContextClient } from "./race-context.mjs";
import { generateReplyPlan } from "./reply-router.mjs";
import { MAX_SCORING_RACES, scoreRaceForComment } from "./prediction-context.mjs";

const projectUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
// The service role key is already held only by this server function. Reuse it
// as the HMAC key so raw IP addresses never need to be stored or configured as
// a second secret in the dashboard.
const hmacSecret = serviceRoleKey;

const ALLOWED_ORIGINS = new Set([
  "https://takashi7195.github.io",
  "http://127.0.0.1:8012",
  "http://localhost:8012",
]);

const REPLY_LABEL = "AIタカシ";
const PAGE_SIZE = 20;

const headersFor = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

function jsonResponse(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headersFor(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function diagnostic(requestId: string, code: string, details: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ event: "comment_diagnostic", requestId, code, ...details }));
}

function safeCursor(raw: string | null) {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(atob(raw));
    if (
      typeof decoded.created_at !== "string" ||
      Number.isNaN(Date.parse(decoded.created_at)) ||
      typeof decoded.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.id)
    ) return null;
    return { created_at: new Date(decoded.created_at).toISOString(), id: decoded.id };
  } catch {
    return null;
  }
}

function encodeCursor(row: { created_at: string; id: string }) {
  return btoa(JSON.stringify({ created_at: row.created_at, id: row.id }));
}

async function rest(path: string, init: RequestInit = {}) {
  if (!projectUrl || !serviceRoleKey) throw new Error("Server configuration unavailable");
  return await fetch(`${projectUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function rateKey(request: Request) {
  if (!hmacSecret) throw new Error("Rate limit key unavailable");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = request.headers.get("cf-connecting-ip")?.trim() || forwarded || request.headers.get("x-real-ip")?.trim();
  if (!ip) throw new Error("Client address unavailable");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(hmacSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function readBodyWithinLimit(request: Request, maxBytes: number) {
  if (!request.body) throw new Error("Request body unavailable");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RangeError("Request body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function listComments(url: URL, origin: string, restImpl = rest) {
  const cursorText = url.searchParams.get("cursor");
  const cursor = safeCursor(cursorText);
  if (cursorText && !cursor) return jsonResponse({ error: "コメントを読み込めませんでした" }, 400, origin);

  const params = new URLSearchParams({
    select: "id,nickname,body,ai_reply,tip_requested,created_at",
    status: "eq.visible",
    order: "created_at.desc,id.desc",
    limit: String(PAGE_SIZE + 1),
  });
  if (cursor) {
    params.set("or", `(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}))`);
  }

  const response = await restImpl(`comments?${params.toString()}`);
  if (!response.ok) return jsonResponse({ error: "コメントを読み込めませんでした" }, 503, origin);
  const rows = await response.json();
  const hasMore = rows.length > PAGE_SIZE;
  const visibleRows = rows.slice(0, PAGE_SIZE);
  const last = visibleRows.at(-1);
  return jsonResponse({
    comments: visibleRows.map((row: Record<string, unknown>) => ({
      id: row.id,
      nickname: row.nickname || "匿名",
      body: row.body,
      reply: { author: REPLY_LABEL, body: row.ai_reply },
      tipRequested: row.tip_requested === true,
      createdAt: row.created_at,
    })),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  }, 200, origin);
}

async function submitComment(request: Request, origin: string, deps: {
  restImpl?: typeof rest;
  rateKeyImpl?: typeof rateKey;
  fetchImpl?: typeof fetch;
  geminiKey?: string;
  diagnosticImpl?: typeof diagnostic;
} = {}) {
  const restImpl = deps.restImpl ?? rest;
  const rateKeyImpl = deps.rateKeyImpl ?? rateKey;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const geminiKey = deps.geminiKey ?? geminiApiKey;
  const emitDiagnostic = deps.diagnosticImpl ?? diagnostic;
  const requestId = crypto.randomUUID();
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > 8_192) {
    diagnostic(requestId, "input_invalid");
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 413, origin);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBodyWithinLimit(request, 8_192));
  } catch (error) {
    if (error instanceof RangeError) {
      diagnostic(requestId, "input_invalid");
      return jsonResponse({ error: "コメントを投稿できませんでした" }, 413, origin);
    }
    diagnostic(requestId, "input_invalid");
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 400, origin);
  }
  if (!payload || typeof payload !== "object") {
    diagnostic(requestId, "input_invalid");
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 400, origin);
  }

  const bodyValue = (payload as Record<string, unknown>).body;
  const nicknameValue = (payload as Record<string, unknown>).nickname;
  if (typeof bodyValue !== "string" || (nicknameValue != null && typeof nicknameValue !== "string")) {
    diagnostic(requestId, "input_invalid");
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 400, origin);
  }

  const nicknameInput = typeof nicknameValue === "string" ? nicknameValue : "";
  const moderatedText = `${nicknameInput}\n${bodyValue}`;
  if (moderationDecision(moderatedText) === "block") {
    diagnostic(requestId, "moderation_blocked");
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 422, origin);
  }

  const body = normalizeComment(bodyValue);
  if (!body) {
    diagnostic(requestId, "input_invalid");
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 400, origin);
  }
  const nickname = normalizeNickname(nicknameInput);

  let key: string;
  try {
    key = await rateKeyImpl(request);
  } catch {
    diagnostic(requestId, "config_missing");
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);
  }

  const rateResponse = await restImpl("rpc/claim_comment_rate_limit", {
    method: "POST",
    body: JSON.stringify({ p_rate_key: key }),
  });
  if (!rateResponse.ok) {
    diagnostic(requestId, "database_error", { operation: "claim_comment_rate_limit", status: rateResponse.status });
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);
  }
  if (!await rateResponse.json()) {
    diagnostic(requestId, "rate_limited");
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 429, origin);
  }

  let aiDiagnostic = "unknown_error";
  let aiDiagnosticDetails: Record<string, unknown> = {};
  let finalGeminiAttempted = false;
  const plan = await generateReplyPlan(body, geminiKey || "", fetchImpl, {
    onDiagnostic: (code, details) => { aiDiagnostic = code; aiDiagnosticDetails = details ?? {}; },
  });
  let generatedReplies = null;
  if (plan?.action === "direct") {
    generatedReplies = {
      sentiment: plan.sentiment,
      seriousDistressOrFinancialHardship: plan.serious_distress_or_financial_hardship,
      regularReply: plan.regular_reply,
      tipReply: plan.tip_reply,
    };
  } else if (plan?.action === "race_db") {
    const startedAt = Date.now();
    emitDiagnostic(requestId, "race_db_started", { queryCount: plan.queries.length });
    const client = createRaceContextClient({ projectUrl, serviceRoleKey, fetchImpl });
    const search = await client.search(plan.queries);
    if (search.status === "error") {
      emitDiagnostic(requestId, "race_db_failed", { queryCount: plan.queries.length, rpcCallCount: search.rpcCallCount, elapsedMs: Date.now() - startedAt });
    } else {
      emitDiagnostic(requestId, search.status === "no_match" ? "race_db_no_match" : search.status === "truncated" ? "race_db_truncated" : "race_db_succeeded", { queryCount: plan.queries.length, rpcCallCount: search.rpcCallCount, matchedRaceCount: search.context?.races?.length ?? 0, truncated: search.status === "truncated", elapsedMs: Date.now() - startedAt });
      let predictionContext: unknown = { status: "not_requested" };
      if (plan.prediction_requested) {
        const scoringRaces = (search.predictionRaces ?? []).slice(0, MAX_SCORING_RACES);
        const scored = scoringRaces.map((race) => scoreRaceForComment(race));
        if (scored.some((item) => item.error)) {
          emitDiagnostic(requestId, "prediction_context_failed", { raceCount: scoringRaces.length, elapsedMs: Date.now() - startedAt });
          generatedReplies = null;
        } else {
          const available = scored.filter((item) => item.readiness.status === "available");
          const statuses = scored.map((item) => item.prediction);
          predictionContext = statuses.length === 1 ? statuses[0] : { status: available.length ? "available" : statuses[0]?.status ?? "no_match", predictions: statuses, scoringTruncated: (search.predictionRaces ?? []).length > MAX_SCORING_RACES };
          emitDiagnostic(requestId, available.length ? "prediction_context_succeeded" : "prediction_context_not_available", { raceCount: scoringRaces.length, availableCount: available.length, closedCount: statuses.filter((item) => item.status === "closed").length, staleCount: statuses.filter((item) => item.status === "stale").length, elapsedMs: Date.now() - startedAt });
          finalGeminiAttempted = true;
          generatedReplies = await generateGroundedReply(body, plan, search.context, geminiKey || "", fetchImpl, (code, details) => { aiDiagnostic = code; aiDiagnosticDetails = details ?? {}; }, predictionContext);
        }
      } else {
        finalGeminiAttempted = true;
        generatedReplies = await generateGroundedReply(body, plan, search.context, geminiKey || "", fetchImpl, (code, details) => { aiDiagnostic = code; aiDiagnosticDetails = details ?? {}; }, predictionContext);
      }
    }
  } else if (!plan) {
    diagnostic(requestId, aiDiagnostic, aiDiagnosticDetails);
  }
  const selectedReply = generatedReplies ? chooseReply(generatedReplies) : null;
  if (!selectedReply && plan?.action === "race_db" && finalGeminiAttempted) {
    const safeDetails = {
      reason: aiDiagnostic,
      ...(typeof aiDiagnosticDetails?.status === "number" ? { status: aiDiagnosticDetails.status } : {}),
      ...(typeof aiDiagnosticDetails?.stage === "string" ? { stage: aiDiagnosticDetails.stage } : {}),
    };
    emitDiagnostic(requestId, "final_reply_failed", safeDetails);
  } else if (!selectedReply && (!plan || plan?.action === "fallback")) {
    emitDiagnostic(requestId, "drunk_fallback_used", { reason: aiDiagnostic });
  } else if (plan?.action === "direct" && !selectedReply) {
    emitDiagnostic(requestId, "direct_reply_unavailable", { reason: "regular_reply_missing" });
  }
  const replySource = selectedReply ? "gemini" : "template";
  const replyText = selectedReply?.reply ?? templateReply();
  const tipRequested = selectedReply?.tipRequested ?? false;
  const createResponse = await restImpl("rpc/create_comment_with_reply", {
    method: "POST",
    body: JSON.stringify({
      p_nickname: nickname,
      p_body: body,
      p_ai_reply: replyText,
      p_reply_source: replySource,
      p_tip_requested: tipRequested,
    }),
  });
  if (!createResponse.ok) {
    diagnostic(requestId, "database_error", { operation: "create_comment_with_reply", status: createResponse.status });
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);
  }
  const [created] = await createResponse.json();
  if (!created) {
    diagnostic(requestId, "database_error", { operation: "create_comment_with_reply", status: "empty" });
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);
  }

  return jsonResponse({
    comment: {
      id: created.id,
      nickname: created.nickname || "匿名",
      body: created.body,
      reply: { author: REPLY_LABEL, body: created.ai_reply },
      tipRequested: created.tip_requested === true,
      createdAt: created.created_at,
    },
  }, 201, origin);
}

export function createCommentsHandler(deps: {
  restImpl?: typeof rest;
  rateKeyImpl?: typeof rateKey;
  fetchImpl?: typeof fetch;
  geminiKey?: string;
  configured?: boolean;
  diagnosticImpl?: typeof diagnostic;
} = {}) {
  const configured = deps.configured ?? Boolean(projectUrl && serviceRoleKey && hmacSecret);
  const restImpl = deps.restImpl ?? rest;
  return async (request: Request) => {
    const origin = request.headers.get("origin") || "";
    if (!ALLOWED_ORIGINS.has(origin)) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(origin) });
    if (!configured) {
      console.warn(JSON.stringify({ event: "comment_diagnostic", code: "config_missing" }));
      return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);
    }
    try {
      const url = new URL(request.url);
      if (request.method === "GET") return await listComments(url, origin, restImpl);
      if (request.method === "POST") return await submitComment(request, origin, deps);
      return jsonResponse({ error: "コメントを投稿できませんでした" }, 405, origin);
    } catch {
      console.warn(JSON.stringify({ event: "comment_diagnostic", code: "unknown_error" }));
      return jsonResponse({ error: "コメントを投稿できませんでした" }, 500, origin);
    }
  };
}

if (Deno.env.get("DENO_TESTING") !== "1") Deno.serve(createCommentsHandler());
