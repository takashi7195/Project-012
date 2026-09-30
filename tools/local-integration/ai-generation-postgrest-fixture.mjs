// Runs the production predictions handler against local PostgREST and a mock
// Gemini response. It tests real claim/attempt/save/reuse/read RPCs and cleans
// all synthetic rows in finally. It never contacts Gemini or a hosted project.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { buildAiInput } from "../../race-prediction/ai-input.mjs";
import { AI_CONTRACT_VERSION, hashAiConfig, resolveAiConfig } from "../../race-prediction/ai-config.mjs";
import { BASE_PROMPT_TEXT } from "../../race-prediction/ai-prompt.mjs";

const container = "supabase_db_project-012";
const localEnvPath = new URL("../../supabase/.temp/start-secrets/supabase_edge_runtime_project-012/env/docker.env", import.meta.url);
const envText = readFileSync(localEnvPath, "utf8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
const publicKey = envValue("SUPABASE_INTERNAL_PUBLISHABLE_KEY") || envValue("SUPABASE_ANON_KEY");
if (!serviceKey || !publicKey) throw new Error("local Supabase keys unavailable; values are never printed");

function psql(sql) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: sql, encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("local integration SQL failed; output withheld");
  return result.stdout;
}
function runFile(path) { return psql(readFileSync(new URL(path, import.meta.url), "utf8")); }
function scalar(sql) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    input: `begin read only; ${sql}; rollback;`, encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  const value = result.stdout?.trim();
  if (result.error || result.status !== 0 || !/^\d+$/.test(value ?? "")) throw new Error("local read-only assertion failed");
  return Number(value);
}
function waitForProcess(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${label} process failed`)));
  });
}
async function edgeHash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

let seeded = false;
let fetchMocked = false;
let previousFetch;
let previousDeno;
let previousEdgeRuntime;
let previousConsoleInfo;
const diagnosticLines = [];
try {
  runFile("./seed-ai-input-fixture.sql");
  seeded = true;
  psql("update race_data.race_programs set closed_at=clock_timestamp()+interval '2 hours' where projection_id='a1900000-0000-4000-8000-000000000015'; update race_data.snapshot_races set preview_presence='missing' where preview_component_id='a1900000-0000-4000-8000-000000000014'; update race_data.race_components set raw_json='null'::jsonb where id='a1900000-0000-4000-8000-000000000014'; update race_data.ingestion_runs set fetched_at=clock_timestamp()-interval '11 minutes' where id='a1900000-0000-4000-8000-000000000017';");

  const vars = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    SUPABASE_PUBLISHABLE_KEY: publicKey,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: publicKey }),
    PREDICTION_MODE: "ai_bundle",
    GEMINI_API_KEY: "synthetic-provider-key",
  };
  previousFetch = globalThis.fetch;
  previousDeno = globalThis.Deno;
  previousEdgeRuntime = globalThis.EdgeRuntime;
  previousConsoleInfo = console.info;
  console.info = (line) => { diagnosticLines.push(String(line)); };
  const providerOutput = { main: [1,2,3], counter: [1,3,2], hole: [4,5,6], narrative: "合成fixtureに基づく試験用レース展開。" };
  let providerResponses = [providerOutput];
  let mockResponseIndex = 0;
  let providerRequests = 0;
  let firstProviderPayload = null;
  const providerRequestPaths = [];
  const providerPayloads = [];
  let providerGate = null;
  let releaseProviderGate = null;
  let providerStarted = null;
  let releaseProviderStarted = null;
  let loseNextFinishResponse = false;
  let loseNextBeginResponse = false;
  let failNextFinishBeforeCommit = false;
  let onFinishRpcStarted = null;
  let onReadRpcStarted = null;
  let providerDelayMs = 0;
  const workers = [];
  globalThis.Deno = { env: { get: (name) => vars[name], toObject: () => ({ ...vars }) }, serve: (handler) => { globalThis.__v019FixtureHandler = handler; } };
  globalThis.EdgeRuntime = { waitUntil: (promise) => { workers.push(promise); } };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      const output = providerResponses[mockResponseIndex++] ?? providerOutput;
      providerRequests++;
      providerRequestPaths.push(new URL(String(url)).pathname);
      providerPayloads.push(JSON.parse(options.body));
      if (!firstProviderPayload) firstProviderPayload = JSON.parse(options.body);
      if (releaseProviderStarted) { releaseProviderStarted(); releaseProviderStarted = null; }
      if (providerGate) await providerGate;
      if (providerDelayMs > 0) {
        const delay = providerDelayMs; providerDelayMs = 0;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      if (output && typeof output === "object" && output.mockHttpStatus) {
        return Response.json({ error: { message: output.privateMessage } }, { status: output.mockHttpStatus });
      }
      return Response.json({ candidates: [{ content: { parts: [{ text: typeof output === "string" ? output : JSON.stringify(output) }] }, finishReason: "STOP", modelVersion: "fixture" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } });
    }
    if (failNextFinishBeforeCommit && String(url).endsWith("/rpc/race_prediction_finish_ai_job")) {
      failNextFinishBeforeCommit = false;
      return Response.json({ error: "synthetic pre-commit save failure" }, { status: 502 });
    }
    if (String(url).endsWith("/rpc/race_prediction_finish_ai_job") && onFinishRpcStarted) {
      const notify = onFinishRpcStarted; onFinishRpcStarted = null; notify();
    }
    if (String(url).endsWith("/rpc/race_prediction_read_ai_job") && onReadRpcStarted) {
      const notify = onReadRpcStarted; onReadRpcStarted = null; notify();
    }
    const response = await previousFetch(url, options);
    if (loseNextFinishResponse && String(url).endsWith("/rpc/race_prediction_finish_ai_job")) {
      loseNextFinishResponse = false;
      const committed = await response.clone().json();
      assert.equal(committed.saved, true, "simulated dropped response must happen only after DB commit");
      try { await response.body?.cancel(); } catch { /* response body is intentionally discarded */ }
      return Response.json({ error: "synthetic response loss" }, { status: 502 });
    }
    if (loseNextBeginResponse && String(url).endsWith("/rpc/race_prediction_begin_ai_attempt")) {
      loseNextBeginResponse = false;
      const committed = await response.clone().json();
      assert.equal(committed.sendAuthorized, true, "simulated dropped begin response must follow authorization commit");
      try { await response.body?.cancel(); } catch { /* response body is intentionally discarded */ }
      return Response.json({ error: "synthetic response loss" }, { status: 502 });
    }
    return response;
  };
  fetchMocked = true;
  await import(`../../supabase/functions/predictions/index.ts?local-db-fixture=${Date.now()}`);
  const handler = globalThis.__v019FixtureHandler;
  assert.equal(typeof handler, "function");
  const headers = { apikey: publicKey, "content-type": "application/json" };
  const raceDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const startRequest = (signal) => new Request("http://local.test/functions/v1/predictions", { method: "POST", headers, signal,
    body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", raceDate, stadiumCode: 24, raceNumber: 12 }) });

  const started = await handler(startRequest());
  assert.equal(started.status, 202);
  const startBody = await started.json();
  assert.equal(Object.hasOwn(startBody, "ownerToken"), false);
  assert.equal(JSON.stringify(startBody).includes("Fixture Racer"), false);
  assert.equal(startBody.status, "generating");
  assert.equal(workers.length, 1, "newly claimed job must register one background worker");
  await workers[0];
  assert.equal(providerRequests, 1, "one valid provider response should be used");
  const firstInput = JSON.parse(firstProviderPayload.contents[0].parts[0].text);
  const firstFacts = firstInput.facts;
  assert.equal(firstFacts.preview, null, "valid six-entry race must continue with missing preview data");
  assert.equal(firstFacts.presence.preview, "missing");
  assert.equal(firstInput.sourceCode, "boatraceopenapi-v1");
  const fetchedAgeMinutes = (Date.now() - Date.parse(firstInput.fetchedAt)) / 60_000;
  assert.ok(fetchedAgeMinutes >= 10 && fetchedAgeMinutes <= 11.5, "11-minute-old source timestamp must reach the provider unchanged");

  // Updating only observation/confirmation time does not replace facts or
  // overwrite the provenance snapshot stored with the successful bundle.
  psql("update race_data.ingestion_runs set fetched_at=clock_timestamp() where id='a1900000-0000-4000-8000-000000000017'; update race_data.day_heads set last_success_at=clock_timestamp() where current_batch_id='a1900000-0000-4000-8000-000000000011';");
  const timeOnlyReuse = await handler(startRequest());
  assert.equal(timeOnlyReuse.status, 200);
  const timeOnlyBody = await timeOnlyReuse.json();
  assert.equal(timeOnlyBody.reused, true);
  assert.equal(timeOnlyBody.status, "success");
  assert.equal(providerRequests, 1, "time-only source update must reuse the saved bundle");
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles b join race_prediction.ai_generation_jobs j on j.id=b.job_id where j.id='${startBody.jobId}' and j.input_bundle#>>'{provenance,fetchedAt}'='${firstInput.fetchedAt}'`), 1,
    "saved input bundle must retain the original fetchedAt rather than adopting the refreshed timestamp");

  const reused = await handler(startRequest());
  assert.equal(reused.status, 200);
  const reusedBody = await reused.json();
  assert.equal(reusedBody.status, "success");
  assert.equal(reusedBody.reused, true);
  assert.equal(timeOnlyBody.snapshotId, reusedBody.snapshotId);
  assert.deepEqual(reusedBody.main, providerOutput.main);
  assert.equal(reusedBody.narrative, providerOutput.narrative);
  assert.equal(providerRequests, 1, "same input must reuse success without another provider request");

  // After the close deadline, new START is rejected even for cached success,
  // while the already-started job remains readable.
  psql("update race_data.race_programs set closed_at=clock_timestamp()-interval '1 second' where projection_id='a1900000-0000-4000-8000-000000000015';");
  const postDeadlineStart = await handler(startRequest());
  assert.equal(postDeadlineStart.status, 200);
  assert.equal((await postDeadlineStart.json()).status, "closed");
  assert.equal(providerRequests, 1, "post-deadline START must not reuse a cache or call provider");
  const postDeadlineRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${startBody.jobId}`, { headers }));
  assert.equal(postDeadlineRead.status, 200);
  const postDeadlineBody = await postDeadlineRead.json();
  assert.equal(postDeadlineBody.status, "success");
  assert.equal(postDeadlineBody.snapshotId, reusedBody.snapshotId);
  psql("update race_data.race_programs set closed_at=clock_timestamp()+interval '2 hours' where projection_id='a1900000-0000-4000-8000-000000000015';");

  const jobRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${startBody.jobId}`, { headers }));
  assert.equal(jobRead.status, 200);
  const jobReadText = await jobRead.text();
  assert.equal(jobReadText.includes("Fixture Racer"), false, "public job response must not disclose raw race input");
  assert.equal(jobReadText.includes("synthetic-provider-key"), false, "public job response must not disclose provider credentials");
  const jobBody = JSON.parse(jobReadText);
  for (const forbidden of ["ownerToken", "inputBundle", "configSnapshot", "factsHash", "configHash", "requestPayload", "usage"]) {
    assert.equal(Object.hasOwn(jobBody, forbidden), false, `public job response must omit ${forbidden}`);
  }
  assert.equal(jobBody.status, "success");
  assert.equal(jobBody.snapshotId, reusedBody.snapshotId);
  assert.deepEqual(jobBody.counter, providerOutput.counter);
  let diagnosticEvents = diagnosticLines.map((line) => { try { return JSON.parse(line).event; } catch { return null; } });
  assert.ok(diagnosticEvents.includes("provider.finished"));
  assert.ok(diagnosticEvents.includes("save.finished"));
  assert.ok(diagnosticEvents.includes("job.read"));
  assert.equal(scalar("select count(*) from race_prediction.ai_generation_jobs where race_id='a1900000-0000-4000-8000-000000000012' and state='succeeded'"), 1);
  assert.equal(scalar("select count(*) from race_prediction.ai_prediction_bundles where race_id='a1900000-0000-4000-8000-000000000012'"), 1);
  assert.equal(scalar("select count(*) from race_prediction.ai_generation_attempts where job_id in (select id from race_prediction.ai_generation_jobs where race_id='a1900000-0000-4000-8000-000000000012') and state='succeeded'"), 1);
  assert.equal(scalar("select count(*) from race_prediction.ai_generation_jobs j join race_prediction.ai_prediction_bundles b on b.job_id=j.id and b.reuse_key=j.reuse_key join race_prediction.ai_generation_keys k on k.reuse_key=j.reuse_key and k.current_job_id=j.id and k.completed_prediction_id=b.id join race_prediction.ai_generation_attempts a on a.job_id=j.id and a.sequence=b.winning_attempt and a.state='succeeded' where j.race_id='a1900000-0000-4000-8000-000000000012' and j.state='succeeded'"), 1, "saved job, reuse key, winning attempt and bundle must form one consistent success");

  // Concurrent starts for the same selector must share one job/owner/provider call.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('concurrent-start-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  const concurrentStarts = await Promise.all(Array.from({ length: 20 }, () => handler(startRequest())));
  releaseProviderGate();
  providerGate = null;
  const concurrentBodies = await Promise.all(concurrentStarts.map(async response => {
    assert.equal(response.status, 202);
    return response.json();
  }));
  const concurrentJobIds = new Set(concurrentBodies.map(body => body.jobId));
  assert.equal(concurrentJobIds.size, 1, "all 20 starts must join one shared job");
  assert.equal(workers.length, 2, "only one new owner should register a worker");
  await workers[1];
  assert.equal(providerRequests, 2, "20 concurrent starts should cause one provider request after the initial job");
  const concurrentJobId = [...concurrentJobIds][0];
  const concurrentRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${concurrentJobId}`, { headers }));
  assert.equal(concurrentRead.status, 200);
  assert.equal((await concurrentRead.json()).status, "success");

  // Real-time staggered starts: a second user joins at +30s; one result saves at +60s.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('staggered-start-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  providerStarted = new Promise(resolve => { releaseProviderStarted = resolve; });
  const staggeredStartedAt = Date.now();
  const firstStaggeredStart = await handler(startRequest()); assert.equal(firstStaggeredStart.status, 202);
  const firstStaggeredBody = await firstStaggeredStart.json();
  const staggeredWorkerIndex = workers.length - 1;
  await providerStarted;
  assert.equal(providerRequests, 3);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, staggeredStartedAt + 30_000 - Date.now())));
  const secondStaggeredStart = await handler(startRequest()); assert.equal(secondStaggeredStart.status, 202);
  const secondStaggeredBody = await secondStaggeredStart.json();
  assert.equal(secondStaggeredBody.jobId, firstStaggeredBody.jobId, "second START must join the first user's job");
  assert.equal(workers.length, staggeredWorkerIndex + 1, "second START must not create a second worker");
  await new Promise(resolve => setTimeout(resolve, Math.max(0, staggeredStartedAt + 60_000 - Date.now())));
  const staggeredElapsedMs = Date.now() - staggeredStartedAt;
  releaseProviderGate(); providerGate = null; providerStarted = null;
  await workers[staggeredWorkerIndex];
  assert.equal(providerRequests, 3, "two users must share exactly one provider request");
  const staggeredRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${firstStaggeredBody.jobId}`, { headers }));
  assert.equal(staggeredRead.status, 200);
  assert.equal((await staggeredRead.json()).status, "success");
  assert.ok(staggeredElapsedMs >= 59_000 && staggeredElapsedMs < 75_000, `expected ~60 seconds, got ${staggeredElapsedMs}`);

  // A model/config change with identical race facts must not reuse the old bundle.
  vars.RACE_AI_MODEL = "gemini-fixture-alternate";
  const configChangedStart = await handler(startRequest());
  assert.equal(configChangedStart.status, 202);
  const configChangedBody = await configChangedStart.json();
  assert.notEqual(configChangedBody.jobId, startBody.jobId);
  assert.equal(workers.length, 4);
  await workers[3];
  assert.equal(providerRequests, 4, "changed model configuration must trigger a new provider request");
  const configChangedRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${configChangedBody.jobId}`, { headers }));
  assert.equal(configChangedRead.status, 200);
  assert.equal((await configChangedRead.json()).status, "success");
  assert.equal(scalar("select count(*) from race_prediction.ai_prediction_bundles where race_id='a1900000-0000-4000-8000-000000000012'"), 4);
  delete vars.RACE_AI_MODEL;

  // An expired worker cannot be restarted by GET; a new START replaces it.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('expired-owner-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  providerStarted = new Promise(resolve => { releaseProviderStarted = resolve; });
  const expiredStart = await handler(startRequest()); assert.equal(expiredStart.status, 202);
  const expiredStartBody = await expiredStart.json(); assert.equal(workers.length, 5);
  await providerStarted;
  psql(`update race_prediction.ai_generation_jobs set expires_at=clock_timestamp()-interval '1 second' where id='${expiredStartBody.jobId}' and state='generating';`);
  const expiredRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${expiredStartBody.jobId}`, { headers }));
  assert.equal(expiredRead.status, 503);
  assert.equal(providerRequests, 5, "GET must not restart or resend provider work");
  const replacementStart = await handler(startRequest()); assert.equal(replacementStart.status, 202);
  const replacementBody = await replacementStart.json();
  assert.notEqual(replacementBody.jobId, expiredStartBody.jobId);
  assert.equal(workers.length, 6);
  const providerWaitStarted = Date.now();
  while (providerRequests < 6 && Date.now() - providerWaitStarted < 5_000) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(providerRequests, 6, "manual START should submit exactly one replacement request");
  releaseProviderGate(); providerGate = null; providerStarted = null;
  await Promise.all([workers[4], workers[5]]);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${expiredStartBody.jobId}'`), 0);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${replacementBody.jobId}'`), 1);

  // A source change during an active job creates a second immutable input bundle.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('input-before-change'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  providerStarted = new Promise(resolve => { releaseProviderStarted = resolve; });
  const inputBeforeChange = await handler(startRequest()); assert.equal(inputBeforeChange.status, 202);
  const inputBeforeBody = await inputBeforeChange.json(); assert.equal(workers.length, 7);
  await providerStarted;
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('input-after-change'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  const inputAfterChange = await handler(startRequest()); assert.equal(inputAfterChange.status, 202);
  const inputAfterBody = await inputAfterChange.json(); assert.notEqual(inputAfterBody.jobId, inputBeforeBody.jobId);
  assert.equal(workers.length, 8);
  const newInputWaitStarted = Date.now();
  while (providerRequests < 8 && Date.now() - newInputWaitStarted < 5_000) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(providerRequests, 8, "changed source facts should start one distinct generation");
  releaseProviderGate(); providerGate = null; providerStarted = null;
  await Promise.all([workers[6], workers[7]]);
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs where id='${inputBeforeBody.jobId}' and input_bundle#>>'{facts,program,subtitle}'='input-before-change'`), 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs where id='${inputAfterBody.jobId}' and input_bundle#>>'{facts,program,subtitle}'='input-after-change'`), 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id in ('${inputBeforeBody.jobId}','${inputAfterBody.jobId}')`), 2);

  // Simulate the DB commit succeeding while the finish RPC response is lost.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('lost-save-response-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  loseNextFinishResponse = true;
  const lostSaveResponseStart = await handler(startRequest()); assert.equal(lostSaveResponseStart.status, 202);
  const lostSaveResponseBody = await lostSaveResponseStart.json(); assert.equal(workers.length, 9);
  await workers[8]; assert.equal(loseNextFinishResponse, false);
  const recoveredRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${lostSaveResponseBody.jobId}`, { headers }));
  assert.equal(recoveredRead.status, 200);
  const recoveredBody = await recoveredRead.json(); assert.equal(recoveredBody.status, "success");
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${lostSaveResponseBody.jobId}'`), 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_attempts where job_id='${lostSaveResponseBody.jobId}' and state='succeeded'`), 1);

  // Change one pre-race fact to produce a new reuse key. Repair a duplicate
  // ticket response on attempt two and save only the corrected full bundle.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('retry-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerResponses = [{ ...providerOutput, counter: [1,2,3] }, providerOutput];
  mockResponseIndex = 0;
  const repairedStart = await handler(startRequest());
  assert.equal(repairedStart.status, 202);
  const repairedStartBody = await repairedStart.json();
  assert.equal(workers.length, 10);
  await workers[9];
  assert.equal(providerRequests, 11, "duplicate ticket groups should trigger exactly one repair request");
  const repairedRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${repairedStartBody.jobId}`, { headers }));
  assert.equal(repairedRead.status, 200);
  const repairedBundle = await repairedRead.json();
  assert.equal(repairedBundle.status, "success");
  assert.deepEqual(repairedBundle.main, providerOutput.main);
  assert.deepEqual(repairedBundle.counter, providerOutput.counter);
  assert.deepEqual(repairedBundle.hole, providerOutput.hole);
  assert.equal(repairedBundle.narrative, providerOutput.narrative);

  // A further fact change creates another job. Two invalid responses must
  // stop after attempt two and leave no partial prediction bundle.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('failed-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  const invalidNarrative = { ...providerOutput, narrative: "   " };
  providerResponses = [invalidNarrative, invalidNarrative];
  mockResponseIndex = 0;
  const invalidStart = await handler(startRequest());
  assert.equal(invalidStart.status, 202);
  const invalidStartBody = await invalidStart.json();
  assert.equal(workers.length, 11);
  await workers[10];
  assert.equal(providerRequests, 13, "two invalid bundles must stop at the two-attempt limit");
  const invalidRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${invalidStartBody.jobId}`, { headers }));
  assert.equal(invalidRead.status, 503);
  const invalidReadBody = await invalidRead.json();
  assert.equal(invalidReadBody.retryable, true);
  for (const key of ["main", "counter", "hole", "narrative"]) assert.equal(Object.hasOwn(invalidReadBody, key), false);
  assert.equal(scalar("select count(*) from race_prediction.ai_generation_jobs where race_id='a1900000-0000-4000-8000-000000000012' and state='failed'"), 1);
  assert.equal(scalar("select count(*) from race_prediction.ai_generation_attempts a join race_prediction.ai_generation_jobs j on j.id=a.job_id where j.race_id='a1900000-0000-4000-8000-000000000012' and j.state='failed' and a.state='failed'"), 2);
  assert.equal(scalar("select count(*) from race_prediction.ai_prediction_bundles b join race_prediction.ai_generation_jobs j on j.id=b.job_id where j.race_id='a1900000-0000-4000-8000-000000000012' and j.state='failed'"), 0);

  // Missing required fields and malformed provider JSON both stop after two
  // attempts and must not persist a partial bundle.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('missing-field-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  const missingField = { ...providerOutput }; delete missingField.main;
  providerResponses = [missingField, missingField]; mockResponseIndex = 0;
  const missingStart = await handler(startRequest()); assert.equal(missingStart.status, 202);
  const missingStartBody = await missingStart.json(); assert.equal(workers.length, 12); await workers[11];
  assert.equal(providerRequests, 15);
  const missingRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${missingStartBody.jobId}`, { headers }));
  assert.equal(missingRead.status, 503); const missingReadBody = await missingRead.json();
  assert.equal(missingReadBody.status, "failed");
  for (const key of ["main", "counter", "hole", "narrative"]) assert.equal(Object.hasOwn(missingReadBody, key), false);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${missingStartBody.jobId}'`), 0);

  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('malformed-json-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerResponses = ["{malformed-json", "{malformed-json"]; mockResponseIndex = 0;
  const malformedStart = await handler(startRequest()); assert.equal(malformedStart.status, 202);
  const malformedStartBody = await malformedStart.json(); assert.equal(workers.length, 13); await workers[12];
  assert.equal(providerRequests, 17);
  const malformedRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${malformedStartBody.jobId}`, { headers }));
  assert.equal(malformedRead.status, 503); const malformedReadBody = await malformedRead.json();
  assert.equal(malformedReadBody.status, "failed");
  for (const key of ["main", "counter", "hole", "narrative"]) assert.equal(Object.hasOwn(malformedReadBody, key), false);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${malformedStartBody.jobId}'`), 0);

  for (const [index, httpStatus] of [401, 403, 404].entries()) {
    psql(`update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('provider-http-${httpStatus}'::text)) where id='a1900000-0000-4000-8000-000000000013';`);
    providerResponses = [{ mockHttpStatus: httpStatus, privateMessage: "PROVIDER_PRIVATE_SENTINEL" }]; mockResponseIndex = 0;
    const start = await handler(startRequest()); assert.equal(start.status, 202);
    const startedBody = await start.json(); assert.equal(workers.length, 14 + index); await workers[13 + index];
    assert.equal(providerRequests, 18 + index, `HTTP ${httpStatus} must not retry`);
    const failed = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${startedBody.jobId}`, { headers }));
    assert.equal(failed.status, 503);
    const body = await failed.text();
    assert.equal(body.includes("PROVIDER_PRIVATE_SENTINEL"), false);
    assert.equal(body.includes("main"), false);
    assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${startedBody.jobId}'`), 0);
  }
  // Start before the close deadline, receive an invalid first answer after it,
  // then ensure the bounded repair can finish from the admitted input bundle.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('deadline-crossing-repair-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013'; update race_data.race_programs set closed_at=clock_timestamp()+interval '3 seconds' where projection_id='a1900000-0000-4000-8000-000000000015';");
  providerResponses = [{ ...providerOutput, counter: [1,2,3] }, providerOutput]; mockResponseIndex = 0; providerDelayMs = 3500;
  const deadlineCrossingWorkerIndex = workers.length;
  const deadlineCrossingStart = await handler(startRequest()); assert.equal(deadlineCrossingStart.status, 202);
  const deadlineCrossingBody = await deadlineCrossingStart.json();
  assert.equal(workers.length, deadlineCrossingWorkerIndex + 1);
  await workers[deadlineCrossingWorkerIndex];
  const deadlineCrossingNow = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${deadlineCrossingBody.jobId}`, { headers }));
  assert.equal(deadlineCrossingNow.status, 200);
  assert.equal((await deadlineCrossingNow.json()).status, "success");
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs where id='${deadlineCrossingBody.jobId}' and state='succeeded' and closed_at_at_admission < clock_timestamp()`), 1,
    "job must complete after its admitted race close time using fixed input");
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${deadlineCrossingBody.jobId}'`), 1);
  assert.equal(providerRequests, 22, "one invalid attempt and one bounded repair should be sent");
  psql("update race_data.race_programs set closed_at=clock_timestamp()+interval '2 hours' where projection_id='a1900000-0000-4000-8000-000000000015';");

  // Hold the exact reuse-key row while a real Edge START attempts its claim.
  const deadlineSourceResponse = await previousFetch("http://127.0.0.1:54321/rest/v1/rpc/race_prediction_get_ai_input", {
    method: "POST", headers: { apikey: publicKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({ p_race_date: raceDate, p_stadium_code: 24, p_race_number: 12 }),
  });
  assert.equal(deadlineSourceResponse.status, 200);
  const deadlineSource = await deadlineSourceResponse.json();
  const lockInput = await buildAiInput({ identity: deadlineSource.identity, programRaw: deadlineSource.programRaw,
    previewRaw: deadlineSource.previewRaw, presence: deadlineSource.presence, provenance: deadlineSource.provenance, closedAt: deadlineSource.closedAt });
  const lockConfig = resolveAiConfig({ ...vars, RACE_AI_TOTAL_TIMEOUT_MS: "2000", RACE_AI_SAVE_RESERVE_MS: "1000" });
  const lockConfigHash = await hashAiConfig(lockConfig, BASE_PROMPT_TEXT);
  const lockReuseKey = await edgeHash({ mode: AI_CONTRACT_VERSION, factsHash: lockInput.factsHash, configHash: lockConfigHash });
  psql(`insert into race_prediction.ai_generation_keys(reuse_key) values('${lockReuseKey}') on conflict do nothing;`);
  const lockHolder = spawn("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "ignore", "ignore"] });
  lockHolder.stdin.end(`begin; select reuse_key from race_prediction.ai_generation_keys where reuse_key='${lockReuseKey}' for update; select pg_sleep(4); commit;`);
  await new Promise(resolve => setTimeout(resolve, 300));
  vars.RACE_AI_TOTAL_TIMEOUT_MS = "2000";
  vars.RACE_AI_SAVE_RESERVE_MS = "1000";
  const lockStartAt = Date.now();
  const lockStartResponse = await handler(startRequest());
  const lockElapsedMs = Date.now() - lockStartAt;
  assert.equal(lockStartResponse.status, 503);
  const lockStartBody = await lockStartResponse.json();
  assert.equal(lockStartBody.retryable, true);
  assert.equal(providerRequests, 22, "claim lock timeout must not reach the mock provider");
  assert.ok(lockElapsedMs >= 1500 && lockElapsedMs < 3500, `claim lock wait must stop near its 2s budget; elapsed=${lockElapsedMs}`);
  await new Promise((resolve, reject) => { lockHolder.once("error", reject); lockHolder.once("exit", code => code === 0 ? resolve() : reject(new Error("lock-holder SQL failed"))); });
  psql(`delete from race_prediction.ai_generation_keys where reuse_key='${lockReuseKey}' and current_job_id is null;`);
  delete vars.RACE_AI_TOTAL_TIMEOUT_MS;
  delete vars.RACE_AI_SAVE_RESERVE_MS;

  // The begin-attempt RPC commits authorization, then its HTTP response is lost.
  // The worker must record uncertainty and close the job without contacting AI.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('lost-begin-response-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  loseNextBeginResponse = true;
  const beginResponseWorkerIndex = workers.length;
  const beginResponseStart = await handler(startRequest()); assert.equal(beginResponseStart.status, 202);
  const beginResponseBody = await beginResponseStart.json();
  assert.equal(workers.length, beginResponseWorkerIndex + 1);
  await workers[beginResponseWorkerIndex];
  assert.equal(loseNextBeginResponse, false);
  assert.equal(providerRequests, 22, "lost begin response must not call the provider");
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs j join race_prediction.ai_generation_attempts a on a.job_id=j.id where j.id='${beginResponseBody.jobId}' and j.state='failed' and j.retryable is true and a.sequence=1 and a.state='unknown' and a.error_code='attempt_authorization_unknown'`), 1,
    "authorized but unacknowledged attempt must be recorded unknown and leave a retryable failed job");

  // A save RPC fails before reaching PostgREST. The worker must not resend AI
  // or create any public/partial bundle after an unsuccessful save.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('precommit-save-failure-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  const saveFailureRequestBaseline = providerRequests;
  failNextFinishBeforeCommit = true;
  const saveFailureWorkerIndex = workers.length;
  const saveFailureStart = await handler(startRequest()); assert.equal(saveFailureStart.status, 202);
  const saveFailureBody = await saveFailureStart.json();
  await workers[saveFailureWorkerIndex];
  assert.equal(failNextFinishBeforeCommit, false);
  assert.equal(providerRequests, saveFailureRequestBaseline + 1, "a save failure must not start another provider request");
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${saveFailureBody.jobId}'`), 0);
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs j join race_prediction.ai_generation_attempts a on a.job_id=j.id where j.id='${saveFailureBody.jobId}' and j.state='generating' and a.sequence=1 and a.state='started'`), 1);
  const saveFailureRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${saveFailureBody.jobId}`, { headers }));
  assert.equal(saveFailureRead.status, 202, "an uncommitted save error must not expose success or partial output");
  assert.equal(providerRequests, saveFailureRequestBaseline + 1, "job GET after save failure must not restart generation");

  // Freeze the first job's input/config while provider work is in flight.
  // A concurrent START after both values change must get its own job/config.
  const originalModel = vars.RACE_AI_MODEL;
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('g13-input-before-change'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerResponses = [{ ...providerOutput, counter: [1,2,3] }, providerOutput, providerOutput]; mockResponseIndex = 0;
  const g13RequestBaseline = providerRequests;
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  providerStarted = new Promise(resolve => { releaseProviderStarted = resolve; });
  const g13FirstWorkerIndex = workers.length;
  const g13FirstStart = await handler(startRequest()); assert.equal(g13FirstStart.status, 202);
  const g13FirstBody = await g13FirstStart.json();
  await providerStarted;
  vars.RACE_AI_MODEL = "gemini-fixture-v2";
  vars.RACE_AI_STYLE_VERSION = "g13-style-v2";
  vars.RACE_AI_STYLE_TEXT = "G13_SECOND_CONFIG_SENTINEL";
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('g13-input-after-change'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  const g13SecondWorkerIndex = workers.length;
  const g13SecondStart = await handler(startRequest()); assert.equal(g13SecondStart.status, 202);
  const g13SecondBody = await g13SecondStart.json();
  assert.notEqual(g13FirstBody.jobId, g13SecondBody.jobId);
  assert.equal(workers.length, g13SecondWorkerIndex + 1);
  const g13SecondProviderWaitStarted = Date.now();
  while (providerRequests < g13RequestBaseline + 2 && Date.now() - g13SecondProviderWaitStarted < 5_000) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(providerRequests, g13RequestBaseline + 2, "changed input/config should start a separate provider request");
  releaseProviderGate(); providerGate = null; providerStarted = null;
  const g13RepairWaitStarted = Date.now();
  while (providerRequests < g13RequestBaseline + 3 && Date.now() - g13RepairWaitStarted < 5_000) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(providerRequests, g13RequestBaseline + 3, "the original invalid result should be repaired once");
  await Promise.all([workers[g13FirstWorkerIndex], workers[g13SecondWorkerIndex]]);
  const originalModelName = originalModel ?? resolveAiConfig({}).model;
  assert.ok(providerRequestPaths[g13RequestBaseline].endsWith(`/models/${originalModelName}:generateContent`));
  assert.ok(providerRequestPaths[g13RequestBaseline + 1].endsWith("/models/gemini-fixture-v2:generateContent"));
  assert.ok(providerRequestPaths[g13RequestBaseline + 2].endsWith(`/models/${originalModelName}:generateContent`));
  assert.doesNotMatch(providerPayloads[g13RequestBaseline].systemInstruction.parts[0].text, /G13_SECOND_CONFIG_SENTINEL/);
  assert.match(providerPayloads[g13RequestBaseline + 1].systemInstruction.parts[0].text, /G13_SECOND_CONFIG_SENTINEL/);
  assert.doesNotMatch(providerPayloads[g13RequestBaseline + 2].systemInstruction.parts[0].text, /G13_SECOND_CONFIG_SENTINEL/);
  assert.equal(JSON.parse(providerPayloads[g13RequestBaseline].contents[0].parts[0].text).facts.program.subtitle, "g13-input-before-change");
  assert.equal(JSON.parse(providerPayloads[g13RequestBaseline + 2].contents[0].parts[0].text).facts.program.subtitle, "g13-input-before-change");
  assert.equal(JSON.parse(providerPayloads[g13RequestBaseline + 1].contents[0].parts[0].text).facts.program.subtitle, "g13-input-after-change");
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs where id='${g13FirstBody.jobId}' and state='succeeded' and config_snapshot->>'model'='${originalModelName}' and config_snapshot->>'styleText'='' and input_bundle#>>'{facts,program,subtitle}'='g13-input-before-change'`), 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs where id='${g13SecondBody.jobId}' and state='succeeded' and config_snapshot->>'model'='gemini-fixture-v2' and config_snapshot->>'styleText'='G13_SECOND_CONFIG_SENTINEL' and input_bundle#>>'{facts,program,subtitle}'='g13-input-after-change'`), 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id in ('${g13FirstBody.jobId}','${g13SecondBody.jobId}')`), 2);
  delete vars.RACE_AI_MODEL; delete vars.RACE_AI_STYLE_VERSION; delete vars.RACE_AI_STYLE_TEXT;
  console.log("PASS: pre-commit save failure created no bundle, exposed no success, and did not retry provider generation");
  console.log("PASS: in-flight job retained its original input/model/style through repair; later START used changed input/model/style");

  // If save obtains the job row first, an overlapping read must observe success
  // and a later post-deadline GET must not overwrite it with expired.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('d16-success-wins-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerResponses = [providerOutput]; mockResponseIndex = 0;
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  providerStarted = new Promise(resolve => { releaseProviderStarted = resolve; });
  const successWinsRequestBaseline = providerRequests;
  const successWinsWorkerIndex = workers.length;
  const successWinsStart = await handler(startRequest()); assert.equal(successWinsStart.status, 202);
  const successWinsBody = await successWinsStart.json(); await providerStarted;
  const successWinsLock = spawn("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "ignore", "ignore"] });
  successWinsLock.stdin.end(`begin; select id from race_prediction.ai_generation_jobs where id='${successWinsBody.jobId}' for update; select pg_sleep(3); commit;`);
  const successWinsLockExit = waitForProcess(successWinsLock, "D16 success-wins row lock");
  await new Promise(resolve => setTimeout(resolve, 200));
  const finishRpcStarted = new Promise(resolve => { onFinishRpcStarted = resolve; });
  releaseProviderGate(); providerGate = null; providerStarted = null;
  await finishRpcStarted;
  await new Promise(resolve => setTimeout(resolve, 200));
  const readRpcStarted = new Promise(resolve => { onReadRpcStarted = resolve; });
  const concurrentSuccessRead = handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${successWinsBody.jobId}`, { headers }));
  await readRpcStarted;
  await successWinsLockExit;
  await workers[successWinsWorkerIndex];
  const successWinsResponse = await concurrentSuccessRead;
  assert.equal(successWinsResponse.status, 200);
  assert.equal((await successWinsResponse.json()).status, "success");
  assert.equal(providerRequests, successWinsRequestBaseline + 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${successWinsBody.jobId}'`), 1);
  psql(`update race_prediction.ai_generation_jobs set expires_at=clock_timestamp()-interval '1 second' where id='${successWinsBody.jobId}';`);
  const afterDeadlineSuccessRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${successWinsBody.jobId}`, { headers }));
  assert.equal(afterDeadlineSuccessRead.status, 200, "a later deadline GET must not overwrite saved success");
  assert.equal((await afterDeadlineSuccessRead.json()).status, "success");
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs where id='${successWinsBody.jobId}' and state='succeeded'`), 1);

  // If a deadline read expires the job while save is queued on the reuse key,
  // the later save must refuse without writing any bundle.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('d16-expiry-wins-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerResponses = [providerOutput]; mockResponseIndex = 0;
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  providerStarted = new Promise(resolve => { releaseProviderStarted = resolve; });
  const expiryWinsRequestBaseline = providerRequests;
  const expiryWinsWorkerIndex = workers.length;
  const expiryWinsStart = await handler(startRequest()); assert.equal(expiryWinsStart.status, 202);
  const expiryWinsBody = await expiryWinsStart.json(); await providerStarted;
  psql(`update race_prediction.ai_generation_jobs set expires_at=clock_timestamp()-interval '1 second' where id='${expiryWinsBody.jobId}';`);
  const expiryWinsLock = spawn("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "ignore", "ignore"] });
  expiryWinsLock.stdin.end(`begin; select reuse_key from race_prediction.ai_generation_keys where current_job_id='${expiryWinsBody.jobId}' for update; select pg_sleep(3); commit;`);
  const expiryWinsLockExit = waitForProcess(expiryWinsLock, "D16 expiry-wins key lock");
  await new Promise(resolve => setTimeout(resolve, 200));
  const expiryFinishRpcStarted = new Promise(resolve => { onFinishRpcStarted = resolve; });
  releaseProviderGate(); providerGate = null; providerStarted = null;
  await expiryFinishRpcStarted;
  await new Promise(resolve => setTimeout(resolve, 200));
  const expiryReadRpcStarted = new Promise(resolve => { onReadRpcStarted = resolve; });
  const concurrentExpiredRead = handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${expiryWinsBody.jobId}`, { headers }));
  await expiryReadRpcStarted;
  const expiredReadResponse = await concurrentExpiredRead;
  assert.equal(expiredReadResponse.status, 503);
  assert.equal((await expiredReadResponse.json()).status, "failed");
  await expiryWinsLockExit;
  await workers[expiryWinsWorkerIndex];
  assert.equal(providerRequests, expiryWinsRequestBaseline + 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_generation_jobs where id='${expiryWinsBody.jobId}' and state='expired'`), 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${expiryWinsBody.jobId}'`), 0,
    "a save queued behind an expired job must not create a bundle");
  console.log("PASS: D16 save/read lock race preserved success when save won; expiry won when GET expired the job first");

  // D07: after the leading client's request is answered, disconnect its
  // signal while the owned worker is in the provider call. A later client
  // must join that same job and read the single committed success.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('d07-client-disconnect-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerResponses = [providerOutput]; mockResponseIndex = 0;
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  providerStarted = new Promise(resolve => { releaseProviderStarted = resolve; });
  const d07RequestBaseline = providerRequests;
  const d07WorkerIndex = workers.length;
  const leadingClient = new AbortController();
  const d07Start = await handler(startRequest(leadingClient.signal));
  assert.equal(d07Start.status, 202);
  const d07StartBody = await d07Start.json();
  await providerStarted;
  leadingClient.abort();
  assert.equal(leadingClient.signal.aborted, true, "the leading client's connection must be marked disconnected");
  const laterClientStart = await handler(startRequest());
  assert.equal(laterClientStart.status, 202);
  const laterClientBody = await laterClientStart.json();
  assert.equal(laterClientBody.jobId, d07StartBody.jobId, "later participant must join the active shared job");
  assert.equal(providerRequests, d07RequestBaseline + 1, "the shared job must issue one provider request");
  releaseProviderGate(); providerGate = null; providerStarted = null;
  await workers[d07WorkerIndex];
  const laterClientRead = await handler(new Request(`http://local.test/functions/v1/predictions?action=prediction-job&jobId=${d07StartBody.jobId}`, { headers }));
  assert.equal(laterClientRead.status, 200);
  const d07Result = await laterClientRead.json();
  assert.equal(d07Result.status, "success");
  assert.deepEqual(d07Result.main, providerOutput.main);
  assert.equal(d07Result.narrative, providerOutput.narrative);
  assert.equal(providerRequests, d07RequestBaseline + 1, "later read must not start another provider request");
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${d07StartBody.jobId}'`), 1, "disconnected client's job must save exactly one bundle");
  console.log("PASS: D07 disconnected leading client; worker completed one shared job and later client read the same success through real local PostgREST + mock provider");

  // M07 partial: simulate a handler redeploy with legacy mode while an AI job
  // is in flight. The already admitted worker must keep its frozen AI config;
  // the legacy handler must still read that job, while old-contract requests
  // take the legacy path without creating another AI job/provider request.
  psql("update race_data.race_components set raw_json=jsonb_set(raw_json,'{subtitle}',to_jsonb('m07-mode-switch-fixture'::text)) where id='a1900000-0000-4000-8000-000000000013';");
  providerResponses = [providerOutput]; mockResponseIndex = 0;
  providerGate = new Promise(resolve => { releaseProviderGate = resolve; });
  providerStarted = new Promise(resolve => { releaseProviderStarted = resolve; });
  const m07RequestBaseline = providerRequests;
  const m07JobBaseline = scalar("select count(*) from race_prediction.ai_generation_jobs");
  const m07WorkerIndex = workers.length;
  const m07Start = await handler(startRequest()); assert.equal(m07Start.status, 202);
  const m07StartBody = await m07Start.json(); await providerStarted;
  vars.PREDICTION_MODE = "legacy";
  await import(`../../supabase/functions/predictions/index.ts?local-db-legacy-redeploy=${Date.now()}`);
  const legacyModeHandler = globalThis.__v019FixtureHandler;
  assert.equal(typeof legacyModeHandler, "function");
  const m07ReadUrl = `http://local.test/functions/v1/predictions?action=prediction-job&jobId=${m07StartBody.jobId}`;
  const m07PendingRead = await legacyModeHandler(new Request(m07ReadUrl, { headers }));
  assert.equal(m07PendingRead.status, 202, "legacy-mode handler must preserve reads for an admitted AI job");
  assert.equal((await m07PendingRead.json()).jobId, m07StartBody.jobId);
  const legacyNoDataPost = await legacyModeHandler(new Request("http://local.test/functions/v1/predictions", {
    method: "POST", headers, body: JSON.stringify({ raceDate: "1900-01-01", stadiumCode: 24, raceNumber: 12 }),
  }));
  assert.equal(legacyNoDataPost.status, 404, "old-contract POST must enter legacy read path after mode switch");
  assert.equal((await legacyNoDataPost.json()).errorCode, "race_not_found");
  assert.equal(providerRequests, m07RequestBaseline + 1, "legacy request must not call the AI provider");
  assert.equal(scalar("select count(*) from race_prediction.ai_generation_jobs") , m07JobBaseline + 1,
    "legacy request must not create an AI job");
  releaseProviderGate(); providerGate = null; providerStarted = null;
  await workers[m07WorkerIndex];
  const m07CompletedRead = await legacyModeHandler(new Request(m07ReadUrl, { headers }));
  assert.equal(m07CompletedRead.status, 200, "legacy-mode handler must read the completed AI result");
  const m07CompletedBody = await m07CompletedRead.json();
  assert.match(m07CompletedBody.snapshotId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(m07CompletedBody.main, providerOutput.main);
  assert.equal(m07CompletedBody.narrative, providerOutput.narrative);
  const m07RepeatedRead = await legacyModeHandler(new Request(m07ReadUrl, { headers }));
  assert.equal((await m07RepeatedRead.json()).snapshotId, m07CompletedBody.snapshotId,
    "completed bundle identity must remain stable across the legacy-mode read");
  assert.equal(providerRequests, m07RequestBaseline + 1);
  assert.equal(scalar(`select count(*) from race_prediction.ai_prediction_bundles where job_id='${m07StartBody.jobId}'`), 1);
  vars.PREDICTION_MODE = "ai_bundle";
  console.log("PASS: M07 handler-level legacy redeploy kept active AI job readable through completion; old-contract request used legacy path without another AI call");

  diagnosticEvents = diagnosticLines.map((line) => { try { return JSON.parse(line).event; } catch { return null; } });
  assert.ok(diagnosticEvents.includes("retry.scheduled"));
  assert.ok(diagnosticEvents.includes("retry.stopped"));
  console.log("PASS: real local Edge handler + PostgREST completed claim/attempt/save/read/reuse; missing preview reached mocked provider without blocking six valid entries");
  console.log("PASS: fetched/confirmed timestamp-only update reused the saved bundle and preserved the original provenance snapshot");
  console.log("PASS: post-deadline START rejected cached success while GET of the already-started job remained available");
  console.log("PASS: 20 concurrent START requests shared one job owner and caused one mock provider request");
  console.log(`PASS: staggered STARTs at +0s/+30s shared one job; one result completed at ${Math.round(staggeredElapsedMs / 1000)}s`);
  console.log("PASS: expired job GET did not restart generation; a later START replaced the job and only the replacement saved");
  console.log("PASS: a source change during generation created a second job while both jobs retained their own immutable input");
  console.log("PASS: lost finish-RPC response after commit was recovered by job GET with one bundle and one successful attempt");
  console.log("PASS: changing only the model configuration created a new job/bundle instead of reusing the previous result");
  console.log("PASS: duplicate output was repaired; blank/missing/malformed output stopped after two attempts without partial save");
  console.log("PASS: provider HTTP 401/403/404 stopped without retry, hidden provider body, or saved bundle");
  console.log("PASS: admitted job completed after close time using its frozen input and one bounded repair");
  console.log(`PASS: locked claim stopped safely in ${lockElapsedMs}ms under a 2s budget without calling provider`);
  console.log("PASS: lost begin-attempt response recorded an unknown attempt and closed the job retryably without calling provider");
  console.log("PASS: D02 and G13 save-failure/config-freeze scenarios completed against local PostgREST and mock provider");
  console.log("INFO: fixture and generated DB rows are removed in finally; no Gemini or hosted Supabase request");
} finally {
  if (fetchMocked) {
    globalThis.fetch = previousFetch;
    if (previousDeno === undefined) delete globalThis.Deno; else globalThis.Deno = previousDeno;
    if (previousEdgeRuntime === undefined) delete globalThis.EdgeRuntime; else globalThis.EdgeRuntime = previousEdgeRuntime;
    if (previousConsoleInfo) console.info = previousConsoleInfo;
    delete globalThis.__v019FixtureHandler;
  }
  if (seeded) runFile("./cleanup-ai-generation-fixture.sql");
}
