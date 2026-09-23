import { mergeEntries, calculatePrediction } from "./scoring.mjs";
// Race/boat identity (including factual names) and score-3 input allowlist only.
const fields = ["entry_number", "name", "course", "rank_code", "average_st", "national_win_rate", "local_win_rate", "motor_top2_percent", "motor_top3_percent", "hull_top2_percent", "hull_top3_percent", "time", "start_timing"];
export function canonicalPredictionInput(race) {
  const scores = new Map(calculatePrediction(race).boats.map(boat => [boat.entryNumber, boat.componentScores]));
  const component = { course: 'course', rank_code: 'class', average_st: 'st', national_win_rate: 'ability', local_win_rate: 'ability', motor_top2_percent: 'motor', motor_top3_percent: 'motor', hull_top2_percent: 'hull', hull_top3_percent: 'hull', time: 'exhibitionTime', start_timing: 'exhibitionSt' };
  const value = (row, key) => {
    if (component[key] && !Object.hasOwn(scores.get(Number(row.entry_number)) ?? {}, component[key])) return null;
    if (key === 'name') return row[key] ?? null;
    if (key === 'rank_code') return String(row[key]).toUpperCase();
    const raw = row[key];
    return (typeof raw === 'number' || typeof raw === 'string' && raw.trim() !== '') && Number.isFinite(Number(raw)) ? Number(raw) : null;
  };
  return { raceId: race.race_id ?? null, raceDate: race.race_date ?? null, stadiumCode: race.stadium_code ?? null, raceNumber: race.race_number ?? null,
    boats: mergeEntries(race).map(row => Object.fromEntries(fields.map(key => [key, value(row, key)]))) };
}
export async function predictionKeys(race, configVersion, logicVersion) {
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map(x => x.toString(16).padStart(2,"0")).join("");
  const inputDataHash = await hash({ input: canonicalPredictionInput(race), configVersion, logicVersion });
  const reuseKey = await hash({ raceId: race.race_id, inputDataHash, configVersion, logicVersion });
  return { inputDataHash, reuseKey };
}
export function deadlineState(value, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return "invalid";
  const [hour, minute, second] = value.slice(11,19).split(":").map(Number);
  if (hour > 23 || minute > 59 || second > 59) return "invalid";
  const date = value.slice(0,10), day = new Date(date + "T00:00:00Z"), time = Date.parse(value);
  if (!Number.isFinite(time) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date) return "invalid";
  return time <= now ? "closed" : "open";
}
