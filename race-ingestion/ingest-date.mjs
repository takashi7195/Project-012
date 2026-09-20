import { fetchDailyJson } from "./api-client.mjs";
import { normalizeSnapshot } from "./normalize.mjs";
import { toRpcPayload } from "./records.mjs";

const PRODUCTION_PROJECT_REF = "jxjxqfrtvdpvrifktxsf";

export async function ingestDate(dateText, {
  supabaseUrl = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  projectRef = process.env.SUPABASE_PROJECT_REF,
  fetchImpl = fetch,
  apiFetchImpl = fetchImpl,
} = {}) {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (!projectRef) throw new Error("SUPABASE_PROJECT_REF is required");
  if (projectRef === PRODUCTION_PROJECT_REF) throw new Error("refusing to ingest into Project-012 production");
  const fetched = await fetchDailyJson(dateText, { fetchImpl: apiFetchImpl });
  if (fetched.status === "not_modified") return { status: "not_modified", date: dateText };
  const normalized = normalizeSnapshot(fetched.json, { fetchedAt: fetched.startedAt });
  if (!normalized.accepted) {
    const error = new Error("normalization rejected");
    error.code = "normalization_invalid";
    error.issues = normalized.issues;
    throw error;
  }
  const rpcPayload = toRpcPayload(normalized);
  const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/ingest_snapshot`, {
    method: "POST",
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
    body: JSON.stringify(rpcPayload),
  });
  if (!response.ok) {
    const error = new Error(`Supabase RPC failed: HTTP ${response.status}`);
    error.code = "db_write_failed";
    error.httpStatus = response.status;
    error.detail = await response.text();
    throw error;
  }
  const result = await response.json();
  return { status: "ingested", date: dateText, fetched: { status: fetched.status, bytes: fetched.bytes, elapsedMs: fetched.elapsedMs }, normalized: { raceCount: normalized.raceCount, stadiumCount: normalized.stadiumCount, resultRaceCount: normalized.resultRaceCount }, result };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const dateText = process.argv[2];
  if (!dateText) throw new Error("usage: node race-ingestion/ingest-date.mjs YYYY-MM-DD");
  console.log(JSON.stringify(await ingestDate(dateText), null, 2));
}
