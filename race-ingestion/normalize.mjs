import { createHash } from "node:crypto";

export const PARSER_VERSION = "v0.1.11-normalizer-1";
export const RULES_VERSION = "v0.1.11-rules-1";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const asNullableNumber = (value) => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const asNullableText = (value) => value === null || value === undefined ? null : String(value);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function canonicalJson(value) { return JSON.stringify(stable(value)); }
export function sha256Json(value) { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }

function issue(code, path, details = {}) { return { code, path, ...details }; }

function getRaces(raw, issues) {
  if (!isObject(raw) || !isObject(raw.programs) || !isObject(raw.programs.stadiums)) {
    issues.push(issue("unsupported_shape", "programs.stadiums"));
    return [];
  }
  const races = [];
  for (const [stadiumKey, stadium] of Object.entries(raw.programs.stadiums)) {
    if (!isObject(stadium) || !isObject(stadium.races)) {
      issues.push(issue("unsupported_shape", `programs.stadiums.${stadiumKey}.races`));
      continue;
    }
    for (const [raceKey, race] of Object.entries(stadium.races)) {
      const path = `programs.stadiums.${stadiumKey}.races.${raceKey}`;
      if (!isObject(race)) { issues.push(issue("unsupported_shape", path)); continue; }
      const date = asNullableText(race.date);
      const stadiumNumber = asNullableNumber(race.stadium_number);
      const raceNumber = asNullableNumber(race.race_number);
      if (date === null || stadiumNumber === null || raceNumber === null) {
        issues.push(issue("identity_mismatch", path, { key: { stadiumKey, raceKey }, value: { date, stadiumNumber, raceNumber } }));
        continue;
      }
      if (String(Math.trunc(stadiumNumber)) !== String(stadiumKey) || String(Math.trunc(raceNumber)) !== String(raceKey)) {
        issues.push(issue("identity_mismatch", path, { key: { stadiumKey, raceKey }, value: { stadiumNumber, raceNumber } }));
        continue;
      }
      races.push(normalizeRace(race, path, { date, stadiumNumber: Math.trunc(stadiumNumber), raceNumber: Math.trunc(raceNumber) }, issues));
    }
  }
  return races;
}

function normalizeEntries(entries, path, issues, kind) {
  if (entries === undefined) return { presence: "missing", rows: [] };
  if (entries === null) return { presence: "null", rows: [] };
  if (!isObject(entries)) { issues.push(issue("unsupported_shape", `${path}.racers`)); return { presence: "invalid", rows: [] }; }
  const rows = [];
  for (const [entryKey, entry] of Object.entries(entries)) {
    const entryNumber = asNullableNumber(entry?.entry_number ?? entryKey);
    if (!isObject(entry) || entryNumber === null || entryNumber < 1 || entryNumber > 6) {
      issues.push(issue("invalid_entry", `${path}.racers.${entryKey}`)); continue;
    }
    const row = { entryNumber: Math.trunc(entryNumber), raw: entry };
    if (kind === "program") Object.assign(row, {
      name: asNullableText(entry.name), registrationNumber: asNullableNumber(entry.number),
      rank: asNullableText(entry.rank_number_source ?? entry.rank_number), age: asNullableNumber(entry.age),
      weightKg: asNullableNumber(entry.weight), flyingCount: asNullableNumber(entry.flying_count),
      lateCount: asNullableNumber(entry.late_count), averageStartTiming: asNullableNumber(entry.average_start_timing),
      nationalWinRate: asNullableNumber(entry.national_win_rate), nationalTop2Percent: asNullableNumber(entry.national_top_2_percent), nationalTop3Percent: asNullableNumber(entry.national_top_3_percent),
      localWinRate: asNullableNumber(entry.local_win_rate), localTop2Percent: asNullableNumber(entry.local_top_2_percent), localTop3Percent: asNullableNumber(entry.local_top_3_percent),
      motorNumber: asNullableNumber(entry.motor_number), motorTop2Percent: asNullableNumber(entry.motor_top_2_percent), motorTop3Percent: asNullableNumber(entry.motor_top_3_percent),
      hullNumber: asNullableNumber(entry.boat_number), hullTop2Percent: asNullableNumber(entry.boat_top_2_percent), hullTop3Percent: asNullableNumber(entry.boat_top_3_percent),
    });
    if (kind === "preview") Object.assign(row, {
      course: asNullableNumber(entry.course_number), startTiming: asNullableNumber(entry.start_timing), weightKg: asNullableNumber(entry.weight),
      weightAdjustmentKg: asNullableNumber(entry.weight_adjustment), exhibitionTime: asNullableNumber(entry.exhibition_time), tilt: asNullableNumber(entry.tilt_adjustment),
      propeller: hasOwn(entry, "propeller") ? entry.propeller : undefined, parts: hasOwn(entry, "parts") ? entry.parts : undefined,
    });
    if (kind === "result") Object.assign(row, {
      course: asNullableNumber(entry.course_number), startTiming: asNullableNumber(entry.start_timing),
      placeCode: asNullableText(entry.place_number_source), placeNumber: asNullableNumber(entry.place_number),
      registrationNumber: asNullableNumber(entry.number), name: asNullableText(entry.name),
    });
    rows.push(row);
  }
  return { presence: "value", rows: rows.sort((a, b) => a.entryNumber - b.entryNumber) };
}

