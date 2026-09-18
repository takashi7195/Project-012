const MAX_BYTES = 8 * 1024 * 1024;

function jstDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function datePath(date) {
  return String(date).replaceAll("-", "");
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) return { value: await response.json(), bytes: 0 };
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) throw Object.assign(new Error("response too large"), { code: "UPSTREAM_TOO_LARGE" });
    chunks.push(value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return { value: JSON.parse(new TextDecoder().decode(merged)), bytes };
}

function validRace(race, stadiumCode, raceNumber) {
  if (!race || typeof race !== "object") return false;
  if (!Array.isArray(Object.keys(race.racers ?? {})) || Object.keys(race.racers ?? {}).length !== 6) return false;
  if (Number(race.stadium_number) !== stadiumCode || Number(race.race_number) !== raceNumber) return false;
  return Object.values(race.racers).every((racer) => Number.isFinite(Number(racer?.entry_number)) && typeof racer?.name === "string");
}

export function cacheKey(date, stadiumCode, raceNumber) {
  return `${datePath(date)}:${String(stadiumCode).padStart(2, "0")}:${raceNumber}`;
}

export function buildUpstreamUrl(date) {
  const year = String(date).slice(0, 4);
  return `https://boatraceopenapi.github.io/api/v1/${year}/${datePath(date)}.json`;
}

export async function fetchRace(date = jstDate(), stadiumCode, raceNumber, fetchImpl = fetch) {
  const url = buildUpstreamUrl(date);
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw Object.assign(new Error("upstream request failed"), { code: "UPSTREAM_NETWORK", cause: error });
  }
  if (!response.ok) throw Object.assign(new Error(`upstream http ${response.status}`), { code: response.status === 404 ? "UPSTREAM_NOT_FOUND" : response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_HTTP", status: response.status });
  const { value, bytes } = await readJson(response);
  const race = value?.programs?.stadiums?.[String(stadiumCode)]?.races?.[String(raceNumber)];
  if (!validRace(race, stadiumCode, raceNumber)) throw Object.assign(new Error("race data missing or invalid"), { code: "UPSTREAM_INVALID" });
  const text = JSON.stringify(race);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const sourceHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  const informationStatus = Object.keys(race.preview?.racers ?? {}).length === 6 ? "ready_preview" : "ready_entry";
  return { date, stadiumCode, raceNumber, race, sourceHash, informationStatus, responseBytes: bytes, sourceUrl: url };
}

export { jstDate };
