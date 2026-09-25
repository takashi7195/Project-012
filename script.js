const CONFIG = {
  ipf: {
    maxIterations: 100,
    tolerance: 1e-6
  },
  sampling: {
    // 0 = 確率そのまま, 1 = 完全ランダム
    temperature: 0 
  },
  validation: {
    iterations: 100000
  }
};

const STADIUM_DATA = {
  "桐生": { 1: [49.8, 68.2, 77.8], 2: [11.8, 36.2, 54.7], 3: [13.4, 36.4, 55.3], 4: [13.4, 27.3, 46.8], 5: [9.0, 23.0, 42.9], 6: [2.6, 9.5, 23.7] },
  "戸田": { 1: [43.1, 60.9, 72.1], 2: [16.8, 40.5, 57.6], 3: [16.7, 36.7, 54.3], 4: [13.6, 31.0, 49.9], 5: [7.5, 22.0, 42.5], 6: [2.4, 9.6, 24.7] },
  "江戸川": { 1: [46.9, 66.5, 77.1], 2: [17.6, 41.1, 59.3], 3: [14.5, 36.0, 54.6], 4: [12.0, 27.2, 44.8], 5: [6.6, 19.3, 39.1], 6: [2.5, 10.9, 27.0] },
  "平和島": { 1: [45.7, 64.7, 75.6], 2: [16.0, 39.3, 59.6], 3: [15.9, 35.6, 54.2], 4: [13.4, 30.3, 48.4], 5: [6.6, 20.6, 37.6], 6: [2.6, 10.2, 25.9] },
  "多摩川": { 1: [54.3, 70.9, 80.2], 2: [12.9, 37.1, 56.7], 3: [13.0, 34.2, 54.5], 4: [11.1, 28.2, 47.7], 5: [6.1, 19.7, 37.5], 6: [2.5, 10.1, 24.1] },
  "浜名湖": { 1: [54.1, 71.6, 80.1], 2: [13.4, 39.0, 57.3], 3: [14.2, 35.3, 55.9], 4: [10.0, 26.1, 45.2], 5: [6.5, 19.9, 41.0], 6: [1.8, 8.4, 21.2] },
  "蒲郡": { 1: [58.0, 73.3, 83.0], 2: [11.9, 38.2, 57.2], 3: [10.8, 33.6, 54.8], 4: [11.1, 28.9, 49.6], 5: [6.2, 19.2, 37.3], 6: [1.9, 7.0, 18.7] },
  "常滑": { 1: [57.8, 73.1, 81.5], 2: [12.7, 37.1, 56.3], 3: [10.7, 32.9, 53.1], 4: [10.8, 28.2, 48.5], 5: [6.0, 20.4, 39.5], 6: [1.9, 8.6, 22.0] },
  "津": { 1: [57.4, 73.0, 81.9], 2: [13.5, 40.3, 58.6], 3: [11.1, 32.3, 52.7], 4: [9.7, 27.5, 48.6], 5: [6.2, 18.1, 36.9], 6: [2.1, 9.2, 22.0] },
  "三国": { 1: [51.6, 70.7, 79.1], 2: [15.2, 39.3, 58.2], 3: [14.6, 36.4, 55.2], 4: [10.3, 27.7, 47.7], 5: [6.2, 18.0, 37.4], 6: [2.1, 8.3, 23.2] },
  "びわこ": { 1: [53.7, 71.5, 80.1], 2: [13.8, 38.8, 57.5], 3: [14.4, 36.2, 55.8], 4: [9.7, 26.4, 46.4], 5: [6.7, 18.8, 36.9], 6: [1.8, 8.6, 24.2] },
  "住之江": { 1: [57.2, 74.2, 82.8], 2: [13.6, 40.1, 58.3], 3: [11.8, 33.9, 55.6], 4: [10.2, 27.2, 46.2], 5: [5.3, 17.1, 34.7], 6: [1.7, 7.5, 22.7] },
  "尼崎": { 1: [60.8, 76.1, 85.0], 2: [11.7, 37.6, 55.7], 3: [11.1, 33.1, 53.7], 4: [9.8, 27.4, 48.4], 5: [5.0, 19.0, 37.8], 6: [1.5, 7.1, 20.2] },
  "鳴門": { 1: [48.4, 66.2, 75.6], 2: [14.0, 38.3, 57.4], 3: [16.2, 36.5, 54.7], 4: [11.7, 29.9, 49.5], 5: [7.7, 19.8, 38.7], 6: [2.1, 10.1, 25.6] },
  "丸亀": { 1: [55.9, 73.4, 81.9], 2: [12.6, 38.6, 57.3], 3: [12.6, 33.0, 52.2], 4: [9.6, 26.9, 48.4], 5: [7.1, 19.2, 36.1], 6: [2.3, 9.4, 25.1] },
  "児島": { 1: [55.4, 72.5, 81.9], 2: [12.5, 37.9, 55.0], 3: [13.4, 33.4, 51.6], 4: [10.4, 28.3, 49.0], 5: [6.0, 18.3, 38.3], 6: [2.3, 9.8, 24.7] },
  "宮島": { 1: [56.7, 72.9, 81.4], 2: [12.3, 38.3, 57.6], 3: [13.1, 35.7, 57.2], 4: [10.2, 26.8, 46.2], 5: [5.9, 18.9, 38.0], 6: [1.7, 7.7, 20.4] },
  "徳山": { 1: [62.6, 79.2, 86.2], 2: [11.7, 39.5, 58.4], 3: [11.2, 33.3, 54.3], 4: [8.9, 25.6, 47.6], 5: [4.4, 16.6, 35.2], 6: [1.1, 6.1, 19.2] },
  "下関": { 1: [61.4, 78.8, 86.5], 2: [11.7, 36.3, 56.8], 3: [11.4, 35.2, 57.0], 4: [9.1, 25.6, 46.0], 5: [4.8, 16.7, 34.5], 6: [1.6, 7.6, 19.8] },
  "若松": { 1: [59.5, 75.5, 84.8], 2: [13.0, 37.6, 57.5], 3: [10.9, 34.5, 55.5], 4: [9.8, 27.8, 46.3], 5: [5.0, 16.8, 34.6], 6: [2.0, 8.1, 22.1] },
  "芦屋": { 1: [60.1, 76.1, 84.3], 2: [10.4, 34.3, 54.2], 3: [11.0, 33.3, 53.1], 4: [9.8, 28.2, 47.7], 5: [6.9, 21.2, 40.2], 6: [1.9, 7.5, 21.8] },
  "福岡": { 1: [57.5, 74.6, 83.5], 2: [14.7, 41.8, 61.9], 3: [15.1, 38.8, 56.9], 4: [8.1, 24.1, 47.0], 5: [3.6, 16.7, 36.0], 6: [1.1, 4.4, 15.7] },
  "唐津": { 1: [56.1, 74.8, 83.0], 2: [14.0, 41.1, 60.0], 3: [12.0, 34.8, 56.4], 4: [9.8, 24.7, 47.0], 5: [6.4, 18.1, 37.1], 6: [1.8, 7.0, 17.7] },
  "大村": { 1: [61.3, 78.2, 85.7], 2: [11.2, 37.7, 56.9], 3: [11.5, 34.9, 56.4], 4: [8.8, 24.0, 43.8], 5: [5.6, 17.8, 35.8], 6: [1.5, 7.5, 21.9] }
};

