// Sends a synthetic, already-closed race through the real local Edge + DB RPC.
// It verifies input parsing without creating an AI job or calling Gemini.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(root, "tools/supabase-cli/supabase.exe");
const container = "supabase_db_project-012";
const endpoint = "http://127.0.0.1:54321/functions/v1/predictions";
const localEnvPath = resolve(root, "supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env");
const localEnv = readFileSync(localEnvPath, "utf8");
const localEnvValue = (name) => localEnv.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
const publicKey = localEnvValue("SUPABASE_INTERNAL_PUBLISHABLE_KEY") || localEnvValue("SUPABASE_ANON_KEY");
if (!publicKey) throw new Error("local public key unavailable; values are never printed");

const tempDir = resolve(root, ".ai-edge-input-fixture");
mkdirSync(tempDir, { recursive: true });
const envFile = resolve(tempDir, "predictions.env");
writeFileSync(envFile, `SUPABASE_PUBLISHABLE_KEYS='${JSON.stringify({ default: publicKey })}'\nSUPABASE_PUBLISHABLE_KEY=${publicKey}\nPREDICTION_MODE=ai_bundle\n`, "utf8");
const cliEnvFile = process.platform === "linux" ? execFileSync("wslpath", ["-w", envFile], { encoding: "utf8" }).trim() : envFile;
const server = spawn(cli, ["functions", "serve", "predictions", "--no-verify-jwt", "--env-file", cliEnvFile], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env },
});
let serverError = null;
const serverOutput = [];
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => serverOutput.push(chunk));
}
server.on("error", (error) => { serverError = error; });

function psql(path) {
  const sql = readFileSync(new URL(path, import.meta.url), "utf8");
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`local fixture operation failed; database output withheld`);
}
function countJobs() {
  const result = spawnSync("docker", ["exec", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c",
    "select count(*) from race_prediction.ai_generation_jobs where race_id='a1900000-0000-4000-8000-000000000012'"] , { encoding: "utf8" });
  if (result.error || result.status !== 0 || !/^\d+\s*$/.test(result.stdout)) throw new Error("could not verify fixture job count");
  return Number(result.stdout.trim());
}
async function waitForFunction() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverError || server.exitCode !== null) throw new Error("local Edge function failed during startup; diagnostics withheld");
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 401) return;
    } catch { /* wait for the runtime */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  throw new Error(`local Edge function did not start; diagnostics withheld (${serverOutput.length} chunks)`);
}

let seeded = false;
try {
  psql("./seed-ai-input-fixture.sql");
  seeded = true;
  await waitForFunction();
  const raceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: publicKey, "content-type": "application/json" },
    body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", raceDate, stadiumCode: 24, raceNumber: 12 }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "closed");
  assert.equal(body.mode, "ai_bundle");
  assert.equal(countJobs(), 0, "closed input must be rejected before claim/job creation");
  console.log("PASS: real local Edge fetched and validated a synthetic six-entry input; closed race stopped before claim");
  console.log("INFO: no AI generation job, Gemini request, hosted project access, or deployment");
} finally {
  server.kill("SIGINT");
  await Promise.race([new Promise((resolvePromise) => server.once("exit", resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  if (seeded) psql("./cleanup-ai-input-fixture.sql");
  rmSync(tempDir, { recursive: true, force: true });
}
