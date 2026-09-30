import test from "node:test";
import assert from "node:assert/strict";

const jobId = "11111111-1111-4111-8111-111111111111";
const ownerToken = "22222222-2222-4222-8222-222222222222";
const identity = { raceDate: "2026-09-26", stadiumCode: 1, raceNumber: 1 };
const previewRaw = { racers: { 1: { course_number: 1, start_timing: "0.12" } } };
const programRaw = { ...identity, date: identity.raceDate, stadium_number: 1, race_number: 1,
  racers: Object.fromEntries([1, 2, 3, 4, 5, 6].map((entry_number) => [String(entry_number), { entry_number, name: `選手${entry_number}` }])) };
const output = { main: [1, 2, 3], counter: [1, 3, 2], hole: [4, 5, 6], narrative: "1号艇が先行する展開を想定。" };
const vars = { SUPABASE_URL: "https://local.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  SUPABASE_PUBLISHABLE_KEY: "fixture-public-key", PREDICTION_MODE: "ai_bundle", GEMINI_API_KEY: "fixture-gemini-key" };
let handler;
let worker;
let calls;
let previousFetch;

test("Edge handler authorizes, starts one shared job, runs background generation and reads saved output", async () => {
  previousFetch = globalThis.fetch;
  globalThis.Deno = { env: { get: (key) => vars[key], toObject: () => ({ ...vars }) }, serve: (value) => { handler = value; } };
  globalThis.EdgeRuntime = { waitUntil: (promise) => { worker = promise; } };
  calls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] }, finishReason: "STOP" }] });
    }
    const name = String(url).split("/").at(-1);
    const body = JSON.parse(options.body ?? "{}");
    calls.push({ name, body });
    const responses = {
      race_prediction_get_ai_input: { identity, raceId: "33333333-3333-4333-8333-333333333333", programRaw,
        previewRaw, presence: { program: "value", preview: "value" }, provenance: { sourceCode: "fixture", fetchedAt: "2026-09-26T00:00:00Z" },
        closedAt: new Date(Date.now() + 60_000).toISOString() },
      race_prediction_claim_ai_job: { state: "created", jobId, ownerToken, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      race_prediction_begin_ai_attempt: { sendAuthorized: true },
      race_prediction_finish_ai_attempt: true,
      race_prediction_finish_ai_job: { saved: true, bundleId: "44444444-4444-4444-8444-444444444444" },
      race_prediction_read_ai_job: { state: "succeeded", prediction: { snapshotId: "44444444-4444-4444-8444-444444444444", ...output } },
    };
    return Response.json(responses[name] ?? null);
  };
  try {
    await import(`../supabase/functions/predictions/index.ts?edge-test=${Date.now()}`);
    const auth = { apikey: vars.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" };
    const denied = await handler(new Request("https://local.invalid/functions/v1/predictions", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    assert.equal(denied.status, 401);
    const started = await handler(new Request("https://local.invalid/functions/v1/predictions", { method: "POST", headers: auth,
      body: JSON.stringify({ action: "generate", ...identity, contractVersion: "ai-bundle-v1" }) }));
    assert.equal(started.status, 202);
    assert.equal((await started.json()).jobId, jobId);
    assert.equal(typeof worker?.then, "function");
    await worker;
    assert.equal(calls.filter(({ name }) => name === "race_prediction_claim_ai_job").length, 1);
    assert.equal(calls.filter(({ name }) => name === "race_prediction_finish_ai_job").length, 1);
    const read = await handler(new Request(`https://local.invalid/functions/v1/predictions?action=prediction-job&jobId=${jobId}`, { headers: auth }));
    assert.equal(read.status, 200);
    const result = await read.json();
    assert.deepEqual(result.main, output.main);
    assert.equal(result.narrative, output.narrative);
    assert.equal(result.status, "success");
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.Deno;
    delete globalThis.EdgeRuntime;
    delete globalThis.__handler;
    delete globalThis.__worker;
  }
});

test("Edge handler rejects invalid inputs and maps missing, closed, cached, busy and RPC-error states", async (t) => {
  const edgeIdentity = { raceDate: "2099-12-31", stadiumCode: 1, raceNumber: 1 };
  const edgeProgram = { ...edgeIdentity, date: edgeIdentity.raceDate, stadium_number: 1, race_number: 1,
    racers: Object.fromEntries([1, 2, 3, 4, 5, 6].map((entry_number) => [String(entry_number), { entry_number }])) };
  const source = { identity: edgeIdentity, raceId: "33333333-3333-4333-8333-333333333333", programRaw: edgeProgram,
    previewRaw: null, presence: { program: "value", preview: "missing" }, provenance: {},
    closedAt: new Date(Date.now() + 60_000).toISOString() };
  const cached = { id: "44444444-4444-4444-8444-444444444444", ...output };
  const env = { SUPABASE_URL: "https://local.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    SUPABASE_PUBLISHABLE_KEY: "fixture-public-key", PREDICTION_MODE: "ai_bundle" };
  let mode = "missing";
  let apiCalls = [];
  const priorFetch = globalThis.fetch;
  globalThis.Deno = { env: { get: (key) => env[key], toObject: () => ({ ...env }) }, serve: (value) => { handler = value; } };
  globalThis.EdgeRuntime = { waitUntil: () => { throw new Error("unexpected background worker"); } };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("generativelanguage.googleapis.com")) { apiCalls.push("gemini"); throw new Error("unexpected Gemini request in this mock case"); }
    const name = String(url).split("/").at(-1);
    apiCalls.push(name);
    if (name === "race_prediction_get_ai_input") {
      if (mode === "rpc_error") return Response.json({ error: "fixture" }, { status: 500 });
      if (mode === "identity_mismatch") return Response.json({ ...source, identity: { ...edgeIdentity, raceNumber: 2 } });
      if (mode === "invalid_entries") return Response.json({ ...source, programRaw: { ...edgeProgram, racers: { 1: {} } } });
      if (mode.startsWith("entries_")) {
        const racers = Object.fromEntries([1,2,3,4,5,6].map(n => [String(n), { entry_number:n }]));
        if (mode === "entries_five") delete racers["6"];
        if (mode === "entries_duplicate") racers["6"].entry_number=5;
        if (mode === "entries_out_of_range") racers["6"].entry_number=7;
        if (mode === "entries_null") racers["6"]=null;
      if (mode === "entries_mismatch") racers["6"].entry_number=5;
        return Response.json({ ...source, programRaw: { ...edgeProgram, racers } });
      }
      if (mode === "closed") return Response.json({ ...source, closedAt: new Date(Date.now() - 1000).toISOString() });
      if (mode === "deadline_missing") return Response.json({ ...source, closedAt: null });
      if (mode === "deadline_invalid") return Response.json({ ...source, closedAt: "not-a-date" });
      return Response.json(mode === "missing" ? null : source);
    }
    if (name === "race_prediction_claim_ai_job") {
      if (mode === "cached") return Response.json({ state: "existing", prediction: cached });
      if (mode === "busy") return Response.json({ state: "busy", jobId, expiresAt: new Date(Date.now() + 10_000).toISOString() });
      if (mode === "rejected") return Response.json({ state: "rejected" });
      if (mode === "invalid_claim") return Response.json({ state: "unknown" });
      if (mode === "worker_missing") return Response.json({ state: "created", jobId, ownerToken, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    if (name === "race_prediction_fail_ai_job") return Response.json(true);
    if (name === "race_prediction_read_ai_job") {
      if (mode === "read_missing") return Response.json(null);
      if (mode === "read_generating") return Response.json({ state: "generating", expiresAt: new Date(Date.now() + 10_000).toISOString() });
      if (mode === "read_failed") return Response.json({ state: "failed", retryable: false });
    }
    return Response.json(null);
  };
  try {
    await import(`../supabase/functions/predictions/index.ts?edge-cases=${Date.now()}`);
    const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" };
    const requestStart = () => handler(new Request("https://local.invalid/functions/v1/predictions", { method: "POST", headers,
      body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", ...edgeIdentity }) }));
    const requestStartWith = (overrides) => handler(new Request("https://local.invalid/functions/v1/predictions", { method: "POST", headers,
      body: JSON.stringify({ action: "generate", contractVersion: "ai-bundle-v1", ...edgeIdentity, ...overrides }) }));
    const requestRead = (id = jobId) => handler(new Request(`https://local.invalid/functions/v1/predictions?action=prediction-job&jobId=${id}`, { headers }));

    await t.test("contract mismatch is rejected before RPC", async () => {
      apiCalls = [];
      const response = await handler(new Request("https://local.invalid/functions/v1/predictions", { method: "POST", headers,
        body: JSON.stringify({ action: "generate", contractVersion: "old-contract", ...edgeIdentity }) }));
      assert.equal(response.status, 409);
      assert.deepEqual(apiCalls, []);
    });
    await t.test("malformed race date is rejected before RPC", async () => {
      apiCalls = [];
      const response = await requestStartWith({ raceDate: "2026/09/28" });
      assert.equal(response.status, 400);
      assert.deepEqual(apiCalls, []);
    });
    await t.test("missing and unidentifiable DB source fail closed before claim", async () => {
      for (const [selected, expectedStatus] of [["missing", 404], ["identity_mismatch", 422], ["invalid_entries", 422]]) {
        mode = selected; apiCalls = [];
        assert.equal((await requestStart()).status, expectedStatus, selected);
        assert.equal(apiCalls.includes("race_prediction_claim_ai_job"), false, selected);
      }
    });
    await t.test("I06 every unidentifiable six-boat pattern stops before claim and Gemini", async () => {
      for (const invalid of ["entries_five","entries_duplicate","entries_out_of_range","entries_null","entries_mismatch"]) {
        mode=invalid; apiCalls=[];
        const response=await requestStart();
        assert.equal(response.status,422,invalid);
        assert.equal(apiCalls.includes("race_prediction_claim_ai_job"),false,invalid);
        assert.equal(apiCalls.includes("gemini"),false,invalid);
      }
    });
    await t.test("closed race stops before a claim", async () => {
      mode = "closed"; apiCalls = [];
      const response = await requestStart();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, "closed");
      assert.equal(apiCalls.includes("race_prediction_claim_ai_job"), false);
    });
    await t.test("missing or malformed close time stops before a claim", async () => {
      for (const invalid of ["deadline_missing", "deadline_invalid"]) {
        mode = invalid; apiCalls = [];
        const response = await requestStart();
        assert.equal(response.status, 200, invalid);
        assert.equal((await response.json()).status, "closed", invalid);
        assert.equal(apiCalls.includes("race_prediction_claim_ai_job"), false, invalid);
        assert.equal(apiCalls.includes("gemini"), false, invalid);
      }
    });
    await t.test("successful cache and busy claims are returned without another generation", async () => {
      mode = "cached";
      const cachedResponse = await requestStart();
      assert.equal(cachedResponse.status, 200);
      assert.equal((await cachedResponse.json()).reused, true);
      mode = "busy";
      const busyResponse = await requestStart();
      assert.equal(busyResponse.status, 202);
      assert.equal((await busyResponse.json()).jobId, jobId);
    });
    await t.test("rejected and malformed claims map to closed and retryable failure", async () => {
      mode = "rejected";
      assert.equal((await (await requestStart()).json()).status, "closed");
      mode = "invalid_claim";
      const failed = await requestStart();
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).retryable, true);
    });
    await t.test("unavailable Edge background runtime fails the claimed job without calling Gemini", async () => {
      mode = "worker_missing"; apiCalls = [];
      globalThis.EdgeRuntime = undefined;
      const failed = await requestStart();
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).retryable, true);
      assert.equal(apiCalls.includes("race_prediction_fail_ai_job"), true);
      assert.equal(apiCalls.includes("gemini"), false);
      globalThis.EdgeRuntime = { waitUntil: () => { throw new Error("unexpected background worker"); } };
    });
    await t.test("job reads map missing, generating and nonretryable failure states", async () => {
      mode = "read_missing";
      assert.equal((await requestRead()).status, 404);
      mode = "read_generating";
      assert.equal((await requestRead()).status, 202);
      mode = "read_failed";
      const failed = await requestRead();
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).retryable, false);
    });
    await t.test("database RPC errors return a generic retryable failure", async () => {
      mode = "rpc_error";
      const response = await requestStart();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: "failed", retryable: true, mode: "ai_bundle", contractVersion: "ai-bundle-v1" });
    });
  } finally {
    globalThis.fetch = priorFetch;
    delete globalThis.Deno;
    delete globalThis.EdgeRuntime;
  }
});