const startBtn = document.getElementById('start-btn');
const stadiumSelect = document.getElementById('stadium-select');
const raceSelect = document.getElementById('race-select');
const raceDevelopmentText = document.getElementById('race-development-text');
const PREDICTION_ENDPOINT = 'https://jxjxqfrtvdpvrifktxsf.supabase.co/functions/v1/predictions';
// Publishable keys are public client identifiers, never service-role secrets.
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ODGjHx6gmasNpY9b4kKVzQ_qIL6gq64';
let stadiumAvailability = new Map();
let stadiumAvailabilityReady = false;
let loadedAvailabilityDate = null;
let availabilityLoading = false;
function formatJstDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
const slots = [
  document.getElementById('slot-3'),
  document.getElementById('slot-2'),
  document.getElementById('slot-1')
];

function generateCombinations() {
  const combs = [];
  for (let i = 1; i <= 6; i++) {
    for (let j = 1; j <= 6; j++) {
      if (i === j) continue;
      for (let k = 1; k <= 6; k++) {
        if (k === i || k === j) continue;
        combs.push([i, j, k]);
      }
    }
  }
  return combs;
}

function calculateDistribution(stadium) {
  const data = STADIUM_DATA[stadium];
  const target = Array.from({ length: 3 }, () => Array(6).fill(0));
  
  for (let b = 1; b <= 6; b++) {
    const stats = data[b];
    target[0][b - 1] = stats[0];
    target[1][b - 1] = stats[1] - stats[0];
    target[2][b - 1] = stats[2] - stats[1];
  }

  for (let i = 0; i < 3; i++) {
    const sum = target[i].reduce((a, b) => a + b, 0);
    target[i] = target[i].map(v => v / sum);
  }

  const combs = generateCombinations();
  let weights = new Array(combs.length).fill(1.0);

  for (let iter = 0; iter < CONFIG.ipf.maxIterations; iter++) {
    let maxDiff = 0;
    for (let i = 0; i < 3; i++) {
      for (let b = 1; b <= 6; b++) {
        let current = 0;
        for (let c = 0; c < combs.length; c++) {
          if (combs[c][i] === b) current += weights[c];
        }
        if (current === 0) continue;
        const scale = target[i][b - 1] / current;
        for (let c = 0; c < combs.length; c++) {
          if (combs[c][i] === b) {
            weights[c] *= scale;
            maxDiff = Math.max(maxDiff, Math.abs(scale - 1));
          }
        }
      }
    }
    if (maxDiff < CONFIG.ipf.tolerance) break;
  }
  
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return combs.map((comb, i) => ({ comb, prob: weights[i] / totalWeight }));
}

