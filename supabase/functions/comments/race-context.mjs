import { normalizeQueries } from "./reply-router.mjs";
import { deadlineState } from "../../../race-prediction/input-contract.mjs";

export const MAX_RPC_CALLS = 3;
export const CONTEXT_LIMITS = Object.freeze({ races: 20, entries: 6, previewEntries: 6, resultEntries: 6, payouts: 20 });

const STADIUM_NAMES = new Map([
  [1,"桐生"],[2,"戸田"],[3,"江戸川"],[4,"平和島"],[5,"多摩川"],[6,"浜名湖"],[7,"蒲郡"],[8,"常滑"],
  [9,"津"],[10,"三国"],[11,"びわこ"],[12,"住之江"],[13,"尼崎"],[14,"鳴門"],[15,"丸亀"],[16,"児島"],
  [17,"宮島"],[18,"徳山"],[19,"下関"],[20,"若松"],[21,"芦屋"],[22,"福岡"],[23,"唐津"],[24,"大村"],
]);

const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value && value[key] !== undefined).map((key) => [key, value[key]]));
const RACE_KEYS = ["race_date","stadium_code","race_number","last_success_at","presence"];
const PROGRAM_KEYS = ["closed_at","title","subtitle","grade_code","distance_m","day_number"];
const ENTRY_KEYS = ["entry_number","racer_registration_number","name","rank_code","age_at_race","average_st","national_win_rate","national_top2_percent","national_top3_percent","local_win_rate","local_top2_percent","local_top3_percent","motor_number","motor_top2_percent","motor_top3_percent","hull_number","hull_top2_percent","hull_top3_percent"];
const PREVIEW_KEYS = ["weather_code","wind_direction_code","wind_speed","wave_height","air_temperature","water_temperature"];
const PREVIEW_ENTRY_KEYS = ["entry_number","course","start_timing","time","tilt"];
const RESULT_KEYS = ["technique_code","remarks","weather_code","wind_direction_code","wind_speed","wave_height","result_state"];
const RESULT_ENTRY_KEYS = ["entry_number","name","actual_course","actual_st","place_code","finish_position"];
const PAYOUT_KEYS = ["bet_type","combination_entries","amount_yen","label","payout_kind"];

export function classifyRpcResponse(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.data) || !payload.coverage || !Array.isArray(payload.warnings)) return { status: "error", reason: "malformed", payload: null };
  if (payload.data.length === 0) return { status: "no_match", reason: null, payload };
  if (payload.coverage.truncated === true) return { status: "truncated", reason: null, payload };
  return { status: "success", reason: null, payload };
}

export function toRaceContext(payload, now = Date.now()) {
  const races = (payload?.data ?? []).slice(0, CONTEXT_LIMITS.races).map((row) => ({
    ...pick(row, RACE_KEYS),
    stadium_name: STADIUM_NAMES.get(row.stadium_code) ?? null,
    program: { ...pick(row.program, PROGRAM_KEYS), deadline_state: deadlineState(row.program?.closed_at, now) },
    preview: pick(row.preview, PREVIEW_KEYS),
    result: pick(row.result, RESULT_KEYS),
    entries: (row.entries ?? []).slice(0, CONTEXT_LIMITS.entries).map((entry) => pick(entry, ENTRY_KEYS)),
    preview_entries: (row.preview_entries ?? []).slice(0, CONTEXT_LIMITS.previewEntries).map((entry) => pick(entry, PREVIEW_ENTRY_KEYS)),
    result_entries: (row.result_entries ?? []).slice(0, CONTEXT_LIMITS.resultEntries).map((entry) => pick(entry, RESULT_ENTRY_KEYS)),
    payouts: (row.payouts ?? []).slice(0, CONTEXT_LIMITS.payouts).map((entry) => pick(entry, PAYOUT_KEYS)),
  }));
  return { races, aggregates: payload?.aggregates ?? {}, coverage: payload?.coverage ?? {}, warnings: payload?.warnings ?? [] };
}

