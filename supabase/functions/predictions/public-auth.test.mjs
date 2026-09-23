import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedPublicClient, resolvePublicClientKey } from "./public-auth.mjs";

function request(headers = {}) { return new Request("http://localhost/functions/v1/predictions", { method: "POST", headers }); }

test("publishable key is accepted only in the apikey header", () => {
  assert.equal(isAuthorizedPublicClient(request({ apikey: "sb_publishable_test" }), { publishableKey: "sb_publishable_test" }), true);
  assert.equal(isAuthorizedPublicClient(request({ Authorization: "Bearer sb_publishable_test" }), { publishableKey: "sb_publishable_test" }), false);
  assert.equal(isAuthorizedPublicClient(request({ apikey: "wrong" }), { publishableKey: "sb_publishable_test" }), false);
  assert.equal(isAuthorizedPublicClient(request(), { publishableKey: "sb_publishable_test" }), false);
});

test("SUPABASE_PUBLISHABLE_KEYS default has priority over legacy values", () => {
  assert.equal(resolvePublicClientKey({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_default" }), SUPABASE_PUBLISHABLE_KEY: "legacy", SUPABASE_ANON_KEY: "anon" }), "sb_publishable_default");
});

test("legacy key fallbacks and malformed JSON are safe", () => {
  assert.equal(resolvePublicClientKey({ SUPABASE_PUBLISHABLE_KEYS: "{bad", SUPABASE_PUBLISHABLE_KEY: "legacy" }), "legacy");
  assert.equal(resolvePublicClientKey({ SUPABASE_PUBLISHABLE_KEYS: "{bad", SUPABASE_ANON_KEY: "anon" }), "anon");
  assert.equal(resolvePublicClientKey({ SUPABASE_PUBLISHABLE_KEYS: "{bad" }), "");
});

test("service-role-looking values are not implicitly accepted", () => {
  assert.equal(isAuthorizedPublicClient(request({ apikey: "service_role_secret" }), { publishableKey: "sb_publishable_test" }), false);
});
