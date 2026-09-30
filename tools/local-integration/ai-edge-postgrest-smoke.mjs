// Local-only integration: apply the one pending v0.1.19 migration (if and only
// if it is the sole pending migration), then exercise its read RPCs through the
// real local Edge Function and PostgREST. No Gemini key or race data is needed.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(root, "tools/supabase-cli/supabase.exe");
const container = "supabase_db_project-012";
const targetMigration = "20260927000000";
const localEnvPath = resolve(root, "supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env");
const localBaseUrl = new URL(process.env.AI_LOCAL_SUPABASE_URL || "http://127.0.0.1:54321");
const localIpv4 = localBaseUrl.hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
const privateIpv4 = localIpv4 && localIpv4.every((octet) => octet >= 0 && octet <= 255) &&
  (localIpv4[0] === 10 || (localIpv4[0] === 172 && localIpv4[1] >= 16 && localIpv4[1] <= 31) ||
   (localIpv4[0] === 192 && localIpv4[1] === 168));
if (localBaseUrl.protocol !== "http:" || localBaseUrl.port !== "54321" || localBaseUrl.username || localBaseUrl.password ||
    localBaseUrl.pathname !== "/" || !(["localhost", "127.0.0.1"].includes(localBaseUrl.hostname) || privateIpv4)) {
  throw new Error("AI_LOCAL_SUPABASE_URL must be localhost or an RFC1918 IPv4 on port 54321; hosted targets are refused");
}
const endpoint = new URL("/functions/v1/predictions", localBaseUrl).href;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${(result.stderr || result.stdout || "").slice(-2000)}`);
  return result.stdout.trim();
}

function dbQuery(sql) {
  return run("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", sql]);
}

function localEnvValue(text, name) {
  return text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}

const localEnv = readFileSync(localEnvPath, "utf8");
const publicKey = localEnvValue(localEnv, "SUPABASE_INTERNAL_PUBLISHABLE_KEY") || localEnvValue(localEnv, "SUPABASE_ANON_KEY");
if (!publicKey) throw new Error("Local Supabase publishable key is unavailable; key values are never printed");

const applied = new Set(dbQuery("select version from supabase_migrations.schema_migrations order by version").split(/\r?\n/).filter(Boolean));
const localMigrations = readdirSync(resolve(root, "supabase/migrations"))
  .map((name) => name.match(/^(\d{14})_.*\.sql$/)?.[1]).filter(Boolean);
const pending = [...new Set(localMigrations)].filter((version) => !applied.has(version)).sort();
if (pending.some((version) => version !== targetMigration)) {
  throw new Error(`Refusing to apply migrations: pending local versions are ${pending.join(", ") || "none"}; expected only ${targetMigration}`);
}

if (pending.includes(targetMigration)) {
  // This is explicitly local; it never uses the linked hosted project.
  run(cli, ["migration", "up", "--local"]);
}
if (!dbQuery(`select version from supabase_migrations.schema_migrations where version='${targetMigration}'`).split(/\r?\n/).includes(targetMigration)) {
  throw new Error("The target migration is not recorded in the local database after migration up");
}

const envDir = mkdtempSync(resolve(root, ".ai-postgrest-smoke-"));
const envFile = resolve(envDir, "predictions.env");
writeFileSync(envFile, `SUPABASE_PUBLISHABLE_KEYS='${JSON.stringify({ default: publicKey })}'\nSUPABASE_PUBLISHABLE_KEY=${publicKey}\nPREDICTION_MODE=ai_bundle\n`, "utf8");
const cliEnvFile = process.platform === "linux" ? execFileSync("wslpath", ["-w", envFile], { encoding: "utf8" }).trim() : envFile;
const server = spawn(cli, ["functions", "serve", "predictions", "--no-verify-jwt", "--env-file", cliEnvFile], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env },
});
let spawnError = null;
const output = [];
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => output.push(chunk));
}
server.on("error", (error) => { spawnError = error; });

function startupLog() {
  return output.join("").slice(-3_000).replaceAll(publicKey, "[REDACTED_PUBLIC_KEY]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]");
}

async function waitForFunction() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Could not start local Supabase CLI: ${spawnError.message}`);
    if (server.exitCode !== null) throw new Error(`Local predictions function exited ${server.exitCode}.\n${startupLog()}`);
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 401) return;
    } catch { /* function runtime is still starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  throw new Error(`Local predictions function did not start within 30 seconds.\n${startupLog()}`);
}

try {
  await waitForFunction();
  const headers = { apikey: publicKey, "content-type": "application/json" };

  // A date outside the race-data fixture must return 404 after get_ai_input RPC
  // executes successfully and returns null. No job claim or provider call follows.
  const missingRace = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({
    action: "generate", contractVersion: "ai-bundle-v1", raceDate: "2099-12-31", stadiumCode: 1, raceNumber: 1,
  }) });
  const missingRaceText = await missingRace.text();
  let missingRaceBody;
  try { missingRaceBody = JSON.parse(missingRaceText); } catch { missingRaceBody = missingRaceText; }
  const safeRaceBody = (typeof missingRaceBody === "string" ? missingRaceBody : JSON.stringify(missingRaceBody))
    .replaceAll(publicKey, "[REDACTED_PUBLIC_KEY]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    .slice(0, 1_000);
  assert.equal(missingRace.status, 404,
    `get_ai_input RPC path should return 404 for no fixture; got ${missingRace.status}; content-type=${missingRace.headers.get("content-type")}; response=${safeRaceBody}`);
  assert.equal(missingRaceBody.retryable, false);

  // Validly shaped, absent UUID proves the read_job RPC exists and returns null.
  const missingJob = await fetch(`${endpoint}?action=prediction-job&jobId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, { headers });
  assert.equal(missingJob.status, 404, `read_ai_job RPC path should return 404 for an absent job; got ${missingJob.status}`);

  console.log(`PASS: latest local migration ${targetMigration} applied/verified and both input/read RPCs reached through the real local Edge Function + PostgREST`);
  console.log("INFO: no race fixture was added, no generation job was created, no Gemini request was made, and no hosted project was used");
} finally {
  server.kill("SIGINT");
  await Promise.race([new Promise((resolvePromise) => server.once("exit", resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  rmSync(envDir, { recursive: true, force: true });
}
