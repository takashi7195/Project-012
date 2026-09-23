// Local-only integration harness. It talks only to Docker's local Supabase.
// It never uses the linked hosted project and always removes its fixture.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(root, "tools/supabase-cli/supabase.exe");
const docker = process.platform === "win32" ? "docker.exe" : "docker";
const dbContainer = "supabase_db_project-012";
const endpoint = "http://127.0.0.1:54321/functions/v1/predictions";
const seedFile = resolve(root, "tools/local-integration/seed-prediction-fixture.sql");
const cleanupFile = resolve(root, "tools/local-integration/cleanup-prediction-fixture.sql");
const publicClientKey = process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
if (!publicClientKey) throw new Error("Set LOCAL_SUPABASE_PUBLISHABLE_KEY to the local publishable key before running this harness");
const narrativeRetryToken = "local-narrative-retry-test";
const envDir = mkdtempSync(resolve(tmpdir(), "project-012-predictions-"));
const envFile = resolve(envDir, "supabase-functions.env");
writeFileSync(envFile, `SUPABASE_PUBLISHABLE_KEYS='${JSON.stringify({ default: publicClientKey })}'\nNARRATIVE_RETRY_TOKEN=${narrativeRetryToken}\n`, "utf8");

function runPsql(input, label) {
  const result = spawnSync(docker, ["exec", "-i", dbContainer, "psql", "-v", "ON_ERROR_STOP=1", "-At", "-U", "postgres", "-d", "postgres"], {
    cwd: root, input, encoding: "utf8", windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function query(sql) {
  return runPsql(sql, "query").split(/\r?\n/).filter(Boolean).at(-1) ?? "";
}

function queryJson(sql) {
  const value = query(sql);
  return value ? JSON.parse(value) : [];
}

async function waitForFunction(process) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Edge Function exited with ${process.exitCode}`);
    try {
      const response = await fetch(endpoint, { method: "GET" });
      if (response.status === 405 || response.status < 500) return;
    } catch { /* runtime is still starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("local Edge Function did not start within 20 seconds");
}

async function post() {
  const response = await fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json", apikey: publicClientKey },
    body: JSON.stringify({ raceDate: "2099-12-31", stadiumCode: 99, raceNumber: 1 }),
  });
  return { status: response.status, body: await response.json() };
}

const server = spawn(cli, ["functions", "serve", "predictions", "--no-verify-jwt", "--env-file", envFile], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  env: { ...process.env },
});
const functionStdout = [];
const functionStderr = [];
server.stdout.on("data", (chunk) => functionStdout.push(String(chunk)));
server.stderr.on("data", (chunk) => functionStderr.push(String(chunk)));
function capturedOutput(chunks) {
  const text = chunks.join("");
  return text.length > 20000 ? `${text.slice(-20000)}\n[truncated]` : text;
}
let seeded = false;
try {
  await waitForFunction(server);
  runPsql(readFileSync(seedFile), "seed");
  seeded = true;
  const concurrent = await Promise.all([post(), post()]);
  if (concurrent.some((item) => item.status >= 500)) {
    throw new Error(`concurrent prediction request returned server error: ${JSON.stringify(concurrent)}`);
  }
  if (!concurrent.every((item) => item.status === 200 || item.status === 202)) {
    throw new Error(`concurrent prediction request returned unexpected status: ${JSON.stringify(concurrent)}`);
  }
  const snapshotCount = query("select count(*) from race_prediction.prediction_snapshots where payload->'race'->>'raceDate'='2099-12-31' and payload->'race'->>'stadiumCode'='99' and payload->'race'->>'raceNumber'='1';");
  const attemptCount = query("select count(*) from race_prediction.narrative_attempts a join race_prediction.prediction_snapshots p on p.id=a.prediction_id where p.payload->'race'->>'raceDate'='2099-12-31' and p.payload->'race'->>'stadiumCode'='99' and p.payload->'race'->>'raceNumber'='1';");
  if (snapshotCount !== "1") throw new Error(`expected one snapshot, got ${snapshotCount}`);
  if (attemptCount !== "1") throw new Error(`expected one narrative attempt, got ${attemptCount}`);
  const successful = concurrent.find((item) => item.body?.snapshotId);
  if (!successful) throw new Error(`no concurrent response returned a snapshot: ${JSON.stringify(concurrent)}`);
  const retryResponse = await (async () => {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", apikey: publicClientKey, "x-narrative-retry-token": narrativeRetryToken }, body: JSON.stringify({ action: "narrative-retry", predictionId: successful.body.snapshotId }) });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    const result = { status: response.status, predictionId: successful.body.snapshotId, retryTokenConfigured: Boolean(narrativeRetryToken), body };
    console.log(JSON.stringify({ retryDiagnostics: result }, null, 2));
    if (!response.ok) throw new Error(`narrative-retry HTTP ${response.status}: ${text}`);
    return result;
  })();
  const retryAttemptCount = query("select count(*) from race_prediction.narrative_attempts a join race_prediction.prediction_snapshots p on p.id=a.prediction_id where p.payload->'race'->>'raceDate'='2099-12-31' and p.payload->'race'->>'stadiumCode'='99' and p.payload->'race'->>'raceNumber'='1';");
  const retryAttempts = queryJson("select coalesce(json_agg(json_build_object('id',a.id,'prediction_id',a.prediction_id,'attempt_sequence',a.attempt_sequence,'status',a.status,'error_code',a.error_code,'created_at',a.created_at) order by a.attempt_sequence), '[]'::json) from race_prediction.narrative_attempts a join race_prediction.prediction_snapshots p on p.id=a.prediction_id where p.payload->'race'->>'raceDate'='2099-12-31' and p.payload->'race'->>'stadiumCode'='99' and p.payload->'race'->>'raceNumber'='1';");
  const remainingLeases = queryJson("select coalesce(json_agg(json_build_object('reuse_key',reuse_key,'lease_until',lease_until,'created_at',created_at) order by created_at), '[]'::json) from race_prediction.prediction_generation_leases;");
  console.log(JSON.stringify({ retryDatabaseDiagnostics: { narrativeAttempts: retryAttempts, narrativeAttemptCount: Number(retryAttemptCount), generationLeases: remainingLeases } }, null, 2));
  if (retryAttemptCount !== "2") throw new Error(`expected two narrative attempts after retry, got ${retryAttemptCount}`);
  console.log(JSON.stringify({ concurrent, snapshotCount: Number(snapshotCount), attemptCount: Number(attemptCount), retryResponse, retryAttemptCount: Number(retryAttemptCount) }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ integrationFailure: String(error?.message ?? error), functionStdout: capturedOutput(functionStdout), functionStderr: capturedOutput(functionStderr) }, null, 2));
  throw error;
} finally {
  if (seeded) {
    try { runPsql(readFileSync(cleanupFile), "cleanup"); } catch (error) { console.error(String(error)); }
  }
  server.kill("SIGINT");
  rmSync(envDir, { recursive: true, force: true });
}
