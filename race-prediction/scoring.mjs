export const SCORE_CONFIG = Object.freeze({
  version: "v0.1.14-score-3",
  weights: Object.freeze({
    course: 18,
    courseStats: 16,
    motor: 14,
    st: 9.6,
    exhibitionTime: 6.6,
    exhibitionSt: 4.8,
    ability: 6,
    recent: 3,
    venueConditions: 7,
    class: 5,
    series: 4,
    hull: 2,
    adjustments: 1,
  }),
  courseBaseline: Object.freeze({ 1: 100, 2: 70, 3: 65, 4: 50, 5: 35, 6: 20 }),
  courseRateBands: Object.freeze([
    [40, 100], [30, 80], [20, 60], [10, 40], [Number.NEGATIVE_INFINITY, 20],
  ]),
  classScore: Object.freeze({ A1: 100, A2: 75, B1: 45, B2: 20 }),
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const num = (value) => {
  if (finite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const UPSIDE_WEIGHTS = Object.freeze({ exhibitionTime: 30, exhibitionSt: 30, motor: 25, st: 15 });
const UPSIDE_MAXIMUMS = Object.freeze({ exhibitionTime: SCORE_CONFIG.weights.exhibitionTime, exhibitionSt: SCORE_CONFIG.weights.exhibitionSt, motor: SCORE_CONFIG.weights.motor, st: SCORE_CONFIG.weights.st });
const winRateScore = (value) => {
  const n = num(value);
  if (n === null) return null;
  if (n >= 7) return 100;
  if (n >= 6.5) return 85;
  if (n >= 6) return 70;
  if (n >= 5.5) return 55;
  if (n >= 5) return 40;
  return 25;
};
export const averageStScore = (value) => {
  const n = num(value);
  if (n === null) return null;
  if (n <= 0.12) return 100;
  if (n <= 0.14) return 80;
  if (n <= 0.16) return 60;
  if (n <= 0.18) return 40;
  return 20;
};
const inverseRankScore = (value, values, higherIsBetter = true) => {
  if (!finite(value) || values.length < 1) return null;
  const sorted = [...values].sort((a, b) => higherIsBetter ? b - a : a - b);
  const first = sorted.findIndex((candidate) => candidate === value);
  const last = sorted.length - 1 - [...sorted].reverse().findIndex((candidate) => candidate === value);
  const averageRank = ((first + 1) + (last + 1)) / 2;
  const lower = Math.floor(averageRank);
  const upper = Math.ceil(averageRank);
  const points = [100, 80, 60, 40, 20, 0];
  return (points[Math.min(lower - 1, 5)] + points[Math.min(upper - 1, 5)]) / 2;
};

function mergeEntries(race) {
  const program = Array.isArray(race?.entries) ? race.entries : [];
  const preview = Array.isArray(race?.preview_entries) ? race.preview_entries : [];
  const byNo = new Map(preview.map((row) => [Number(row.entry_number), row]));
  return program
    .map((entry) => {
      const merged = { ...entry, ...(byNo.get(Number(entry.entry_number)) ?? {}) };
      const course = Number(merged.course);
      if (!Number.isInteger(course) || course < 1 || course > 6) merged.course = Number(entry.entry_number);
      return merged;
    })
    .sort((a, b) => Number(a.entry_number) - Number(b.entry_number));
}

function allSix(rows, getter) {
  return rows.length === 6 && rows.every((row) => {
    const value = getter(row);
    return value !== null && value !== undefined && value !== false;
  });
}

function addComponent(components, name, earned, maximum, reason) {
  if (earned === null || maximum <= 0) {
    components.excluded.push({ name, maximum, reason });
    return;
  }
  components.earned += earned;
  components.maximum += maximum;
  components.included.push({ name, earned, maximum });
}

function motorScore(rows) {
  if (!allSix(rows, (r) => num(r.motor_top2_percent)) || !allSix(rows, (r) => num(r.motor_top3_percent))) return null;
  const composites = rows.map((r) => num(r.motor_top2_percent) * 0.7 + (num(r.motor_top3_percent) - num(r.motor_top2_percent)) * 0.3);
  return { values: composites.map((value, index) => ({ index, value, score: inverseRankScore(value, composites) })) };
}

function hullScore(rows) {
  if (!allSix(rows, (r) => num(r.hull_top2_percent)) || !allSix(rows, (r) => num(r.hull_top3_percent))) return null;
  const composites = rows.map((r) => num(r.hull_top2_percent) * 0.7 + (num(r.hull_top3_percent) - num(r.hull_top2_percent)) * 0.3);
  return { values: composites.map((value, index) => ({ index, value, score: inverseRankScore(value, composites) })) };
}

function abilityScores(rows) {
  return rows.map((row, index) => {
    const national = winRateScore(row.national_win_rate);
    const local = winRateScore(row.local_win_rate);
    if (national === null && local === null) return { index, score: null };
    if (national === null) return { index, score: local };
    if (local === null) return { index, score: national };
    return { index, score: clamp(national * 0.6 + local * 0.4) };
  });
}

function scoreRows(race, rows) {
  const components = { earned: 0, maximum: 0, included: [], excluded: [] };
  const perBoat = rows.map((row) => ({ entryNumber: Number(row.entry_number), name: row.name ?? null, componentScores: {}, keyFactors: [], factorEvidence: [], weakFactors: [] }));

  const courses = rows.map((r) => num(r.course));
  if (allSix(rows, (r) => num(r.course) !== null)) {
    rows.forEach((r, i) => { perBoat[i].componentScores.course = SCORE_CONFIG.courseBaseline[num(r.course)] ?? 0; });
    // Component diagnostics are race-level averages: the earned value is the
    // mean contribution among boats with that component available (not missing=0).
    // maximum sums included component caps, not mean boat effectiveMaximum.
    const average = mean(perBoat.map((b) => b.componentScores.course));
    addComponent(components, "course", average / 100 * SCORE_CONFIG.weights.course, SCORE_CONFIG.weights.course, "all six courses available");
    perBoat.forEach((b) => { b.componentScores.course = b.componentScores.course / 100 * SCORE_CONFIG.weights.course; });
  } else {
    addComponent(components, "course", null, SCORE_CONFIG.weights.course, "six courses required");
  }

  const ability = abilityScores(rows);
  const abilityAvailable = ability.filter((entry) => entry.score !== null);
  if (abilityAvailable.length) {
    ability.forEach((entry) => { if (entry.score !== null) perBoat[entry.index].componentScores.ability = entry.score / 100 * SCORE_CONFIG.weights.ability; });
    addComponent(components, "ability", mean(abilityAvailable.map((e) => e.score)) / 100 * SCORE_CONFIG.weights.ability, SCORE_CONFIG.weights.ability, "national/local win rates");
  } else addComponent(components, "ability", null, SCORE_CONFIG.weights.ability, "national/local win rates unavailable");

  const motor = motorScore(rows);
  if (motor) {
    motor.values.forEach((entry) => { perBoat[entry.index].componentScores.motor = entry.score / 100 * SCORE_CONFIG.weights.motor; });
    addComponent(components, "motor", mean(motor.values.map((e) => e.score)) / 100 * SCORE_CONFIG.weights.motor, SCORE_CONFIG.weights.motor, "six motor records available");
  } else addComponent(components, "motor", null, SCORE_CONFIG.weights.motor, "six motor records required");

  const hull = hullScore(rows);
  if (hull) {
    hull.values.forEach((entry) => { perBoat[entry.index].componentScores.hull = entry.score / 100 * SCORE_CONFIG.weights.hull; });
    addComponent(components, "hull", mean(hull.values.map((e) => e.score)) / 100 * SCORE_CONFIG.weights.hull, SCORE_CONFIG.weights.hull, "six hull records available");
  } else addComponent(components, "hull", null, SCORE_CONFIG.weights.hull, "six hull records required");

  const avgStScores = rows.map((r) => averageStScore(r.average_st));
  const avgStAvailable = avgStScores.filter((value) => value !== null);
  if (avgStAvailable.length) {
    avgStScores.forEach((value, index) => { if (value !== null) perBoat[index].componentScores.st = value / 100 * SCORE_CONFIG.weights.st; });
    addComponent(components, "st", mean(avgStAvailable) / 100 * SCORE_CONFIG.weights.st, SCORE_CONFIG.weights.st, "average ST stage bands; F/L reliability excluded");
  } else addComponent(components, "st", null, SCORE_CONFIG.weights.st, "average ST unavailable");

  const exhibitionTime = rows.map((r) => num(r.time));
  if (allSix(rows, (r) => num(r.time) !== null)) {
    exhibitionTime.forEach((value, index) => { perBoat[index].componentScores.exhibitionTime = inverseRankScore(value, exhibitionTime, false) / 100 * SCORE_CONFIG.weights.exhibitionTime; });
    addComponent(components, "exhibitionTime", mean(exhibitionTime.map((value) => inverseRankScore(value, exhibitionTime, false))) / 100 * SCORE_CONFIG.weights.exhibitionTime, SCORE_CONFIG.weights.exhibitionTime, "six exhibition times available");
  } else addComponent(components, "exhibitionTime", null, SCORE_CONFIG.weights.exhibitionTime, "six exhibition times required");

  const exhibitionSt = rows.map((r) => { const value = num(r.start_timing); return value !== null && value >= 0 ? value : null; });
  if (exhibitionSt.every((value) => value !== null)) {
    exhibitionSt.forEach((value, index) => { perBoat[index].componentScores.exhibitionSt = inverseRankScore(value, exhibitionSt, false) / 100 * SCORE_CONFIG.weights.exhibitionSt; });
    addComponent(components, "exhibitionSt", mean(exhibitionSt.map((value) => inverseRankScore(value, exhibitionSt, false))) / 100 * SCORE_CONFIG.weights.exhibitionSt, SCORE_CONFIG.weights.exhibitionSt, "six numeric exhibition ST values available");
  } else addComponent(components, "exhibitionSt", null, SCORE_CONFIG.weights.exhibitionSt, "F/L notation or incomplete exhibition ST");

  const classes = rows.map((r) => SCORE_CONFIG.classScore[String(r.rank_code ?? "").toUpperCase()] ?? null);
  const classAvailable = classes.filter((value) => value !== null);
  if (classAvailable.length) {
    classes.forEach((value, index) => { if (value !== null) perBoat[index].componentScores.class = value / 100 * SCORE_CONFIG.weights.class; });
    addComponent(components, "class", mean(classAvailable) / 100 * SCORE_CONFIG.weights.class, SCORE_CONFIG.weights.class, "rank code");
  } else addComponent(components, "class", null, SCORE_CONFIG.weights.class, "rank code unavailable");

  // D03, venue/conditions, series, tilt/weight/parts, and F/L reliability are intentionally excluded until their tables are confirmed.
  ["courseStats", "recent", "venueConditions", "series", "adjustments"].forEach((name) => addComponent(components, name, null, SCORE_CONFIG.weights[name], "未確定または履歴集計データ未取得"));

  const perBoatEarned = perBoat.map((boat) => Object.values(boat.componentScores).reduce((sum, value) => sum + value, 0));
  perBoat.forEach((boat, index) => {
    boat.effectiveMaximum = Object.keys(boat.componentScores).reduce((sum, name) => sum + (SCORE_CONFIG.weights[name] ?? 0), 0);
    boat.totalScore = boat.effectiveMaximum > 0 ? perBoatEarned[index] / boat.effectiveMaximum * 100 : null;
    const addFactor = (component, text, idSuffix = component) => {
      // keyFactors remains text-only for existing public/UI consumers. The
      // structured factorEvidence is the canonical input for narrative generation.
      boat.keyFactors.push(text);
      boat.factorEvidence.push({
        id: `boat-${boat.entryNumber}-${idSuffix}`,
        component,
        text,
      });
    };
    if (components.included.some((item) => item.name === "course") && boat.componentScores.course >= SCORE_CONFIG.weights.course * 0.85) addFactor("course", "進入コース有利");
    if (components.included.some((item) => item.name === "motor") && boat.componentScores.motor >= SCORE_CONFIG.weights.motor * 0.8) addFactor("motor", "モーター上位");
    if (components.included.some((item) => item.name === "exhibitionTime") && boat.componentScores.exhibitionTime >= SCORE_CONFIG.weights.exhibitionTime * 0.8) addFactor("exhibitionTime", "展示タイム良好", "exhibition-time");
    if (boat.totalScore !== null && boat.totalScore < 45) boat.weakFactors.push("総合点は低め");
  });
  return { components, boats: perBoat };
}

export function compareBoats(a, b, tieBreakAvailability = {}) {
  if (b.totalScore !== a.totalScore) return (b.totalScore ?? -Infinity) - (a.totalScore ?? -Infinity);
  const exhibition = (x) => num(x.time);
  const st = (x) => num(x.start_timing);
  const avg = (x) => num(x.average_st);
  return (tieBreakAvailability.exhibitionTime ? (exhibition(a) ?? Infinity) - (exhibition(b) ?? Infinity) : 0)
    || (tieBreakAvailability.exhibitionSt ? (st(a) ?? Infinity) - (st(b) ?? Infinity) : 0)
    || (tieBreakAvailability.averageSt ? (avg(a) ?? Infinity) - (avg(b) ?? Infinity) : 0)
    || (tieBreakAvailability.motor ? (b.motorScore ?? -Infinity) - (a.motorScore ?? -Infinity) : 0)
    || a.entryNumber - b.entryNumber;
}

function normalizedUpsideValue(boat, name) {
  const value = num(boat.componentScores?.[name]);
  const maximum = UPSIDE_MAXIMUMS[name];
  return value === null || !maximum ? null : clamp(value / maximum * 100);
}

export function calculateUpsideScore(boat, availableFactors = Object.keys(UPSIDE_WEIGHTS)) {
  const factors = availableFactors.filter((name) => Object.hasOwn(UPSIDE_WEIGHTS, name));
  const totalWeight = factors.reduce((sum, name) => sum + UPSIDE_WEIGHTS[name], 0);
  if (!totalWeight) return null;
  return factors.reduce((sum, name) => sum + normalizedUpsideValue(boat, name) * UPSIDE_WEIGHTS[name], 0) / totalWeight;
}

export function selectHole(ranked, includedNames = new Set()) {
  const candidates = ranked.filter((boat) => boat.rank >= 4 && boat.rank <= 6);
  const availableFactors = Object.keys(UPSIDE_WEIGHTS).filter((name) => includedNames.has(name) && candidates.length === 3 && candidates.every((boat) => normalizedUpsideValue(boat, name) !== null));
  if (!availableFactors.length) return null;
  const scoredCandidates = candidates.map((boat) => ({ boat, upside: calculateUpsideScore(boat, availableFactors) }))
    .sort((a, b) => b.upside - a.upside || a.boat.rank - b.boat.rank || a.boat.entryNumber - b.boat.entryNumber);
  const selected = scoredCandidates[0].boat;
  const remaining = ranked.filter((boat) => boat !== selected).sort((a, b) => a.rank - b.rank).slice(0, 2);
  return [selected.entryNumber, ...remaining.map((boat) => boat.entryNumber)];
}

export function calculatePrediction(race, options = {}) {
  const rows = mergeEntries(race);
  if (rows.length !== 6) return { status: "api_error", errorCode: "insufficient_boats", main: null, counter: null, hole: null, picks: { main: null, counter: null, hole: null }, boats: [], exclusions: ["six boats required"] };
  const scored = scoreRows(race, rows);
  const included = new Set(scored.components.included.map((item) => item.name));
  const tieBreakAvailability = {
    exhibitionTime: included.has("exhibitionTime"),
    exhibitionSt: included.has("exhibitionSt"),
    averageSt: included.has("st"),
    motor: included.has("motor"),
  };
  const ranked = scored.boats.map((boat, index) => ({ ...boat, ...rows[index], motorScore: boat.componentScores.motor ?? null })).sort((a, b) => compareBoats(a, b, tieBreakAvailability));
  ranked.forEach((boat, index) => { boat.rank = index + 1; });
  const byRank = (rank) => ranked[rank - 1]?.entryNumber ?? null;
  const main = [byRank(1), byRank(2), byRank(3)];
  const counter = [byRank(2), byRank(1), byRank(4)];
  const hole = selectHole(ranked, included);
  const status = scored.components.excluded.length ? "partial" : "success";
  return {
    status,
    configVersion: SCORE_CONFIG.version,
    main, counter, hole,
    boats: ranked,
    components: scored.components,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    scoreAsOf: options.scoreAsOf ?? options.generatedAt ?? new Date().toISOString(),
  };
}

export { mergeEntries, winRateScore as rateScore, inverseRankScore };