function selectCombination(dist) {
  let r = Math.random();
  for (const item of dist) {
    r -= item.prob;
    if (r <= 0) return item.comb;
  }
  return dist[dist.length - 1].comb;
}

// 共通化：リール生成処理
function populateReel(reel) {
  reel.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    for (let b = 1; b <= 6; b++) {
      const item = document.createElement('div');
      item.className = `item bg-${b}`;
      const number = document.createElement('span');
      number.className = 'boat-number';
      number.textContent = b;
      item.appendChild(number);
      reel.appendChild(item);
    }
  }
}

// 初期表示処理
document.addEventListener('DOMContentLoaded', () => {
  slots.forEach((slot, index) => {
    const reel = slot.querySelector('.reel');
    populateReel(reel);
    // 初期表示: slot-1->1, slot-2->2, slot-3->3
    // slots = [slot-3, slot-2, slot-1]
    // index 0(slot-3) -> 3, index 1(slot-2) -> 2, index 2(slot-1) -> 1
    const offset = 2 - index; // 3->2, 2->1, 1->0
    reel.style.transform = `translateY(calc(var(--item-height) * -${12 + offset}))`;
  });
  loadStadiumAvailability();
});

function stadiumCodeForOption(option) {
  if (!option || option.value === '') return null;
  const code = Number(option?.dataset?.stadiumCode);
  return Number.isInteger(code) && code > 0 ? code : Array.from(stadiumSelect.options).indexOf(option) + 1;
}

function venueHasOpenRaces(stadium, now = new Date()) {
  return Boolean(stadium?.races?.some((race) => {
    const deadline = new Date(race?.closedAt ?? '');
    return Number.isFinite(deadline.getTime()) && now.getTime() < deadline.getTime();
  }));
}

function applyStadiumAvailability(stadiums, now = new Date()) {
  stadiumAvailability = new Map((Array.isArray(stadiums) ? stadiums : []).map((stadium) => [Number(stadium.stadiumCode), stadium]));
  for (const option of stadiumSelect.options) {
    if (option.value === '') {
      option.disabled = false;
      option.dataset.available = 'false';
      option.textContent = '会場';
      option.setAttribute('aria-label', '会場');
      continue;
    }
    const stadium = stadiumAvailability.get(stadiumCodeForOption(option));
    const available = venueHasOpenRaces(stadium, now);
    option.disabled = !available;
    option.dataset.available = available ? 'true' : 'false';
    const baseName = option.dataset.stadiumName || option.value;
    option.textContent = baseName;
    option.setAttribute('aria-label', option.textContent);
  }
  const selected = stadiumSelect.options[stadiumSelect.selectedIndex];
  if (selected?.disabled) {
    stadiumSelect.value = '';
    raceSelect.value = '';
    activePrediction?.abort();
    clearPredictionDisplay();
  }
  applyRaceAvailability(stadiumCodeForOption(stadiumSelect.options[stadiumSelect.selectedIndex]));
  return Array.from(stadiumSelect.options).some((option) => option.value !== '' && !option.disabled);
}

function formatJstTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function applyRaceAvailability(stadiumCode, now = new Date()) {
  const stadium = stadiumAvailability.get(Number(stadiumCode));
  const previousValue = raceSelect.value;
  let hasSelectableRace = false;
  for (const option of raceSelect.options) {
    if (option.value === '') {
      option.disabled = false;
      option.dataset.available = 'false';
      option.textContent = 'レース';
      option.setAttribute('aria-label', 'レース');
      continue;
    }
    const raceNumber = Number.parseInt(option.value, 10);
    const race = stadium?.races?.find((item) => Number(item.raceNumber) === raceNumber);
    const deadline = race?.closedAt ? new Date(race.closedAt) : null;
    const validDeadline = deadline && Number.isFinite(deadline.getTime());
    const open = Boolean(validDeadline && now.getTime() < deadline.getTime());
    option.disabled = !open;
    option.dataset.available = open ? 'true' : 'false';
    const raceLabel = `${raceNumber}R`;
    const deadlineLabel = open ? `${formatJstTime(deadline)} 締切予定` : '締切';
    option.textContent = `${raceLabel}　${deadlineLabel}`;
    option.setAttribute('aria-label', open ? `${raceLabel}、${deadlineLabel}` : `${raceLabel}、締切`);
    if (open) hasSelectableRace = true;
  }
  const selected = raceSelect.options[raceSelect.selectedIndex];
  if (selected?.disabled) {
    raceSelect.value = '';
  }
  if (raceSelect.value !== previousValue) {
    activePrediction?.abort();
    clearPredictionDisplay();
  }
  updateStartAvailability(hasSelectableRace);
  return hasSelectableRace;
}

function updateStartAvailability(hasSelectableRace = null) {
  if (!startBtn) return;
  if (!stadiumSelect.options || !raceSelect.options) {
    startBtn.disabled = false;
    return;
  }
  const stadiumOption = stadiumSelect.options?.[stadiumSelect.selectedIndex];
  const raceOption = raceSelect.options?.[raceSelect.selectedIndex];
  const stadiumReady = stadiumAvailabilityReady && stadiumOption && stadiumOption.value !== '' && !stadiumOption.disabled;
  const raceReady = raceOption && raceOption.value !== '' && !raceOption.disabled;
  startBtn.disabled = hasSelectableRace === false || !stadiumReady || !raceReady;
}

