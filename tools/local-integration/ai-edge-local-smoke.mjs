// Starts the local predictions Edge Function and exercises its HTTP boundary.
// No database RPC, Gemini request, deployment, or persistent change is made.
import { extractDiagnostic } from "./ai-diagnostics-summary.mjs";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(root, "tools/supabase-cli/supabase.exe");
const localEnv = resolve(root, "supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env");
const endpoint = "http://127.0.0.1:54321/functions/v1/predictions";
const localVars = readFileSync(localEnv, "utf8");
function localEnvValue(name) {
  return localVars.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
}
// Current local Supabase exposes a publishable API key separately from the
// legacy anon JWT. Prefer the publishable key used by the local API gateway.
// Supabase CLI reserves SUPABASE_* names in --env-file and skips custom values
// with that prefix. Use the standard local publishable key injected by the CLI.
const publicClientKey = localEnvValue("SUPABASE_INTERNAL_PUBLISHABLE_KEY") || localEnvValue("SUPABASE_ANON_KEY");
if (!publicClientKey) throw new Error("Local Supabase anon key was not found; no key values are printed by this script");

// The bundled CLI is a Windows executable. Keep its env file on the shared
// Windows drive and pass a Windows path, rather than an inaccessible WSL /tmp path.
const envDir = mkdtempSync(resolve(root, ".ai-edge-smoke-"));
const envFile = resolve(envDir, "predictions.env");
writeFileSync(envFile, "PREDICTION_MODE=ai_bundle\n", "utf8");
const cliEnvFile = process.platform === "linux" ? execFileSync("wslpath", ["-w", envFile], { encoding: "utf8" }).trim() : envFile;
const server = spawn(cli, ["functions", "serve", "predictions", "--no-verify-jwt", "--env-file", cliEnvFile], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env },
});
const serverOutput = [];
const logSince = new Date(Date.now() - 1000).toISOString();
let spawnError = null;
for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => serverOutput.push(chunk));
}
server.on("error", (error) => { spawnError = error; });

function safeStartupDiagnostics() {
  return serverOutput.join("").slice(-4_000)
    .replaceAll(publicClientKey, "[REDACTED_PUBLIC_KEY]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_TOKEN]")
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEYS|GEMINI_API_KEY)(\s*[:=]\s*)[^\s'"`]+/gi, "$1$2[REDACTED]");
}

async function waitForFunction() {
  const deadline = Date.now() + 30_000;
  let lastStatus = "no_response";
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Could not start the local Supabase CLI: ${spawnError.message}`);
    if (server.exitCode !== null) throw new Error(`Local predictions function stopped during startup (exit ${server.exitCode}).\n${safeStartupDiagnostics()}`);
    try {
      // A pre-existing local Function can already answer the old generic GET
      // readiness check while `functions serve` is still starting. Probe the
      // configured AI contract with an intentionally invalid selector, which
      // must be rejected before any database or model request. 409 means the
      // responding handler is still in legacy mode, so keep waiting.
      const response = await fetch(endpoint, { method: "POST", headers: { apikey: publicClientKey, "content-type": "application/json" },
        body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", raceDate: "2099-12-31", stadiumCode: 99, raceNumber: 1 }),
        signal: AbortSignal.timeout(1_000) });
      lastStatus = response.status === 409 ? "409 (legacy mode)" : String(response.status);
      await response.body?.cancel();
      if (response.status === 400) return;
    } catch (error) { lastStatus = error?.cause?.code ?? error?.name ?? "network_error"; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  throw new Error(`Local AI-bundle predictions function did not become ready within 30 seconds; last readiness result=${lastStatus}.\n${safeStartupDiagnostics() || "No startup output captured."}`);
}

async function main() {
  await waitForFunction();
  const options = await fetch(endpoint, { method: "OPTIONS" });
  assert.equal(options.status, 200, "OPTIONS should be accepted before public-client auth");

  const unauthorized = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unauthorized.status, 401, "requests without the public key should be rejected");

  const invalidSelector = await fetch(endpoint, { method: "POST", headers: { apikey: publicClientKey, "content-type": "application/json" },
    body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", raceDate: "2099-12-31", stadiumCode: 99, raceNumber: 1 }) });
  assert.equal(invalidSelector.status, 400, `out-of-range selector should return 400 before DB/model; got ${invalidSelector.status}: ${(await invalidSelector.text()).slice(0, 300)}`);

  const malformedJob = await fetch(`${endpoint}?action=prediction-job&jobId=invalid`, { headers: { apikey: publicClientKey } });
  assert.equal(malformedJob.status, 400, `malformed job ID should return 400 before DB; got ${malformedJob.status}: ${(await malformedJob.text()).slice(0, 300)}`);

  const ids = [unauthorized, invalidSelector, malformedJob].map(response => response.headers.get("x-request-id"));
  assert.ok(ids.every(id => /^[0-9a-f-]{36}$/i.test(id ?? "")), "AI responses must carry server request IDs");
  assert.equal(new Set(ids).size, 3, "each request must get its own ID");
  assert.equal(invalidSelector.headers.get("access-control-expose-headers"), "X-Request-ID");
  let records = [];
  for (let index = 0; index < 10; index++) {
    // Capture raw Docker output only in memory; never forward runtime exception text.
    const collected = spawnSync("docker", ["logs", "--since", logSince, "supabase_edge_runtime_project-012"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 * 1024 * 1024 });
    assert.equal(collected.status, 0, "Docker log collection failed (raw output withheld)");
    const raw = (collected.stdout ?? "") + "\n" + (collected.stderr ?? "");
    records = raw.split("\n").map(line => extractDiagnostic(line)).filter(record => record && ids.includes(record.requestId));
    if (ids.every(id => records.some(record => record.requestId === id && record.event === "request.finished"))) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200));
  }
  for (const [index, id] of ids.entries()) {
    assert.ok(records.some(record => record.requestId === id && record.event === "request.started"), "start log missing");
    assert.ok(records.some(record => record.requestId === id && record.event === "request.finished" && record.httpStatus === [401,400,400][index]), "finish log missing");
  }
  const evidenceDir = resolve(root, "tools/audit-v019/diagnostics-20260927");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(resolve(evidenceDir, "local-edge.ndjson"), records.map(record => JSON.stringify(record)).join("\n") + "\n");
  console.log("PASS: local Edge request-ID headers, CORS exposure and sanitized runtime log correlation");
  console.log("PASS: local Supabase Edge HTTP route, CORS, public-key rejection, selector validation, and job-ID validation");
  console.log("INFO: no DB RPC or Gemini API request was made; no database or deployment state was changed");
}

try {
  await main();
} finally {
  server.kill("SIGINT");
  await Promise.race([new Promise((resolvePromise) => server.once("exit", resolvePromise)), new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))]);
  rmSync(envDir, { recursive: true, force: true });
}
