import { moderationDecision, normalizeComment, normalizeNickname } from "./moderation.mjs";

const projectUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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

async function listComments(url: URL, origin: string) {
  const cursorText = url.searchParams.get("cursor");
  const cursor = safeCursor(cursorText);
  if (cursorText && !cursor) return jsonResponse({ error: "コメントを読み込めませんでした" }, 400, origin);

  const params = new URLSearchParams({
    select: "id,nickname,body,ai_reply,created_at",
    status: "eq.visible",
    order: "created_at.desc,id.desc",
    limit: String(PAGE_SIZE + 1),
  });
  if (cursor) {
    params.set("or", `(created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}))`);
  }

  const response = await rest(`comments?${params.toString()}`);
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
      createdAt: row.created_at,
    })),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  }, 200, origin);
}

async function submitComment(request: Request, origin: string) {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > 8_192) return jsonResponse({ error: "コメントを投稿できませんでした" }, 413, origin);

  let payload: unknown;
  try {
    payload = JSON.parse(await readBodyWithinLimit(request, 8_192));
  } catch (error) {
    if (error instanceof RangeError) return jsonResponse({ error: "コメントを投稿できませんでした" }, 413, origin);
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 400, origin);
  }
  if (!payload || typeof payload !== "object") return jsonResponse({ error: "コメントを投稿できませんでした" }, 400, origin);

  const bodyValue = (payload as Record<string, unknown>).body;
  const nicknameValue = (payload as Record<string, unknown>).nickname;
  if (typeof bodyValue !== "string" || (nicknameValue != null && typeof nicknameValue !== "string")) {
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 400, origin);
  }

  const nicknameInput = typeof nicknameValue === "string" ? nicknameValue : "";
  const moderatedText = `${nicknameInput}\n${bodyValue}`;
  if (moderationDecision(moderatedText) === "block") {
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 422, origin);
  }

  const body = normalizeComment(bodyValue);
  if (!body) return jsonResponse({ error: "コメントを投稿できませんでした" }, 400, origin);
  const nickname = normalizeNickname(nicknameInput);

  let key: string;
  try {
    key = await rateKey(request);
  } catch {
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);
  }

  const rateResponse = await rest("rpc/claim_comment_rate_limit", {
    method: "POST",
    body: JSON.stringify({ p_rate_key: key }),
  });
  if (!rateResponse.ok) return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);
  if (!await rateResponse.json()) return jsonResponse({ error: "コメントを投稿できませんでした" }, 429, origin);

  const createResponse = await rest("rpc/create_comment", {
    method: "POST",
    body: JSON.stringify({ p_nickname: nickname, p_body: body }),
  });
  if (!createResponse.ok) return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);
  const [created] = await createResponse.json();
  if (!created) return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);

  return jsonResponse({
    comment: {
      id: created.id,
      nickname: created.nickname || "匿名",
      body: created.body,
      reply: { author: REPLY_LABEL, body: created.ai_reply },
      createdAt: created.created_at,
    },
  }, 201, origin);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(origin) });
  if (!projectUrl || !serviceRoleKey || !hmacSecret) return jsonResponse({ error: "コメントを投稿できませんでした" }, 503, origin);

  try {
    const url = new URL(request.url);
    if (request.method === "GET") return await listComments(url, origin);
    if (request.method === "POST") return await submitComment(request, origin);
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 405, origin);
  } catch {
    return jsonResponse({ error: "コメントを投稿できませんでした" }, 500, origin);
  }
});