async function loadStadiumAvailability(raceDate = formatJstDate(), { preserveOnError = false } = {}) {
  if (availabilityLoading) return;
  availabilityLoading = true;
  stadiumSelect.disabled = true;
  startBtn.disabled = true;
  for (const option of stadiumSelect.options) option.disabled = true;
  try {
    const response = await fetch(`${PREDICTION_ENDPOINT}?action=races&raceDate=${encodeURIComponent(raceDate)}`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    if (!response.ok) throw new Error(`stadium_availability_${response.status}`);
    const body = await response.json();
    stadiumAvailabilityReady = applyStadiumAvailability(body.stadiums, new Date());
    loadedAvailabilityDate = body.raceDate || raceDate;
  } catch (error) {
    // Keep a previously valid snapshot during a transient refresh failure, but
    // still reapply current deadlines so closed races cannot remain selectable.
    if (preserveOnError && stadiumAvailability.size) {
      applyStadiumAvailability(Array.from(stadiumAvailability.values()), new Date());
    } else {
      stadiumAvailabilityReady = false;
      applyStadiumAvailability([]);
    }
    console.warn('会場開催情報を取得できませんでした', error);
  } finally {
    stadiumSelect.disabled = false;
    availabilityLoading = false;
    updateStartAvailability();
  }
}

let activePrediction = null;
function clearPredictionDisplay(message = '') {
  for (const kind of ['counter', 'longshot']) setPredictionRow(kind, null);
  slots.forEach(slot => {
    slot.className = 'slot';
    slot.classList.remove('spinning');
    const reel = slot.querySelector('.reel');
    reel.style.transform = '';
    reel.replaceChildren();
    const placeholder = document.createElement('div');
    placeholder.className = 'item';
    placeholder.textContent = '—';
    reel.appendChild(placeholder);
  });
  if (raceDevelopmentText) raceDevelopmentText.textContent = message;
}
for (const select of [stadiumSelect, raceSelect]) select.addEventListener('change', () => {
  if (select === stadiumSelect && stadiumSelect.options?.[stadiumSelect.selectedIndex]?.disabled) return;
  if (select === stadiumSelect && stadiumSelect.options) {
    raceSelect.value = '';
    applyRaceAvailability(stadiumCodeForOption(stadiumSelect.options[stadiumSelect.selectedIndex]));
  }
  else if (select === raceSelect && raceSelect.options?.[raceSelect.selectedIndex]?.disabled) return;
  activePrediction?.abort();
  clearPredictionDisplay();
});
if (typeof setInterval === 'function') setInterval(() => {
  if (!stadiumAvailability.size) return;
  const raceDate = formatJstDate();
  if (loadedAvailabilityDate !== raceDate) {
    loadStadiumAvailability(raceDate);
    return;
  }
  applyStadiumAvailability(Array.from(stadiumAvailability.values()), new Date());
}, 60_000);
if (typeof setInterval === 'function') setInterval(() => {
  const raceDate = formatJstDate();
  loadStadiumAvailability(raceDate, { preserveOnError: true });
}, 5 * 60_000);
async function requestPrediction(signal) {
  if (!stadiumAvailabilityReady && stadiumSelect.options.length) throw new Error('開催情報を取得できません');
  const selectedOption = stadiumSelect.options[stadiumSelect.selectedIndex];
  if (!selectedOption || selectedOption.value === '') throw new Error('会場を選択してください');
  if (selectedOption.disabled) throw new Error('この会場は現在選択できません');
  const selectedRace = raceSelect.options[raceSelect.selectedIndex];
  if (!selectedRace || selectedRace.value === '') throw new Error('レースを選択してください');
  if (selectedRace.disabled) throw new Error('このレースは締切済みです');
  const stadiumCode = stadiumCodeForOption(selectedOption);
  const selector = { raceDate: formatJstDate(), stadiumCode, raceNumber: Number.parseInt(raceSelect.value, 10) };
  const { pollPrediction } = await import('./race-prediction/client.mjs');
  return pollPrediction(async signal => {
    const response = await fetch(PREDICTION_ENDPOINT, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify(selector) });
    return { status: response.status, body: await response.json() };
  }, { signal, onGenerating: () => {
    startBtn.textContent = '生成中…';
    if (raceDevelopmentText) raceDevelopmentText.textContent = '予想を生成中です…';
  } });
}

function setPredictionRow(kind, combination) {
  const target = document.querySelector(`[data-prediction="${kind}"]`);
  if (!target) return;
  if (!Array.isArray(combination)) { target.textContent = '—'; return; }
  target.replaceChildren(...combination.map((boat, index) => {
    const fragment = document.createDocumentFragment();
    const number = document.createElement('span');
    number.className = `prediction-boat bg-${boat}`;
    number.textContent = String(boat);
    fragment.appendChild(number);
    if (index < combination.length - 1) {
      const separator = document.createElement('span');
      separator.className = 'prediction-separator';
      separator.textContent = '-';
      fragment.appendChild(separator);
    }
    return fragment;
  }).flatMap((fragment) => [...fragment.childNodes]));
}

startBtn.addEventListener('click', async () => {
  if (activePrediction) return;
  const controller = new AbortController();
  activePrediction = controller;
  startBtn.disabled = true;
  stadiumSelect.disabled = raceSelect.disabled = true;
  startBtn.textContent = '取得中…';
  clearPredictionDisplay('予想データを取得しています…');
  try {
    const prediction = await requestPrediction(controller.signal);
    if (controller.signal.aborted) return;
    const result = prediction.main;
    setPredictionRow('counter', prediction.counter);
    setPredictionRow('longshot', prediction.hole);
    if (raceDevelopmentText) raceDevelopmentText.textContent = prediction.narrative;
    slots.forEach((slot, index) => {
      populateReel(slot.querySelector('.reel'));
      slot.querySelector('.reel').style.animationDelay = `${index * 150}ms`;
      slot.classList.add('spinning');
    });
    await stopRoulette(slots[0], result[2], 3000);
    await stopRoulette(slots[1], result[1], 6000);
    await stopRoulette(slots[2], result[0], 9000);
  } catch (error) {
    clearPredictionDisplay(error.message);
  } finally {
    if (controller.signal.aborted) clearPredictionDisplay();
    activePrediction = null;
    stadiumSelect.disabled = raceSelect.disabled = false;
    updateStartAvailability();
    startBtn.textContent = 'START';
    startBtn.removeAttribute('aria-label');
    startBtn.removeAttribute('title');
  }
});

