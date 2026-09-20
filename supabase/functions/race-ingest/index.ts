import { runWorker } from "./worker.mjs";

const projectUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const workerToken = Deno.env.get("RACE_INGEST_WORKER_TOKEN");
const sourceCode = "boatraceopenapi-v1";
const sourceBaseUrl = "https://boatraceopenapi.github.io/api/v1";
const maxBodyBytes = 16 * 1024 * 1024;
const fetchTimeoutMs = 30_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function diagnostic(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...details }));
}

function authorized(request: Request) {
  if (!workerToken) return false;
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : request.headers.get("x-race-ingest-token");
  return supplied === workerToken;
}

function jstDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function apiUrl(baseUrl: string, raceDate: string) {
  if (baseUrl.replace(/\/$/, "") !== sourceBaseUrl) throw Object.assign(new Error("unsupported_source"), { code: "unsupported_source" });
  const [year, month, day] = raceDate.split("-");
  return `${sourceBaseUrl}/${year}/${year}${month}${day}.json`;
}

async function restRpc(name: string, body: Record<string, unknown>) {
  if (!projectUrl || !serviceRoleKey) throw Object.assign(new Error("db_config_missing"), { code: "db_write_failed" });
  const response = await fetch(`${projectUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw Object.assign(new Error(`RPC ${name} failed`), { code: "db_write_failed", httpStatus: response.status, detail });
  }
  return await response.json();
}

async function readLimited(response: Response) {
  if (!response.body) throw Object.assign(new Error("empty_body"), { code: "invalid_json" });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw Object.assign(new Error("response body too large"), { code: "payload_too_large" });
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(output);
}

async function fetchDaily(baseUrl: string, raceDate: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  const startedAt = new Date().toISOString();
  try {
    let response: Response;
    try {
      response = await fetch(apiUrl(baseUrl, raceDate), { signal: controller.signal, headers: { accept: "application/json" } });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw Object.assign(new Error("API request timed out"), { code: "fetch_timeout" });
      throw Object.assign(new Error("API request failed"), { code: "fetch_network", detail: String(error) });
    }
    if (response.status === 304) return { status: "not_modified", startedAt };
    if (!response.ok) {
      const code = response.status === 404 ? "fetch_404" : response.status === 429 ? "fetch_429" : response.status >= 500 ? "fetch_5xx" : "fetch_http_error";
      const error = Object.assign(new Error(`API HTTP ${response.status}`), { code, httpStatus: response.status });
      if (response.status === 429) Object.assign(error, { retryAfterSeconds: Number(response.headers.get("retry-after")) });
      throw error;
    }
    const text = await readLimited(response);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error("API returned invalid JSON"), { code: "invalid_json" }); }
    return { status: "fetched", startedAt, json: parsed };
  } finally {
    clearTimeout(timeout);
  }
}

async function enqueueRange(from: string, through: string, reason: string, priority: number) {
  return await restRpc("race_data_enqueue_date_tasks", { p_source_code: sourceCode, p_from: from, p_through: through, p_reason: reason, p_priority: priority });
}

async function main(mode: "today" | "yesterday" | "backfill") {
  const workerId = `edge-${crypto.randomUUID()}`;
  const today = jstDate();
  const yesterday = jstDate(new Date(Date.now() - 86_400_000));
  const rollingStart = shiftDate(today, -29);
  const configuredBackfillFrom = Deno.env.get("RACE_INGEST_BACKFILL_FROM");
  // A stale historical secret must not widen the rolling retention window.
  const backfillFrom = configuredBackfillFrom && configuredBackfillFrom > rollingStart
    ? configuredBackfillFrom
    : rollingStart;
  if (mode === "today") await enqueueRange(today, today, "today", 100);
  if (mode === "yesterday") await enqueueRange(yesterday, yesterday, "yesterday", 50);
  if (mode === "backfill") {
    await restRpc("race_data_disable_tasks_before", { p_cutoff: rollingStart });
    if (backfillFrom <= yesterday) await enqueueRange(backfillFrom, yesterday, "backfill", -10);
    diagnostic("race_ingest_backfill_window", { from: backfillFrom, through: yesterday, rollingStart });
  }

  const result = await runWorker({
    workerId,
    claimTask: async (id) => {
      const rows = await restRpc("race_data_claim_next_task", { p_worker_id: id, p_lease_seconds: 90 });
      const row = Array.isArray(rows) ? rows[0] ?? null : null;
      return row ? {
        taskId: row.task_id,
        sourceCode: row.source_code,
        baseUrl: row.base_url,
        raceDate: row.race_date,
        reason: row.reason,
        priority: row.priority,
        attemptCount: row.attempt_count,
        leaseToken: row.lease_token,
        leaseUntil: row.lease_until,
      } : null;
    },
    fetchDaily: (raceDate: string) => fetchDaily(sourceBaseUrl, raceDate),
    writeSnapshotChunk: async (payload: any, { publish }: { publish: boolean }) => await restRpc("race_data_ingest_snapshot", {
      p_source_code: payload.sourceCode,
      p_race_date: payload.records?.[0]?.race?.raceDate,
      p_body_hash: payload.rawHash,
      p_snapshot: payload,
      p_fetched_at: payload.fetchedAt,
      p_parser_version: payload.parserVersion,
      p_rules_version: payload.rulesVersion,
      p_publish: publish,
    }),
    finishTask: async (task: { taskId: string; leaseToken: string }, state: { state: string; nextAttemptAt: string | null; errorCode: string | null }) => {
      return await restRpc("race_data_finish_task", { p_task_id: task.taskId, p_lease_token: task.leaseToken, p_state: state.state, p_next_attempt_at: state.nextAttemptAt, p_error_code: state.errorCode });
    },
    chunkSize: Number(Deno.env.get("RACE_INGEST_CHUNK_SIZE") ?? "8"),
  });
  diagnostic("race_ingest_worker_complete", { workerId, result: { status: result.status, raceDate: result.raceDate ?? null, chunkCount: result.chunkCount ?? 0, errorCode: result.errorCode ?? null } });
  return result;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  let mode: "today" | "yesterday" | "backfill" = "today";
  try {
    const body = await request.json();
    if (body?.mode === "yesterday" || body?.mode === "backfill") mode = body.mode;
  } catch { /* empty request body uses the safe today mode */ }
  try { return json(await main(mode)); }
  catch (error) {
    const failure = error as any;
    diagnostic("race_ingest_worker_failed", { code: failure?.code ?? "worker_error", detail: failure?.detail ?? null });
    return json({ error: failure?.code ?? "worker_error" }, 500);
  }
});
