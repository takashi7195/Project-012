import { buildUpstreamUrl, cacheKey, fetchRace, jstDate } from "./provider.mjs";
import { predictRace } from "./predictor.mjs";

const projectUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = new Set(["https://takashi7195.github.io", "http://127.0.0.1:8012", "http://localhost:8012"]);
const memoryCache = new Map<string, { race: any; sourceHash: string; informationStatus: string; fetchedAt: string; sourceUrl: string }>();
let lastMemoryFetchAt = 0;
const headers = (origin: string) => ({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Vary": "Origin" });
const json = (body: unknown, status: number, origin: string) => new Response(JSON.stringify(body), { status, headers: { ...headers(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function rest(path: string, init: RequestInit = {}) {
  if (!projectUrl || !serviceRoleKey) throw new Error("config missing");
  return fetch(`${projectUrl}/rest/v1/${path}`, { ...init, headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
}

function validateInput(value: unknown) {
  const body = value as Record<string, unknown>;
  const stadiumCode = Number(body?.stadiumCode);
  const raceNumber = Number(body?.raceNumber);
  if (!Number.isInteger(stadiumCode) || stadiumCode < 1 || stadiumCode > 24 || !Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 12) throw Object.assign(new Error("invalid input"), { code: "INPUT_INVALID" });
  return { stadiumCode, raceNumber };
}

async function getCached(date: string, stadiumCode: number, raceNumber: number) {
  const key = cacheKey(date, stadiumCode, raceNumber);
  const response = await rest(`race_data_cache?cache_key=eq.${encodeURIComponent(key)}&select=payload,source_hash,information_status,fetched_at`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("cache read failed");
  const [row] = await response.json();
  if (!row) return null;
  return { race: row.payload, sourceHash: row.source_hash, informationStatus: row.information_status, fetchedAt: row.fetched_at, sourceUrl: buildUpstreamUrl(date) };
}

async function saveCache(data: any) {
  const key = cacheKey(data.date, data.stadiumCode, data.raceNumber);
  const response = await rest("race_data_cache?on_conflict=cache_key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ cache_key: key, race_date: data.date, stadium_code: data.stadiumCode, race_number: data.raceNumber, payload: data.race, source_hash: data.sourceHash, information_status: data.informationStatus, fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  if (!response.ok) throw new Error("cache write failed");
}

async function fetchOrCache(date: string, stadiumCode: number, raceNumber: number) {
  const memoryKey = cacheKey(date, stadiumCode, raceNumber);
  const memory = memoryCache.get(memoryKey);
  if (memory && Date.now() - Date.parse(memory.fetchedAt) < 180_000) return memory;
  let cached = null;
  try {
    cached = await getCached(date, stadiumCode, raceNumber);
  } catch {
    // The function can still serve a live prediction while the optional cache
    // migration is being rolled out. It never falls back to scraping the
    // official site.
    if (Date.now() - lastMemoryFetchAt < 180_000) {
      if (memory) return memory;
      throw Object.assign(new Error("fetch busy"), { code: "FETCH_BUSY" });
    }
    const fetched = await fetchRace(date, stadiumCode, raceNumber);
    const result = { race: fetched.race, sourceHash: fetched.sourceHash, informationStatus: fetched.informationStatus, fetchedAt: new Date().toISOString(), sourceUrl: fetched.sourceUrl };
    memoryCache.set(memoryKey, result);
    lastMemoryFetchAt = Date.now();
    return result;
  }
  const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && age < 180_000) return cached;

  const claim = await rest("rpc/claim_race_fetch", { method: "POST", body: JSON.stringify({ p_fetch_date: date, p_min_interval_seconds: 180 }) });
  if (!claim.ok) throw new Error("fetch claim failed");
  const claimed = await claim.json();
  if (!claimed) {
    if (cached) return cached;
    throw Object.assign(new Error("fetch busy"), { code: "FETCH_BUSY" });
  }
  try {
    const fetched = await fetchRace(date, stadiumCode, raceNumber);
    const result = { race: fetched.race, sourceHash: fetched.sourceHash, informationStatus: fetched.informationStatus, fetchedAt: new Date().toISOString(), sourceUrl: fetched.sourceUrl };
    memoryCache.set(memoryKey, result);
    lastMemoryFetchAt = Date.now();
    await saveCache(fetched);
    await rest("rpc/finish_race_fetch", { method: "POST", body: JSON.stringify({ p_fetch_date: date, p_success: true, p_response_bytes: fetched.responseBytes }) });
    return result;
  } catch (error) {
    await rest("rpc/finish_race_fetch", { method: "POST", body: JSON.stringify({ p_fetch_date: date, p_success: false, p_error_code: error?.code ?? "UPSTREAM_ERROR" }) }).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.has(origin)) return new Response("Forbidden", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);
  try {
    const input = validateInput(await request.json());
    const date = jstDate();
    const data = await fetchOrCache(date, input.stadiumCode, input.raceNumber);
    const result = predictRace(data.race, { ...data, fetchedAt: data.fetchedAt });
    return json({ raceKey: `${date}:${String(input.stadiumCode).padStart(2, "0")}:${input.raceNumber}`, closedAt: data.race.closed_at, ...result }, 200, origin);
  } catch (error) {
    const code = error?.code ?? "PREDICTION_ERROR";
    console.warn(JSON.stringify({ event: "race_prediction_diagnostic", code }));
    const status = code === "INPUT_INVALID" ? 400 : code === "UPSTREAM_NOT_FOUND" ? 404 : code === "FETCH_BUSY" ? 503 : 502;
    return json({ error: "実レース情報を取得できませんでした", code }, status, origin);
  }
});
