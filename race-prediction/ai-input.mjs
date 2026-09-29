const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export const canonicalJson = (value) => JSON.stringify(canonical(value));

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const FORBIDDEN_PROGRAM_KEYS = new Set(["result", "payouts", "refunds", "actual_course", "actual_start_timing",
  "finish_position", "place_number", "place_number_source", "existing_prediction", "ai_prediction", "prediction_snapshot"]);

function removePostRaceFields(value) {
  if (Array.isArray(value)) return value.map(removePostRaceFields);
  if (!object(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !FORBIDDEN_PROGRAM_KEYS.has(key))
    .map(([key, child]) => [key, removePostRaceFields(child)]));
}

export function separateProgram(raw) {
  if (!object(raw)) return { program: raw, embeddedPreview: null };
  const embeddedPreview = Object.hasOwn(raw, "preview") ? raw.preview : null;
  const program = removePostRaceFields(raw);
  delete program.preview;
  if (object(program.racers)) program.racers = Object.fromEntries(Object.entries(program.racers)
    .sort(([keyA, valueA], [keyB, valueB]) => Number(valueA?.entry_number ?? keyA) - Number(valueB?.entry_number ?? keyB)));
  return { program, embeddedPreview };
}

export function validateEntries(program) {
  const racers = program?.racers;
  if (!object(racers)) return { valid: false, reason: "entries_invalid" };
  const byNumber = new Map();
  for (const [key, entry] of Object.entries(racers)) {
    if (!object(entry)) return { valid: false, reason: "entries_invalid" };
    const keyNumber = /^\d+$/.test(key) ? Number(key) : null;
    const entryNumber = entry.entry_number === undefined || entry.entry_number === null || entry.entry_number === ""
      ? null : Number(entry.entry_number);
    if ((keyNumber === null && entryNumber === null) ||
        (keyNumber !== null && (!Number.isInteger(keyNumber) || keyNumber < 1 || keyNumber > 6)) ||
        (entryNumber !== null && (!Number.isInteger(entryNumber) || entryNumber < 1 || entryNumber > 6)) ||
        (keyNumber !== null && entryNumber !== null && keyNumber !== entryNumber)) {
      return { valid: false, reason: "entries_invalid" };
    }
    const number = entryNumber ?? keyNumber;
    if (byNumber.has(number)) return { valid: false, reason: "entries_invalid" };
    byNumber.set(number, entry);
  }
  return byNumber.size === 6 && [1, 2, 3, 4, 5, 6].every((number) => byNumber.has(number))
    ? { valid: true, boats: [...byNumber].sort(([a], [b]) => a - b).map(([entryNumber, entry]) => ({ entryNumber, ...entry })) }
    : { valid: false, reason: "entries_invalid" };
}

export async function buildAiInput({ identity, programRaw, previewRaw, presence, provenance, closedAt }) {
  const separated = separateProgram(programRaw);
  const checked = validateEntries(separated.program);
  if (!checked.valid) throw new Error("entries_invalid");
  if (String(separated.program.date) !== String(identity.raceDate) || Number(separated.program.stadium_number) !== Number(identity.stadiumCode) ||
      Number(separated.program.race_number) !== Number(identity.raceNumber)) throw new Error("identity_mismatch");
  if (separated.embeddedPreview !== null && previewRaw !== null &&
      canonicalJson(separated.embeddedPreview) !== canonicalJson(previewRaw)) throw new Error("preview_mismatch");
  const bundle = {
    identity,
    facts: {
      program: separated.program,
      preview: previewRaw ?? null,
      presence: presence ?? { program: "value", preview: previewRaw == null ? "missing" : "value" },
    },
    provenance: {
      sourceCode: provenance?.sourceCode ?? null,
      fetchedAt: provenance?.fetchedAt ?? null,
      lastConfirmedAt: provenance?.lastConfirmedAt ?? null,
      batchId: provenance?.batchId ?? null,
      programComponentId: provenance?.programComponentId ?? null,
      previewComponentId: provenance?.previewComponentId ?? null,
      readAt: provenance?.readAt ?? new Date().toISOString(),
    },
    closedAt,
  };
  const factsHash = await sha256({ inputSchemaVersion: "ai-input-v2", identity, facts: bundle.facts, closedAt, fieldDefinitionsVersion: "boatraceopenapi-v1" });
  return { ...bundle, factsHash };
}
