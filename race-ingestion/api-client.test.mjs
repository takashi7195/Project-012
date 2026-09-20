import assert from "node:assert/strict";
import test from "node:test";
import { fetchDailyJson } from "./api-client.mjs";

test("fetches JSON with bounded metadata", async () => {
  const result = await fetchDailyJson("2026-09-20", { fetchImpl: async (url, options) => {
    assert.match(url, /2026\/20260920\.json$/);
    assert.equal(options.headers.Accept, "application/json");
    return new Response('{"programs":{"stadiums":{}}}', { status: 200, headers: { etag: '"abc"', "last-modified": "yesterday" } });
  } });
  assert.equal(result.status, "fetched");
  assert.equal(result.json.programs.stadiums.constructor, Object);
  assert.equal(result.etag, '"abc"');
  assert.match(result.bodyHash, /^[a-f0-9]{64}$/);
});

test("handles a conditional 304 without parsing a body", async () => {
  const result = await fetchDailyJson("2026-09-20", { etag: '"abc"', fetchImpl: async (_url, options) => {
    assert.equal(options.headers["If-None-Match"], '"abc"');
    return new Response(null, { status: 304 });
  } });
  assert.equal(result.status, "not_modified");
});

test("classifies an oversized body", async () => {
  await assert.rejects(() => fetchDailyJson("2026-09-20", { maxBodyBytes: 8, fetchImpl: async () => new Response('{"too":"large"}', { status: 200 }) }), (error) => error.code === "payload_too_large");
});

test("classifies timeout separately", async () => {
  await assert.rejects(() => fetchDailyJson("2026-09-20", { timeoutMs: 5, fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); })) }), (error) => error.code === "fetch_timeout");
});
