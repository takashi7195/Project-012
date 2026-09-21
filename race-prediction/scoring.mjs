export const SCORE_CONFIG = Object.freeze({
  version: "v0.1.14-score-1",
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
  classScore: Object.freeze({ A1: 100, A2: 80, B1: 50, B2: 25 }),
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const num = (value) => {
  if (finite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const rateScore = (value) => {
  const n = num(value);
  if (n === null) return null;
  for (const [threshold, score] of SCORE_CONFIG.courseRateBands) if (n >= threshold) return score;
  return null;
};
const inverseRankScore = (value, values, higherIsBetter = true) => {
  if (!finite(value) || values.length < 1) return null;
  const sorted = [...values].sort((a, b) => higherIsBetter ? b - a : a - b);
  const rank = sorted.findIndex((candidate) => candidate === value) + 1;
  return [100, 80, 60, 40, 20, 0][Math.min(rank - 1, 5)];
};

function mergeEntries(race) {
  const program = Array.isArray(race?.entries) ? race.entries : [];
  const preview = Array.isArray(race?.preview_entries) ? race.preview_entries : [];
  const byNo = new Map(preview.map((row) => [Number(row.entry_number), row]));
  return program
    .map((entry) => ({ ...entry, ...(byNo.get(Number(entry.entry_number)) ?? {}) }))
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
  if (!rows.every((r) => num(r.national_win_rate) !== null && num(r.local_win_rate) !== null)) return null;
  const national = rows.map((r) => num(r.national_win_rate));
  const local = rows.map((r) => num(r.local_win_rate));
  return rows.map((_, index) => ({ index, score: clamp(rateScore(national[index]) * 0.6 + rateScore(local[index]) * 0.4) }));
}

function scoreRows(race, rows) {
  const components = { earned: 0, maximum: 0, included: [], excluded: [] };
  const perBoat = rows.map((row) => ({ entryNumber: Number(row.entry_number), name: row.name ?? null, componentScores: {}, keyFactors: [], weakFactors: [] }));

  const courses = rows.map((r) => num(r.course));
  if (allSix(rows, (r) => num(r.course) !== null)) {
    rows.forEach((r, i) => { perBoat[i].componentScores.course = SCORE_CONFIG.courseBaseline[num(r.course)] ?? 0; });
    const total = perBoat.reduce((sum, b) => sum + b.componentScores.course, 0) / 100 * SCORE_CONFIG.weights.course;
    addComponent(components, "course", total, SCORE_CONFIG.weights.course, "all six courses available");
    perBoat.forEach((b) => { b.componentScores.course = b.componentScores.course / 100 * SCORE_CONFIG.weights.course; });
  } else {
    addComponent(components, "course", null, SCORE_CONFIG.weights.course, "six courses required");
  }

  const ability = abilityScores(rows);
  if (ability) {
    ability.forEach((entry) => { perBoat[entry.index].componentScores.ability = entry.score / 100 * SCORE_CONFIG.weights.ability; });
    addComponent(components, "ability", mean(ability.map((e) => e.score)) / 100 * SCORE_CONFIG.weights.ability, SCORE_CONFIG.weights.ability, "national/local win rates");
  } else addComponent(components, "ability", null, SCORE_CONFIG.weights.ability, "national/local win rates incomplete");

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

  const avgSt = rows.map((r) => num(r.average_st));
  if (allSix(rows, (r) => num(r.average_st) !== null)) {
    avgSt.forEach((value, index) => { perBoat[index].componentScores.st = inverseRankScore(value, avgSt, false) / 100 * SCORE_CONFIG.weights.st; });
    addComponent(components, "st", mean(avgSt.map((value) => inverseRankScore(value, avgSt, false))) / 100 * SCORE_CONFIG.weights.st, SCORE_CONFIG.weights.st, "average ST; F/L reliability excluded");
  } else addComponent(components, "st", null, SCORE_CONFIG.weights.st, "six average ST values required");

  const exhibitionTime = rows.map((r) => num(r.time));
  if (allSix(rows, (r) => num(r.time) !== null)) {
    exhibitionTime.forEach((value, index) => { perBoat[index].componentScores.exhibitionTime = inverseRankScore(value, exhibitionTime, false) / 100 * SCORE_CONFIG.weights.exhibitionTime; });
    addComponent(components, "exhibitionTime", mean(exhibitionTime.map((value) => inverseRankScore(value, exhibitionTime, false))) / 100 * SCORE_CONFIG.weights.exhibitionTime, SCORE_CONFIG.weights.exhibitionTime, "six exhibition times available");
  } else addComponent(components, "exhibitionTime", null, SCORE_CONFIG.weights.exhibitionTime, "six exhibition times required");

  const exhibitionSt = rows.map((r) => typeof r.start_timing === "string" && /^[FL]/i.test(r.start_timing) ? null : num(r.start_timing));
  if (exhibitionSt.every((value) => value !== null)) {
    exhibitionSt.forEach((value, index) => { perBoat[index].componentScores.exhibitionSt = inverseRankScore(value, exhibitionSt, false) / 100 * SCORE_CONFIG.weights.exhibitionSt; });
    addComponent(components, "exhibitionSt", mean(exhibitionSt.map((value) => inverseRankScore(value, exhibitionSt, false))) / 100 * SCORE_CONFIG.weights.exhibitionSt, SCORE_CONFIG.weights.exhibitionSt, "six numeric exhibition ST values available");
  } else addComponent(components, "exhibitionSt", null, SCORE_CONFIG.weights.exhibitionSt, "F/L notation or incomplete exhibition ST");

  const classes = rows.map((r) => SCORE_CONFIG.classScore[String(r.rank_code ?? "").toUpperCase()] ?? null);
  if (classes.every((value) => value !== null)) {
    classes.forEach((value, index) => { perBoat[index].componentScores.class = value / 100 * SCORE_CONFIG.weights.class; });
    addComponent(components, "class", mean(classes) / 100 * SCORE_CONFIG.weights.class, SCORE_CONFIG.weights.class, "rank code");
  } else addComponent(components, "class", null, SCORE_CONFIG.weights.class, "rank code unavailable");

  // D03, venue/conditions, series, tilt/weight/parts, and F/L reliability are intentionally excluded until their tables are confirmed.
  ["courseStats", "recent", "venueConditions", "series", "adjustments"].forEach((name) => addComponent(components, name, null, SCORE_CONFIG.weights[name], "未確定または履歴集計データ未取得"));

  const perBoatEarned = perBoat.map((boat) => Object.values(boat.componentScores).reduce((sum, value) => sum + value, 0));
  perBoat.forEach((boat, index) => {
    boat.totalScore = components.maximum > 0 ? perBoatEarned[index] / components.maximum * 100 : null;
    if (boat.componentScores.course >= SCORE_CONFIG.weights.course * 0.85) boat.keyFactors.push("進入コース有利");
    if (boat.componentScores.motor >= SCORE_CONFIG.weights.motor * 0.8) boat.keyFactors.push("モーター上位");
    if (boat.componentScores.exhibitionTime >= SCORE_CONFIG.weights.exhibitionTime * 0.8) boat.keyFactors.push("展示タイム良好");
    if (boat.totalScore !== null && boat.totalScore < 45) boat.weakFactors.push("総合点は低め");
  });
  return { components, boats: perBoat };
}

function compareBoats(a, b) {
  if (b.totalScore !== a.totalScore) return (b.totalScore ?? -Infinity) - (a.totalScore ?? -Infinity);
  const exhibition = (x) => num(x.exhibitionTime);
  const st = (x) => num(x.start_timing);
  const avg = (x) => num(x.average_st);
  return (exhibition(a) ?? Infinity) - (exhibition(b) ?? Infinity)
    || (st(a) ?? Infinity) - (st(b) ?? Infinity)
    || (avg(a) ?? Infinity) - (avg(b) ?? Infinity)
    || (b.motorScore ?? -Infinity) - (a.motorScore ?? -Infinity)
    || a.entryNumber - b.entryNumber;
}

export function calculatePrediction(race, options = {}) {
  const rows = mergeEntries(race);
  if (rows.length !== 6) return { status: "api_error", errorCode: "insufficient_boats", main: null, counter: null, hole: null, picks: { main: null, counter: null, hole: null }, boats: [], exclusions: ["six boats required"] };
  const scored = scoreRows(race, rows);
  const ranked = scored.boats.map((boat, index) => ({ ...boat, ...rows[index], motorScore: boat.componentScores.motor ?? null })).sort(compareBoats);
  ranked.forEach((boat, index) => { boat.rank = index + 1; });
  const byRank = (rank) => ranked[rank - 1]?.entryNumber ?? null;
  const main = [byRank(1), byRank(2), byRank(3)];
  const counter = [byRank(2), byRank(1), byRank(4)];
  const holeCandidates = ranked.filter((boat) => boat.rank >= 4).map((boat) => {
    const factors = [boat.componentScores.exhibitionTime, boat.componentScores.exhibitionSt, boat.componentScores.motor, boat.componentScores.st].filter((v) => finite(v));
    return { boat, upside: factors.length ? mean(factors) : null };
  }).filter((entry) => entry.upside !== null).sort((a, b) => b.upside - a.upside || a.boat.rank - b.boat.rank);
  const hole = holeCandidates.length ? [holeCandidates[0].boat.entryNumber, byRank(1), byRank(2)] : null;
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

export { mergeEntries, rateScore };
