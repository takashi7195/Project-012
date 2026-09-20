import fs from "node:fs/promises";

const PRODUCTION_PROJECT_REF = "jxjxqfrtvdpvrifktxsf";

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("payload must be an object");
  if (!payload.sourceCode || !payload.rawHash || !payload.fetchedAt) throw new Error("payload requires sourceCode, rawHash and fetchedAt");
  if (!Array.isArray(payload.records) || payload.records.length === 0) throw new Error("payload.records must not be empty");
  const dates = new Set(payload.records.map((record) => record?.race?.raceDate));
  if (dates.size !== 1) throw new Error("payload must contain exactly one race date");
  return { date: [...dates][0] };
}

export async function reparsePayload(payload, {
  supabaseUrl = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  projectRef = process.env.SUPABASE_PROJECT_REF,
  parserVersion = "parser-v0.1.11-reparse",
  rulesVersion = "rules-v0.1.11-reparse",
  fetchImpl = fetch,
} = {}) {
  const { date } = validatePayload(payload);
  if (!supabaseUrl || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (!projectRef) throw new Error("SUPABASE_PROJECT_REF is required");
  if (projectRef === PRODUCTION_PROJECT_REF) throw new Error("refusing to reparse Project-012 production");
  const response = await fetchImpl(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/race_data_ingest_snapshot_with_metadata`, {
    method: "POST",
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      p_source_code: payload.sourceCode,
      p_race_date: date,
      p_body_hash: payload.rawHash,
      p_snapshot: payload,
      p_fetched_at: payload.fetchedAt,
      p_parser_version: parserVersion,
      p_rules_version: rulesVersion,
      p_publish: false,
      p_http_status: null,
      p_elapsed_ms: null,
      p_bytes: null,
      p_etag: null,
      p_last_modified: null,
    }),
  });
  if (!response.ok) {
    const error = new Error(`Supabase reparse RPC failed: HTTP ${response.status}`);
    error.code = "db_write_failed";
    error.httpStatus = response.status;
    error.detail = await response.text();
    throw error;
  }
  return { status: "staged", date, parserVersion, rulesVersion, result: await response.json() };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  const file = process.argv[2];
  const parserVersion = process.argv[3];
  const rulesVersion = process.argv[4];
  if (!file || !parserVersion || !rulesVersion) throw new Error("usage: node race-ingestion/reparse-payload.mjs payload.json parser-version rules-version");
  const payload = JSON.parse(await fs.readFile(file, "utf8"));
  console.log(JSON.stringify(await reparsePayload(payload, { parserVersion, rulesVersion }), null, 2));
}