function normalizePhase(phase, path, issues, kind) {
  if (phase === undefined) return { presence: "missing", raw: undefined, rows: [] };
  if (phase === null) return { presence: "null", raw: null, rows: [] };
  if (!isObject(phase)) { issues.push(issue("unsupported_shape", path)); return { presence: "invalid", raw: phase, rows: [] }; }
  const entries = normalizeEntries(phase.racers, path, issues, kind);
  const common = {
    date: asNullableText(phase.date), stadiumNumber: asNullableNumber(phase.stadium_number), raceNumber: asNullableNumber(phase.race_number),
    windSpeed: asNullableNumber(phase.wind_speed), windDirection: asNullableNumber(phase.wind_direction_number), waveHeight: asNullableNumber(phase.wave_height),
    weather: asNullableNumber(phase.weather_number), airTemperature: asNullableNumber(phase.air_temperature), waterTemperature: asNullableNumber(phase.water_temperature),
  };
  if (kind === "program") Object.assign(common, {
    closedAtSource: asNullableText(phase.closed_at), title: asNullableText(phase.title), subtitle: asNullableText(phase.subtitle), grade: asNullableText(phase.grade_number_source ?? phase.grade_number), distanceM: asNullableNumber(phase.distance), dayNumber: asNullableNumber(phase.day_number),
  });
  if (kind === "result") Object.assign(common, { technique: asNullableText(phase.technique_number_source ?? phase.technique_number), remarks: hasOwn(phase, "remarks") ? phase.remarks : undefined });
  return { presence: "value", raw: phase, common, rows: entries.rows, entriesPresence: entries.presence, payouts: kind === "result" ? normalizePayouts(phase.payouts, path, issues) : { presence: "missing", rows: [] }, refunds: kind === "result" ? normalizeRefunds(phase.refunds, path, issues) : { presence: "missing", rows: [] } };
}

function normalizePayouts(value, path, issues) {
  if (value === undefined) return { presence: "missing", rows: [] };
  if (value === null) return { presence: "null", rows: [] };
  if (!isObject(value)) { issues.push(issue("unsupported_shape", `${path}.payouts`)); return { presence: "invalid", rows: [] }; }
  const rows = [];
  for (const [betType, items] of Object.entries(value)) {
    if (!Array.isArray(items)) { issues.push(issue("unsupported_shape", `${path}.payouts.${betType}`)); continue; }
    items.forEach((item, index) => rows.push({ betType, itemIndex: index, combination: hasOwn(item, "combination") ? item.combination : null, amountYen: asNullableNumber(item?.amount), label: hasOwn(item ?? {}, "label") ? item.label : null, raw: item }));
  }
  return { presence: "value", rows };
}

function normalizeRefunds(value, path, issues) {
  if (value === undefined) return { presence: "missing", rows: [] };
  if (value === null) return { presence: "null", rows: [] };
  if (!Array.isArray(value)) { issues.push(issue("unsupported_shape", `${path}.refunds`)); return { presence: "invalid", rows: [] }; }
  return { presence: "value", rows: value.map((item, index) => ({ itemIndex: index, entryNumber: asNullableNumber(item), raw: item })) };
}

function normalizeRace(race, path, identity, issues) {
  const program = normalizePhase(race, path, issues, "program");
  const preview = normalizePhase(race.preview, `${path}.preview`, issues, "preview");
  const result = normalizePhase(race.result, `${path}.result`, issues, "result");
  for (const [name, phase] of [["preview", preview], ["result", result]]) {
    if (phase.common?.date && phase.common.date !== identity.date) issues.push(issue("identity_mismatch", `${path}.${name}.date`));
    if (phase.common?.stadiumNumber != null && phase.common.stadiumNumber !== identity.stadiumNumber) issues.push(issue("identity_mismatch", `${path}.${name}.stadium_number`));
    if (phase.common?.raceNumber != null && phase.common.raceNumber !== identity.raceNumber) issues.push(issue("identity_mismatch", `${path}.${name}.race_number`));
  }
  const raw = { program: race, preview: race.preview, result: race.result };
  return { identity, raw, rawHash: sha256Json(raw), program, preview, result, qualityFlags: [] };
}

export function normalizeSnapshot(raw, { sourceCode = "boatraceopenapi-v1", fetchedAt = new Date().toISOString(), parserVersion = PARSER_VERSION, rulesVersion = RULES_VERSION } = {}) {
  const issues = [];
  if (!isObject(raw)) issues.push(issue("unsupported_shape", "$"));
  const races = getRaces(raw, issues);
  const stadiums = new Set(races.map((race) => race.identity.stadiumNumber));
  const resultRaces = races.filter((race) => race.result.presence === "value" && race.result.rows.some((entry) => entry.placeNumber !== null));
  const snapshot = { sourceCode, fetchedAt, parserVersion, rulesVersion, rawHash: sha256Json(raw), raceCount: races.length, stadiumCount: stadiums.size, resultRaceCount: resultRaces.length, races, issues, accepted: issues.length === 0 && races.length > 0 };
  return snapshot;
}
