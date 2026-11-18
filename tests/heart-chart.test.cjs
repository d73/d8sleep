const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('// --- Session chart ---'), source.indexOf('async function pollSession()'));

function element(tag) {
  return { tag, attrs: {}, children: [], handlers: {}, style: {}, textContent: '', hidden: false, disabled: false,
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    getBoundingClientRect() { return { left: 100, width: 320 }; } };
}

function setup(session, { unit = 'C', readOnly = false } = {}) {
  const ids = { 'heart-chart-content': element('div'), 'chart-readout': element('span'), 'chart-chips': element('div'), 'chart-colors': element('div') };
  const fetches = [], timers = [];
  const ctx = vm.createContext({
    $: id => ids[id], unit, readOnly,
    document: { createElement: element, createElementNS: (_, tag) => element(tag) },
    fetch: async (url, init) => { fetches.push({ url, init }); return { ok: true }; },
    api: async () => ({ prefs: {} }),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
  });
  vm.runInContext(code, ctx);
  ctx.renderSessionChart(session);
  const svg = () => ids['heart-chart-content'].children[0];
  const prefs = () => vm.runInContext('chartPrefs', ctx);
  return { ctx, ids, svg, fetches, timers, prefs };
}

const minute = i => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
const series = (key, count, base, step = 1) => ({ [key]: Array.from({ length: count }, (_, i) => ({ timestamp: minute(i * step), value: base + i })) });

test('single indicator: dense samples select the nearest time on pointer, tap and keys', () => {
  const t = setup({ series: series('heartRate', 301, 50) });
  const svg = t.svg(), clientX = i => 100 + 36 + i / 300 * 274;
  assert.equal(svg.attrs.tabindex, '0');
  svg.handlers.pointermove({ clientX: clientX(101) });
  assert.match(t.ids['chart-readout'].textContent, /· HR 151$/);
  svg.handlers.pointermove({ clientX: clientX(102) });
  assert.match(t.ids['chart-readout'].textContent, /· HR 152$/);
  svg.handlers.click({ clientX: clientX(200) });
  assert.match(t.ids['chart-readout'].textContent, /· HR 250$/);
  let prevented = false;
  svg.handlers.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(t.ids['chart-readout'].textContent, /· HR 251$/);
});

test('legacy heart_rate_series still draws when no series object is present', () => {
  const t = setup({ heart_rate_series: [{ timestamp: minute(0), value: 61.6 }, { timestamp: 'invalid', value: 20 }] });
  t.svg().handlers.click({ clientX: 200 });
  assert.match(t.ids['chart-readout'].textContent, /· HR 62$/);
});

test('several indicators overlay with exact values and a dash where a stream has no nearby sample', () => {
  const session = { series: { ...series('heartRate', 5, 60, 15), hrv: [{ timestamp: minute(0), value: 40 }, { timestamp: minute(1), value: 41 }], respiratoryRate: series('respiratoryRate', 5, 14.2, 15).respiratoryRate } };
  const t = setup(session);
  t.prefs().active = ['heartRate', 'hrv', 'respiratoryRate'];
  t.ctx.renderSessionChart();
  t.svg().handlers.keydown({ key: 'End', preventDefault() {} });
  assert.match(t.ids['chart-readout'].textContent, /HR 64 · HRV — · Resp 18\.2$/);
  t.svg().handlers.keydown({ key: 'Home', preventDefault() {} });
  assert.match(t.ids['chart-readout'].textContent, /HR 60 · HRV 40 · Resp 14\.2$/);
});

test('temperature follows the Fahrenheit or Celsius preference', () => {
  const session = { series: series('tempBedC', 3, 20) };
  for (const [unit, expected] of [['F', /Bed 68°F$/], ['C', /Bed 20°C$/]]) {
    const t = setup(session, { unit });
    t.prefs().active = ['tempBedC'];
    t.ctx.renderSessionChart();
    t.svg().handlers.keydown({ key: 'Home', preventDefault() {} });
    assert.match(t.ids['chart-readout'].textContent, expected);
  }
});

test('empty, unselected and single-sample states', () => {
  assert.match(setup(null).ids['heart-chart-content'].children[0].textContent, /No samples/);
  const none = setup({ series: series('heartRate', 3, 60) });
  none.prefs().active = [];
  none.ctx.renderSessionChart();
  assert.match(none.ids['heart-chart-content'].children[0].textContent, /Choose an indicator/);
  const one = setup({ series: { heartRate: [{ timestamp: minute(0), value: 61.6 }] } });
  one.svg().handlers.focus();
  assert.match(one.ids['chart-readout'].textContent, /· HR 62$/);
});

test('chips toggle indicators and save preferences with PUT', () => {
  const t = setup({ series: { ...series('heartRate', 3, 60), ...series('hrv', 3, 40) } });
  assert.equal(t.ids['chart-chips'].children.length, 5);
  const hrv = t.ids['chart-chips'].children[1];
  assert.equal(hrv.attrs['aria-pressed'], 'false');
  hrv.handlers.click();
  assert.deepEqual([...t.prefs().active], ['heartRate', 'hrv']);
  t.timers[t.timers.length - 1]();
  assert.equal(t.fetches[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(t.fetches[0].init.body).active, ['heartRate', 'hrv']);
});

test('colour pickers update and persist colours, and are disabled when read-only', () => {
  const t = setup(null);
  t.ctx.renderChartColors();
  const rows = t.ids['chart-colors'].children;
  const input = rows[0].children[1];
  assert.equal(input.type, 'color');
  input.value = '#112233';
  input.handlers.input();
  assert.equal(t.prefs().colors.heartRate, '#112233');
  t.timers[t.timers.length - 1]();
  assert.equal(JSON.parse(t.fetches[0].init.body).colors.heartRate, '#112233');
  rows[rows.length - 1].handlers.click();
  assert.equal(t.prefs().colors.heartRate, '#e57373');
  const locked = setup(null, { readOnly: true });
  locked.ctx.renderChartColors();
  assert.equal(locked.ids['chart-colors'].children[0].children[1].disabled, true);
  assert.equal(locked.ids['chart-colors'].children.at(-1).disabled, true);
});

test('stored preferences are validated', () => {
  const t = setup(null);
  const prefs = t.ctx.normalizeChartPrefs({ colors: { heartRate: '#ABCDEF', hrv: 'red', bogus: '#000000' }, active: ['hrv', 'nope', 'heartRate'] });
  assert.equal(prefs.colors.heartRate, '#abcdef');
  assert.equal(prefs.colors.hrv, '#64b5f6');
  assert.deepEqual([...prefs.active], ['heartRate', 'hrv']);
  assert.deepEqual([...t.ctx.normalizeChartPrefs(null).active], ['heartRate']);
});
