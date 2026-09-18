function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value, min, max) {
  return Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
}

function boatScore(racer, preview, position) {
  const national = normalize(number(racer.national_top_3_percent), 0, 90);
  const local = normalize(number(racer.local_top_3_percent), 0, 90);
  const motor = normalize(number(racer.motor_top_3_percent), 0, 80);
  const boat = normalize(number(racer.boat_top_3_percent), 0, 80);
  const rank = normalize(6 - number(racer.rank_number, 4), 0, 5);
  const avgStart = normalize(0.25 - number(racer.average_start_timing, 0.2), 0, 0.25);
  const previewStart = normalize(0.25 - number(preview?.start_timing, 0.2), 0, 0.25);
  const exhibition = normalize(7.1 - number(preview?.exhibition_time, 7.1), 0, 0.6);
  const course = number(preview?.course_number, racer.entry_number);
  const courseBonus = position === 1 && course === 1 ? 0.32 : position === 2 && course <= 3 ? 0.12 : position === 3 && course <= 4 ? 0.06 : 0;
  const flyingPenalty = number(racer.flying_count) * 0.035;
  return 0.22 * national + 0.16 * local + 0.2 * motor + 0.12 * boat + 0.12 * rank + 0.06 * avgStart + 0.06 * previewStart + 0.06 * exhibition + courseBonus - flyingPenalty + 0.01;
}

export function rankPredictions(race) {
  const combinations = [];
  for (let first = 1; first <= 6; first++) {
    for (let second = 1; second <= 6; second++) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third++) {
        if (third === first || third === second) continue;
        const score = boatScore(race.racers[String(first)], race.preview?.racers?.[String(first)], 1)
          * boatScore(race.racers[String(second)], race.preview?.racers?.[String(second)], 2)
          * boatScore(race.racers[String(third)], race.preview?.racers?.[String(third)], 3);
        combinations.push({ combination: [first, second, third], score });
      }
    }
  }
  combinations.sort((a, b) => b.score - a.score || a.combination.join("").localeCompare(b.combination.join("")));
  const total = combinations.reduce((sum, item) => sum + item.score, 0) || 1;
  return combinations.map((item) => ({ combination: item.combination, score: item.score / total }));
}

export function predictRace(race, metadata) {
  const ranked = rankPredictions(race);
  return {
    prediction: ranked[0].combination,
    candidates: ranked.slice(0, 3),
    informationStatus: metadata.informationStatus,
    source: "boatraceopenapi",
    sourceUrl: metadata.sourceUrl,
    fetchedAt: metadata.fetchedAt,
    inputHash: metadata.sourceHash,
    modelVersion: "race-v1",
  };
}
