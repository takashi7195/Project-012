/** Resolve the public client key without ever consulting a service-role key. */
export function resolvePublicClientKey(env = {}) {
  const encoded = typeof env.SUPABASE_PUBLISHABLE_KEYS === "string" ? env.SUPABASE_PUBLISHABLE_KEYS : "";
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded);
      if (parsed && typeof parsed.default === "string" && parsed.default.trim()) return parsed.default.trim();
    } catch {
      // A malformed optional value must not prevent the Function from starting.
    }
  }
  for (const candidate of [env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_ANON_KEY]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

/** Validate the intentionally public client credential at the handler boundary.
 * This is an abuse-control gate, not a user identity assertion. Never use a
 * service-role or secret key here.
 */
export function isAuthorizedPublicClient(request, { publishableKey = "", anonKey = "" } = {}) {
  const presented = request.headers.get("apikey") ?? "";
  const expected = publishableKey || anonKey;
  return Boolean(expected && presented && presented === expected);
}
