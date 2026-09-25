import { calculatePrediction } from "../../../race-prediction/scoring.mjs";
import { deadlineState } from "../../../race-prediction/input-contract.mjs";

export const PREVIEW_FRESHNESS_MS = 10 * 60_000;
export const PROGRAM_FRESHNESS_MS = 30 * 60_000;
export const MAX_SCORING_RACES = 12;

export function predictionReadiness(race, now = Date.now()) {
  if (!race) return { status: "no_match", canScore: false };
  const resultPresent = race.presence?.result === "value" || Array.isArray(race.result_entries) && race.result_entries.length > 0;
  if (resultPresent) return { status: "result_available", canScore: false };
  const deadline = deadlineState(race.program?.closed_at, now);
  if (deadline === "closed") return { status: "closed", canScore: false };
  if (deadline !== "open") return { status: "deadline_unavailable", canScore: false };
  const previewPresent = race.presence?.preview === "value" || Array.isArray(race.preview_entries) && race.preview_entries.length > 0;
  const fetchedAt = Date.parse(race.last_success_at ?? "");
  const limit = previewPresent ? PREVIEW_FRESHNESS_MS : PROGRAM_FRESHNESS_MS;
  if (!Number.isFinite(fetchedAt) || now - fetchedAt > limit) return { status: "stale", canScore: false, previewPresent };
  return { status: "available", canScore: true, previewPresent };
}

export function toPredictionContext(result, readiness = { status: "available", canScore: true }) {
  if (!result || !readiness.canScore) return { status: readiness.status };
  return {
    status: readiness.status,
    main: result.main ?? null,
    counter: result.counter ?? null,
    hole: result.hole ?? null,
    configVersion: result.configVersion ?? null,
    generatedAt: result.generatedAt ?? null,
    scoreAsOf: result.scoreAsOf ?? null,
    boats: (result.boats ?? []).map((boat) => ({
      entryNumber: boat.entryNumber, name: boat.name ?? null, rank: boat.rank ?? null,
      totalScore: boat.totalScore ?? null, componentScores: boat.componentScores ?? {},
    })),
    components: result.components ? {
      earned: result.components.earned, maximum: result.components.maximum,
      included: result.components.included, excluded: result.components.excluded,
    } : null,
  };
}

export function scoreRaceForComment(race, now = Date.now()) {
  const readiness = predictionReadiness(race, now);
  if (!readiness.canScore) return { readiness, prediction: toPredictionContext(null, readiness) };
  try {
    const result = calculatePrediction(race, { generatedAt: new Date(now).toISOString(), scoreAsOf: new Date(now).toISOString() });
    if (!result || result.status === "api_error" || !Array.isArray(result.boats) || result.boats.length !== 6) return { readiness: { status: "input_invalid", canScore: false }, prediction: { status: "input_invalid" } };
    return { readiness, prediction: toPredictionContext(result, readiness) };
  } catch { return { readiness: { status: "error", canScore: false }, prediction: { status: "error" }, error: true }; }
}
