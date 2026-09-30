// Local-only Edge Runtime check for the v0.1.19 legacy mode boundary.
// Requests are rejected before any database RPC or provider request.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("run this local Edge smoke with the Windows bundled Node.js");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = resolve(root, "tools/supabase-cli/supabase.exe");
const localEnv = resolve(root, "supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env");
const endpoint = "http://127.0.0.1:54321/functions/v1/predictions";
const envDir = mkdtempSync(resolve(root, ".ai-legacy-mode-smoke-"));
const envFile = resolve(envDir, "predictions.env");
const localVars = readFileSync(localEnv, "utf8");
const publicClientKey = localVars.match(/^SUPABASE_INTERNAL_PUBLISHABLE_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "")
  || localVars.match(/^SUPABASE_ANON_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "")
  || "";
if (!publicClientKey) { rmSync(envDir, { recursive: true, force: true }); throw new Error("local public client key unavailable; value withheld"); }

writeFileSync(envFile, "PREDICTION_MODE=legacy\n", { mode: 0o600 });
const server = spawn(cli, ["functions", "serve", "predictions", "--no-verify-jwt", "--env-file", envFile], {
  cwd: root, stdio: ["ignore", "ignore", "ignore"], windowsHide: true,
});
let spawnError = null;
server.on("error", (error) => { spawnError = error; });

async function waitForLegacyHandler() {
  const deadline = Date.now() + 30_000;
  let lastStatus = "no_response";
  while (Date.now() < deadline) {
    if (spawnError || server.exitCode !== null) throw new Error("local predictions Edge runner exited during startup; output withheld");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { apikey: publicClientKey, "content-type": "application/json" },
        body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", raceDate: "2099-12-31", stadiumCode: 99, raceNumber: 1 }),
        signal: AbortSignal.timeout(1_000),
      });
      lastStatus = response.status;
      const body = await response.json().catch(() => null);
      if (response.status === 409 && body?.mode === "legacy") return;
    } catch { lastStatus = "connection_error"; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  throw new Error(`legacy handler readiness timed out; last status=${lastStatus}; output withheld`);
}

try {
  await waitForLegacyHandler();

  const options = await fetch(endpoint, { method: "OPTIONS" });
  assert.equal(options.status, 200, "local Function should accept OPTIONS");

  const unauthorized = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unauthorized.status, 401, "public-client key must be required");

  const aiBundlePost = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: publicClientKey, "content-type": "application/json" },
    body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", raceDate: "2099-12-31", stadiumCode: 99, raceNumber: 1 }),
  });
  const aiBundleBody = await aiBundlePost.json();
  assert.equal(aiBundlePost.status, 409);
  assert.equal(aiBundleBody.mode, "legacy");
  assert.equal(aiBundleBody.retryable, false);

  const oldContractInvalid = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: publicClientKey, "content-type": "application/json" },
    body: JSON.stringify({ raceDate: "invalid-date", stadiumCode: 0, raceNumber: 0 }),
  });
  const oldContractBody = await oldContractInvalid.json();
  assert.equal(oldContractInvalid.status, 400);
  assert.equal(oldContractBody.error, "invalid_race_selector");

  console.log("PASS: real local EdgeRuntime served PREDICTION_MODE=legacy; AI-bundle POST rejected and malformed legacy selector stopped before DB/provider");
  console.log("PASS: local OPTIONS and public-key rejection");
  console.log("INFO: only local EdgeRuntime; no DB RPC, Gemini request, hosted project, deployment or persistent config change");
} finally {
  if (server.exitCode === null && server.pid) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 10_000 });
  }
  rmSync(envDir, { recursive: true, force: true });
}