function calculateStopMotion(position, finalBoat) {
  // 単位は艇1個分。通常回転は6艇/秒なので端末幅に依存しない。
  const speed = 6;
  let distance = ((-(finalBoat - 1) - position) % 6 + 6) % 6;
  // 近すぎると急停止するため、必要ならもう1周分進む。
  if (distance < 3) distance += 6;
  return { distance, duration: 2 * distance / speed };
}

function setReelPosition(reel, position) {
  // 同じ数字が並ぶ中央の周回へ戻す。見える内容は連続する。
  const wrapped = -12 + ((position + 12) % 6 + 6) % 6;
  reel.style.transform = `translateY(calc(var(--item-height) * ${wrapped}))`;
}

async function stopRoulette(slot, finalBoat, delay) {
  return new Promise(resolve => {
    setTimeout(() => {
      const reel = slot.querySelector('.reel');
      requestAnimationFrame(startTime => {
        const matrix = new DOMMatrixReadOnly(window.getComputedStyle(reel).transform);
        const itemHeight = slot.querySelector('.item').getBoundingClientRect().height;
        const position = matrix.m42 / itemHeight;
        const { distance, duration } = calculateStopMotion(position, finalBoat);

        // 同じ描画フレームで位置を引き継ぎ、CSS回転から減速へ移行。
        reel.style.transition = 'none';
        slot.classList.remove('spinning');
        setReelPosition(reel, position);

        function decelerate(now) {
          const progress = Math.min((now - startTime) / (duration * 1000), 1);
          // 等減速: 開始速度は6艇/秒、終了速度は0。加速・逆走しない。
          const eased = progress * (2 - progress);
          setReelPosition(reel, position + distance * eased);
          if (progress < 1) {
            requestAnimationFrame(decelerate);
          } else {
            // 浮動小数点誤差を除き、幅変更後も確定数字の中央を維持。
            setReelPosition(reel, -(finalBoat - 1));
            slot.className = `slot bg-${finalBoat}`;
            resolve();
          }
        }
        requestAnimationFrame(decelerate);
      });
    }, delay);
  });
}

function runValidation(stadium, iterations) {
  const dist = calculateDistribution(stadium);
  const results = { 1: new Array(6).fill(0), 2: new Array(6).fill(0), 3: new Array(6).fill(0) };
  
  for (let i = 0; i < iterations; i++) {
    const comb = selectCombination(dist);
    for (let j = 0; j < 3; j++) results[j + 1][comb[j] - 1]++;
  }

  const data = STADIUM_DATA[stadium];
  console.log(`--- Validation: ${stadium} ---`);
  
  let totalMae = 0;
  for (let i = 0; i < 3; i++) {
    console.log(`着順: ${i + 1}`);
    for (let b = 1; b <= 6; b++) {
      const actual = results[i + 1][b - 1] / iterations;
      let target;
      if (i === 0) target = data[b][0];
      else if (i === 1) target = data[b][1] - data[b][0];
      else target = data[b][2] - data[b][1];
      
      const sum = [1,2,3,4,5,6].reduce((s, x) => {
        let v;
        if(i===0) v=data[x][0];
        else if(i===1) v=data[x][1]-data[x][0];
        else v=data[x][2]-data[x][1];
        return s+v;
      }, 0);
      const normalizedTarget = target / sum;
      
      console.log(`  艇番 ${b}: 目標=${normalizedTarget.toFixed(4)}, 実測=${actual.toFixed(4)}, 誤差=${Math.abs(normalizedTarget - actual).toFixed(4)}`);
      totalMae += Math.abs(normalizedTarget - actual);
    }
  }
  console.log(`MAE: ${(totalMae / 18).toFixed(6)}`);
  
  const sorted = dist.sort((a, b) => b.prob - a.prob);
  console.log(`最大確率の組み合わせ: ${sorted[0].comb.join('-')} (${sorted[0].prob.toFixed(4)})`);
  console.log(`最小確率の組み合わせ: ${sorted[sorted.length - 1].comb.join('-')} (${sorted[sorted.length - 1].prob.toFixed(4)})`);
}
