import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function option(value, code) {
  return {
    value,
    dataset: { stadiumCode: String(code), stadiumName: value },
    disabled: false,
    textContent: value,
    setAttribute(name, value) { this[name] = value; },
  };
}

function loadUi(options) {
  const make = () => ({
    textContent: '', childNodes: [], style: {}, className: 'slot', disabled: false,
    classList: { add() {}, remove() {} },
    addEventListener() {}, replaceChildren(...children) { this.childNodes = children; },
    appendChild(child) { this.childNodes.push(child); }, querySelector() { return make(); },
    removeAttribute() {},
  });
  const elements = new Map();
  for (const id of ['start-btn', 'race-development-text']) elements.set(id, make());
  const race = make();
  race.options = Array.from({ length: 12 }, (_, index) => ({ value: `${index + 1}R`, dataset: {}, disabled: false, textContent: '', setAttribute(name, value) { this[name] = value; } }));
  race.selectedIndex = 0; race.value = '1R';
  elements.set('race-select', race);
  const stadium = make(); stadium.options = options; stadium.selectedIndex = 0; stadium.value = options[0].value;
  elements.set('stadium-select', stadium);
  for (const id of ['slot-1', 'slot-2', 'slot-3']) elements.set(id, make());
  const context = vm.createContext({
    AbortController, Date, Intl, Math, console,
    document: {
      getElementById: id => elements.get(id),
      addEventListener() {},
      createElement: make,
      createDocumentFragment: make,
      querySelector: () => make(),
    },
    fetch: async () => ({ ok: true, json: async () => ({ stadiums: [] }) }),
    URLSearchParams,
  });
  vm.runInContext(readFileSync(join(root, 'script.js'), 'utf8'), context);
  return { stadium, race: elements.get('race-select'), context };
}

test('venue order remains north-to-south and uses stable stadium codes', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const codes = [...html.matchAll(/data-stadium-code="(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(codes, Array.from({ length: 24 }, (_, index) => index + 1));
});

test('non開催 venues remain visible but are disabled and labelled', () => {
  const options = [option('桐生', 1), option('戸田', 2), option('江戸川', 3)];
  const { stadium, context } = loadUi(options);
  context.applyStadiumAvailability([
    { stadiumCode: 1, hasRaces: true },
    { stadiumCode: 2, hasRaces: false },
  ]);
  assert.equal(options[0].disabled, false);
  assert.equal(options[0].textContent, '桐生');
  assert.equal(options[1].disabled, true);
  assert.equal(options[1].textContent, '戸田 | 非開催');
  assert.equal(options[2].disabled, true);
  assert.equal(options[2].textContent, '江戸川 | 非開催');
  assert.equal(stadium.value, '桐生');
});

test('availability is derived from the existing race search RPC', () => {
  const edge = readFileSync(join(root, 'supabase/functions/predictions/index.ts'), 'utf8');
  assert.match(edge, /action.*races/);
  assert.match(edge, /race_data_search_current_races/);
  assert.match(edge, /hasRaces: races\.length > 0/);
  assert.match(edge, /Access-Control-Allow-Methods.*GET, POST, OPTIONS/);
});

test('race deadlines are formatted in JST and closed races are disabled in place', () => {
  const options = [option('桐生', 1)];
  const { race, context } = loadUi(options);
  context.applyStadiumAvailability([{ stadiumCode: 1, hasRaces: true, races: [
    { raceNumber: 1, closedAt: '2026-09-23T00:00:00.000Z' },
    { raceNumber: 2, closedAt: '2026-09-23T01:00:00.000Z' },
  ] }]);
  context.applyRaceAvailability(1, new Date('2026-09-22T23:00:00.000Z'));
  assert.equal(race.options[0].disabled, false);
  assert.match(race.options[0].textContent, /^1R \| 09:00 締切予定$/);
  assert.equal(race.options[1].disabled, false);
  context.applyRaceAvailability(1, new Date('2026-09-23T00:30:00.000Z'));
  assert.equal(race.options[0].disabled, true);
  assert.equal(race.options[0].textContent, '1R | 締切');
  assert.equal(race.options[1].disabled, false);
  assert.match(race.options[1].textContent, /^2R \| 10:00 締切予定$/);
});

test('missing or malformed deadlines fail closed and do not remain selected', () => {
  const options = [option('桐生', 1)];
  const { race, context } = loadUi(options);
  context.applyStadiumAvailability([{ stadiumCode: 1, hasRaces: true, races: [
    { raceNumber: 1, closedAt: null },
    { raceNumber: 2, closedAt: 'not-a-date' },
    { raceNumber: 3, closedAt: '2099-12-31T00:00:00.000Z' },
  ] }]);
  context.applyRaceAvailability(1, new Date('2026-09-23T00:00:00.000Z'));
  assert.equal(race.options[0].disabled, true);
  assert.equal(race.options[1].disabled, true);
  assert.equal(race.options[2].disabled, false);
  assert.equal(race.value, '3R');
});
