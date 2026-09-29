const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function parseAiCandidate(value) {
  if (isObject(value)) return value;
  if (typeof value !== "string") return null;
  try { const parsed = JSON.parse(value); return isObject(parsed) ? parsed : null; } catch { return null; }
}

export function validateAiOutput(value) {
  const candidate = parseAiCandidate(value);
  if (!candidate) return { valid: false, errors: ["json_invalid"] };
  const errors = [];
  for (const key of ["main", "counter", "hole"]) {
    const picks = candidate[key];
    if (!Array.isArray(picks) || picks.length !== 3 || picks.some((boat) => !Number.isInteger(boat) || boat < 1 || boat > 6)) {
      errors.push(`${key}_shape`);
    } else if (new Set(picks).size !== 3) errors.push(`${key}_duplicate_boat`);
  }
  if (typeof candidate.narrative !== "string" || candidate.narrative.trim().length === 0) errors.push("narrative_empty");
  if (["main", "counter", "hole"].every((key) => Array.isArray(candidate[key]) && candidate[key].length === 3 && candidate[key].every((n) => Number.isInteger(n) && n >= 1 && n <= 6))) {
    const lines = [candidate.main, candidate.counter, candidate.hole].map((line) => line.join(","));
    if (new Set(lines).size !== 3) errors.push("bets_duplicate");
  }
  if (errors.length) return { valid: false, errors };
  return { valid: true, value: { main: candidate.main, counter: candidate.counter, hole: candidate.hole, narrative: candidate.narrative } };
}
