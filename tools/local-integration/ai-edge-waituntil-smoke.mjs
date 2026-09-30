// Measures whether the local per_worker Edge Runtime continues a waitUntil
// task for 90 seconds after the HTTP response. Creates and removes one local
// test-only function. It does not access race data, Gemini, or hosted Supabase.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { waitForLocalFunction } from "./ai-edge-readiness.mjs";
import { startCallbackReceiver } from "./ai-edge-callback.mjs";
import { performance } from "node:perf_hooks";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cli = resolve(root, "tools/supabase-cli/supabase.exe");
const functionDir = resolve(root, "supabase/functions/ai-waituntil-smoke");
const endpoint = "http://127.0.0.1:54321/functions/v1/ai-waituntil-smoke";
const runtimeContainer = "supabase_edge_runtime_project-012";
const durationMs = 90_000;
const marker = randomUUID();
let server;
let serverError = null;
let serverOutput = [];
let receiver;

function collectLogs(since) {
  const result = spawnSync("docker", ["logs", "--since", since, runtimeContainer], { encoding: "utf8", timeout: 5_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("could not collect local Edge logs; raw output withheld");
  return (result.stdout ?? "") + "\n" + (result.stderr ?? "");
}
function sanitizeDiagnostic(value) {
  return value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[redacted-api-key]")
    .replace(/(authorization|apikey|api_key|service_role|anon_key|secret)([\s"']*[:=][\s"']*)[^\s,}"']+/gi, "$1$2[redacted]")
    .slice(0, 240);
}
function readinessDiagnostics(logSince) {
  let containerState = "unavailable";
  const inspected = spawnSync("docker", ["inspect", "--format", "{{.State.Status}}|{{.State.Running}}|{{.State.ExitCode}}", runtimeContainer], { encoding: "utf8", timeout: 5_000 });
  if (!inspected.error && inspected.status === 0) containerState = sanitizeDiagnostic(inspected.stdout.trim());

  const candidates = [...serverOutput.join("").split(/\r?\n/), ...(() => {
    try { return collectLogs(logSince).split(/\r?\n/); } catch { return []; }
  })()];
  const relevant = candidates
    .filter((line) => /error|fatal|fail|exception|worker|function|route|listen|serve|start|waituntil_smoke/i.test(line))
    .map(sanitizeDiagnostic)
    .filter(Boolean)
    .slice(-8);
  return `edgeContainer=${containerState}; startupLines=${relevant.length ? relevant.join(" || ") : "no matching diagnostics"}`;
}
async function waitUntilReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverError || server.exitCode !== null) throw new Error("local Supabase function runner exited during startup; diagnostics withheld");
    try {
      const response = await fetch("http://127.0.0.1:54321/auth/v1/health", { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* retry service startup */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  throw new Error("local Supabase API did not become ready");
}

if (await import("node:fs").then(({ existsSync }) => existsSync(functionDir))) {
  throw new Error("refusing to replace an existing temporary waitUntil function");
}
try {
receiver = await startCallbackReceiver(marker);
mkdirSync(functionDir, { recursive: true });
writeFileSync(resolve(functionDir, "index.ts"), `
const durationMs = ${durationMs};
const expectedMarker = ${JSON.stringify(marker)};
const callbackUrl = ${JSON.stringify(receiver.url)};
async function notify(event, extra = {}) {
  const response = await fetch(callbackUrl, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ marker: expectedMarker, event, ...extra }),
    signal: AbortSignal.timeout(5000) });
  await response.body?.cancel();
  if (response.status !== 204) throw new Error("callback rejected");
}
addEventListener("beforeunload", (event) => {
  notify("shutdown", { reason: (event as CustomEvent).detail?.reason ?? "unknown" }).catch(() => {});
});
let admitted = false;
let completedResult: any = null;
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method === "GET") {
    if (new URL(request.url).searchParams.get("marker") !== expectedMarker) return new Response(null, { status: 403 });
    if (!completedResult) return Response.json({ status: "generating", marker: expectedMarker }, { status: 202 });
    return Response.json(completedResult, { status: 200 });
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (request.headers.get("x-smoke-marker") !== expectedMarker) return new Response(null, { status: 403 });
  if (admitted) return new Response(null, { status: 409 });
  admitted = true;
  try { await notify("started"); } catch {
    return new Response(JSON.stringify({ scheduled: false, errorCode: "local_callback_unreachable" }),
      { status: 502, headers: { "content-type": "application/json" } });
  }
  const startedAt = performance.now();
  EdgeRuntime.waitUntil((async () => {
    await notify("worker_started");
    while (performance.now() - startedAt < durationMs) {
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 15_000));
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log("AI_WAITUNTIL_SMOKE_HEARTBEAT:" + expectedMarker + ":" + elapsedMs);
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    completedResult = { status: "success", marker: expectedMarker, snapshotId: expectedMarker,
      main: [1, 2, 3], counter: [1, 3, 2], hole: [4, 5, 6], narrative: "synthetic waitUntil result" };
    console.log("AI_WAITUNTIL_SMOKE_COMPLETED:" + expectedMarker + ":" + elapsedMs);
  })());
  return new Response(JSON.stringify({ scheduled: true, marker: expectedMarker }), { status: 202, headers: { "content-type": "application/json" } });
});
`, "utf8");

  server = spawn(cli, ["functions", "serve", "ai-waituntil-smoke", "--no-verify-jwt"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { serverOutput.push(chunk); if (serverOutput.length > 100) serverOutput.shift(); });
  }
  server.on("error", (error) => { serverError = error; });
  await waitUntilReady();

  const logSince = new Date(Date.now() - 1_000).toISOString();
  await waitForLocalFunction({
    endpoint,
    isRunnerStopped: () => Boolean(serverError) || server.exitCode !== null,
    diagnostics: () => readinessDiagnostics(logSince),
    onProgress: (message) => console.log(message),
  });
  // The initiating request ends normally with its 202 response. A browser
  // closed after that point has no in-flight POST to abort; keep no polling
  // connection open while waitUntil runs, then use a fresh follower GET.
  const response = await fetch(endpoint, { method: "POST", headers: { "x-smoke-marker": marker }, signal: AbortSignal.timeout(10_000) });
  if (response.status !== 202) {
    await response.body?.cancel();
    throw new Error(`test function returned ${response.status}; startCallbackReceived=${receiver.state.startedAt !== null}; background test not confirmed started`);
  }
  const body = await response.json();
  assert.equal(body.scheduled, true);
  assert.equal(body.marker, marker);
  assert.notEqual(receiver.state.startedAt, null, "local callback path was not confirmed");
  console.log("INFO: start callback and HTTP 202 confirmed; initiating client has left; waiting without an open client request or additional Function requests");
  const workerStartDeadline = performance.now() + 10_000;
  while (!receiver.state.workerStartedAt && performance.now() < workerStartDeadline) {
    if (serverError || server.exitCode !== null) throw new Error("local serve process exited before waitUntil worker-start callback");
    if (receiver.state.shutdown) throw new Error(`worker shut down before its start callback: reason=${receiver.state.shutdown}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.notEqual(receiver.state.workerStartedAt, null, "waitUntil worker did not emit its start callback within 10 seconds");
  console.log(`INFO: waitUntil worker-start callback confirmed at ${Math.round(receiver.state.workerStartedAt - receiver.state.startedAt)}ms`);
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heartbeatPattern = new RegExp(`AI_WAITUNTIL_SMOKE_HEARTBEAT:${escapedMarker}:(\\d+)`, "g");
  const completionPattern = new RegExp(`AI_WAITUNTIL_SMOKE_COMPLETED:${escapedMarker}:(\\d+)`);
  let dockerOutput = "";
  let lastDockerReadAt = 0;
  let heartbeatTimes = [];
  let completionElapsedMs = null;
  const deadline = performance.now() + durationMs + 30_000;
  let nextProgress = performance.now() + 15_000;
  const firstHeartbeatDeadline = performance.now() + 30_000;
  while (completionElapsedMs === null && performance.now() < deadline) {
    if (serverError || server.exitCode !== null) throw new Error(`local serve process exited before completion; logHeartbeats=${heartbeatTimes.length}; shutdown=${receiver.state.shutdown ?? "unreported"}`);
    if (receiver.state.shutdown) throw new Error(`worker shutdown before completion: reason=${receiver.state.shutdown}; logHeartbeats=${heartbeatTimes.length}`);
    if (performance.now() - lastDockerReadAt >= 5_000) {
      try { dockerOutput = collectLogs(logSince); } catch { /* the serve process output remains available */ }
      lastDockerReadAt = performance.now();
    }
    const combinedOutput = `${serverOutput.join("")}\n${dockerOutput}`;
    heartbeatTimes = [...new Set([...combinedOutput.matchAll(heartbeatPattern)].map((match) => Number(match[1])))].sort((a, b) => a - b);
    const completed = combinedOutput.match(completionPattern);
    if (completed) completionElapsedMs = Number(completed[1]);
    if (heartbeatTimes.length === 0 && performance.now() >= firstHeartbeatDeadline) {
      throw new Error(`waitUntil worker started but no 15-second heartbeat log was observed within 30 seconds; ${readinessDiagnostics(logSince)}`);
    }
    if (performance.now() >= nextProgress) {
      console.log(`INFO: background wait ${Math.floor((performance.now() - receiver.state.startedAt) / 1000)}s; logHeartbeats=${heartbeatTimes.length}; lastWorkerElapsedMs=${heartbeatTimes.at(-1) ?? 0}; completion callback pending`);
      nextProgress = performance.now() + 15_000;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.notEqual(completionElapsedMs, null, `start callback succeeded but no completion log was received; logHeartbeats=${heartbeatTimes.length}; lastWorkerElapsedMs=${heartbeatTimes.at(-1) ?? 0}; shutdown=${receiver.state.shutdown ?? "unreported"}; background completion remains unverified`);
  assert.ok(heartbeatTimes.length >= 5, `expected at least five background heartbeat logs; got ${heartbeatTimes.length}`);
  const elapsedMs = completionElapsedMs;
  const observedMs = performance.now() - receiver.state.startedAt;
  assert.ok(elapsedMs >= 85_000 && elapsedMs <= 100_000, `unexpected worker duration ${elapsedMs}ms`);
  assert.ok(observedMs >= 85_000 && observedMs <= 120_000, `unexpected host duration ${Math.round(observedMs)}ms`);
  console.log(`PASS: local EdgeRuntime waitUntil completed via runtime logs; worker=${elapsedMs}ms host=${Math.round(observedMs)}ms`);
  const laterParticipant = await fetch(`${endpoint}?marker=${encodeURIComponent(marker)}`, { method: "GET", signal: AbortSignal.timeout(10_000) });
  assert.equal(laterParticipant.status, 200, "later participant must read the completed result");
  const laterResult = await laterParticipant.json();
  assert.equal(laterResult.status, "success");
  assert.equal(laterResult.snapshotId, marker);
  assert.deepEqual(laterResult.main, [1, 2, 3]);
  assert.equal(laterResult.narrative, "synthetic waitUntil result");
  console.log("PASS: D07 local EdgeRuntime worker survived leading-client disconnect; later participant read the same completed result");
} finally {
  if (server && server.exitCode === null) {
    const closed = new Promise((resolvePromise) => server.once("close", resolvePromise));
    if (process.platform === "win32" && server.pid) {
      const stopped = spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
      if (stopped.error || stopped.status !== 0) server.kill();
    } else {
      server.kill("SIGINT");
    }
    await Promise.race([closed, new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000))]);
  }
  try { rmSync(functionDir, { recursive: true, force: true }); }
  finally { if (receiver) await receiver.close(); }
}
console.log("INFO: temporary Function and callback listener cleaned up; no DB, Gemini, hosted project or deployment used");