function rpcArgs(query, filtered) {
  const args = {
    p_from: query.from, p_to: query.to, p_stadium_code: query.stadiumCode, p_race_number: query.raceNumber,
    p_entry_number: query.entryNumber, p_racer_name: query.racerName, p_limit: query.limit,
  };
  if (filtered) Object.assign(args, { p_racer_registration: query.racerRegistration, p_rank_code: query.rankCode, p_min_age: query.minAge, p_max_age: query.maxAge, p_bet_type: query.betType, p_min_amount_yen: query.minAmountYen, p_max_amount_yen: query.maxAmountYen });
  return args;
}

export function createRaceContextClient({ projectUrl, serviceRoleKey, fetchImpl = fetch, now = Date.now() }) {
  let rpcCalls = 0;
  const call = async (name, args) => {
    if (rpcCalls >= MAX_RPC_CALLS) return { status: "error", reason: "rpc_limit", payload: null };
    rpcCalls += 1;
    try {
      const response = await fetchImpl(`${projectUrl}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
      if (!response.ok) return { status: "error", reason: `http_${response.status}`, payload: null };
      return classifyRpcResponse(await response.json());
    } catch { return { status: "error", reason: "network", payload: null }; }
  };
  const search = async (queries) => {
    const normalized = normalizeQueries(queries);
    if (!normalized.valid) return { status: "error", reason: normalized.reason, context: null, rpcCallCount: rpcCalls };
    let combined = { races: [], aggregates: {}, coverage: { matched: 0, returned: 0, truncated: false }, warnings: [] };
    let filteredCandidateCount = 0;
    let detailFetchCount = 0;
    let finalStatus = "success";
    for (const query of normalized.queries) {
      const filtered = query.type === "race_search_filtered";
      const result = await call(filtered ? "race_data_search_current_races_filtered" : "race_data_search_current_races", rpcArgs(query, filtered));
      if (result.status === "error") return { status: "error", reason: result.reason, context: null, rpcCallCount: rpcCalls };
      if (result.status === "no_match") { if (!combined.races.length) finalStatus = "no_match"; combined.warnings.push(...(result.payload?.warnings ?? [])); continue; }
      if (result.status === "truncated") finalStatus = "truncated";
      if (filtered) {
        const candidates = result.payload.data.slice(0, CONTEXT_LIMITS.races);
        filteredCandidateCount += candidates.length;
        for (const candidate of candidates) {
          detailFetchCount += 1;
          const detail = await call("race_data_search_current_races", { p_from: candidate.race_date, p_to: candidate.race_date, p_stadium_code: candidate.stadium_code, p_race_number: candidate.race_number, p_entry_number: null, p_racer_name: null, p_limit: 1 });
          if (detail.status === "error") return { status: "error", reason: detail.reason, context: null, rpcCallCount: rpcCalls };
          if (detail.payload?.data?.length) combined.races.push(...detail.payload.data.slice(0, 1));
          if (detail.status === "truncated") finalStatus = "truncated";
        }
      } else combined.races.push(...result.payload.data);
      combined.aggregates = { ...combined.aggregates, ...(result.payload.aggregates ?? {}) };
      combined.coverage = { ...combined.coverage, ...(result.payload.coverage ?? {}), returned: combined.races.length };
      combined.warnings.push(...(result.payload.warnings ?? []));
    }
    if (!combined.races.length && finalStatus === "success") finalStatus = "no_match";
    // toRaceContext consumes the RPC envelope's `data` field. The search
    // accumulator stores detail rows in `races`, so adapt it back to that
    // envelope here before projecting the safe AI context.
    const contextPayload = { data: combined.races, aggregates: combined.aggregates, coverage: combined.coverage, warnings: combined.warnings };
    return { status: finalStatus, reason: null, context: toRaceContext(contextPayload, now), predictionRaces: combined.races, rpcCallCount: rpcCalls, filteredCandidateCount, detailFetchCount };
  };
  return { search, get rpcCallCount() { return rpcCalls; } };
}
