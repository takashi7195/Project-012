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
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  const stadium = stadiumSelect.value;
  const dist = calculateDistribution(stadium);
  const result = selectCombination(dist);

  // result[0]=1着(slot-1), result[1]=2着(slot-2), result[2]=3着(slot-3)
  // 演出順: 3着(slot-3) -> 2着(slot-2) -> 1着(slot-1)

  // 全て回転開始
  slots.forEach((slot, index) => {
    const reel = slot.querySelector('.reel');
    populateReel(reel);
    // 回転開始時の位相をずらす (0ms, 150ms, 300ms)
    reel.style.animationDelay = `${index * 150}ms`;
    slot.classList.add('spinning');
  });

  // 順番に停止：右(3着) -> 中央(2着) -> 左(1着)
  // STARTからの停止時間: 3秒, 9秒, 18秒
  await stopRoulette(slots[0], result[2], 3000);  // 右(slot-3)に3着
  await stopRoulette(slots[1], result[1], 6000);  // 中央(slot-2)に2着 (3000+6000=9000ms)
  await stopRoulette(slots[2], result[0], 9000);  // 左(slot-1)に1着 (9000+9000=18000ms)
  
  startBtn.disabled = false;
});

function startRoulette(slot) {
  // CSSアニメーションに変更したため、JavaScriptでのinterval制御は不要
}
async function stopRoulette(slot, finalBoat, delay) {
  return new Promise(resolve => {
    setTimeout(() => {
      const reel = slot.querySelector('.reel');

      // 1. 回転を停止し、現在の位置を固定
      const style = window.getComputedStyle(reel);
      const matrix = new WebKitCSSMatrix(style.transform);
      const currentY = matrix.m42;

      slot.classList.remove('spinning');
      reel.style.transform = `translateY(${currentY}px)`;

      // 2. 目標位置を計算 (現在の位置より「先」にある目的数字)
      const itemHeight = slot.querySelector('.item').getBoundingClientRect().height;
      let targetY = -(finalBoat - 1 + 6) * itemHeight; // 探索の基準をセット2の範囲に設定

      // 上→下へ回転しているのでtargetYはcurrentYより大きい値にする
      while (targetY <= currentY) {
          targetY += 6 * itemHeight;
      }
      // スクロール速度が速すぎないように、直近のターゲットを選択
      while (targetY - currentY > 6 * itemHeight) {
          targetY -= 6 * itemHeight;
      }

      // 3. アニメーション実行 (transitionで自然に減速して停止)
      const distance = Math.abs(targetY - currentY);
      const speed = 600; // px/s (animation 600px / 1s)
      const duration = Math.max(distance / speed, 0.5); // 最低0.5秒はかける

      requestAnimationFrame(() => {
        reel.style.transition = `transform ${duration}s cubic-bezier(0.2, 0.8, 0.3, 1)`;
        // 艇の位置を高さの倍数で保持し、画面回転・幅変更にも追従する。
        const targetIndex = Math.round(targetY / itemHeight);
        reel.style.transform = `translateY(calc(var(--item-height) * ${targetIndex}))`;
        // 停止後に確定したクラスを付与
        slot.className = `slot bg-${finalBoat}`;
      });

      setTimeout(() => {
        reel.style.transition = 'none';
        resolve();
      }, duration * 1000); // transition完了まで待つ
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
