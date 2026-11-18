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
    focus() { this.focused = true; },
    getBoundingClientRect() { return { left: 100, width: 320 }; } };
}

function setup(session, { unit = 'C', readOnly = false } = {}) {
  const ids = { 'heart-chart-content': element('div'), 'chart-readout': element('span'), 'chart-chips': element('div'), 'chart-colors': element('div'), 'chart-colors-btn': element('button'), 'stage-colors': element('div'), 'stage-colors-btn': element('button') };
  const fetches = [], timers = [], docHandlers = {};
  const ctx = vm.createContext({
    $: id => ids[id], unit, readOnly,
    document: { createElement: element, createElementNS: (_, tag) => element(tag), addEventListener(type, fn) { (docHandlers[type] ||= []).push(fn); }, removeEventListener(type, fn) { docHandlers[type] = (docHandlers[type] || []).filter(f => f !== fn); } },
    fetch: async (url, init) => { fetches.push({ url, init }); return { ok: true }; },
    api: async () => ({ prefs: {} }),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
  });
  vm.runInContext(code, ctx);
  ctx.renderSessionChart(session);
  const svg = () => ids['heart-chart-content'].children[0];
  const prefs = () => vm.runInContext('chartPrefs', ctx);
  return { ctx, ids, svg, fetches, timers, prefs, docHandlers };
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
  const input = rows[0].children[2];
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
  assert.equal(locked.ids['chart-colors'].children[0].children[2].disabled, true);
  assert.equal(locked.ids['chart-colors'].children[0].children[0].disabled, true);  // drag handle
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

test('hourly streams stay connected, show markers, and keep a readout across the hour', () => {
  const session = { series: { ...series('heartRate', 40, 60, 5), ...series('tempBedC', 4, 20, 60), ...series('respiratoryRate', 4, 16, 60) } };
  const t = setup(session);
  t.prefs().active.push('tempBedC', 'respiratoryRate');
  t.ctx.renderSessionChart();
  const paths = t.svg().children.filter(n => n.tag === 'path');
  assert.equal(paths.length, 3);
  for (const p of paths) assert.match(p.attrs.d, /L/, 'every stream draws a connected line');
  assert.equal(t.ids['heart-chart-content'].children.some(n => /Unusually long gaps/.test(n.textContent)), false);
  assert.ok(t.svg().children.filter(n => n.tag === 'circle' && n.attrs.class === 'chart-point').length >= 8, 'sparse streams show sample dots');
  t.svg().handlers.click({ clientX: 100 + 36 + 0.4 * 274 });
  assert.match(t.ids['chart-readout'].textContent, /Bed \d+°C · Resp \d+\.\d$/);
});

test('a long dropout in a dense stream is not connected', () => {
  const dense = [...Array.from({ length: 10 }, (_, i) => ({ timestamp: minute(i * 5), value: 60 + i })), ...Array.from({ length: 10 }, (_, i) => ({ timestamp: minute(300 + i * 5), value: 70 + i }))];
  const t = setup({ series: { heartRate: dense } });
  assert.equal((t.svg().children.find(n => n.tag === 'path').attrs.d.match(/M/g) || []).length, 2);
  assert.ok(t.ids['heart-chart-content'].children.some(n => /Unusually long gaps/.test(n.textContent)));
});

test('closing a colour picker saves at once, and only when one was open', () => {
  const t = setup(null);
  t.ids['stage-colors'].hidden = false;
  t.ctx.saveChartPrefs();                       // a debounced save is pending
  assert.equal(t.fetches.length, 0);
  assert.equal(t.ctx.closeColorPopovers(), true);
  assert.equal(t.ids['stage-colors'].hidden, true);
  assert.equal(t.ids['stage-colors-btn'].attrs['aria-expanded'], 'false');
  assert.equal(t.fetches.length, 1);
  assert.equal(t.fetches[0].init.method, 'PUT');
  assert.equal(t.ctx.closeColorPopovers(), false);  // nothing open: no extra request
  assert.equal(t.fetches.length, 1);
});

test('opening one picker closes the other, and read-only never saves', () => {
  const t = setup(null);
  t.ids['chart-colors'].hidden = false;
  t.ids['stage-colors'].hidden = true;
  t.ctx.toggleColorPopover('stage-colors', 'stage-colors-btn', () => {});
  assert.equal(t.ids['chart-colors'].hidden, true);
  assert.equal(t.ids['stage-colors'].hidden, false);
  assert.equal(t.fetches.length, 1);
  const locked = setup(null, { readOnly: true });
  locked.ids['chart-colors'].hidden = false;
  assert.equal(locked.ctx.closeColorPopovers(), true);
  assert.equal(locked.fetches.length, 0);
});

const names = list => list.map(n => n.children[1].textContent);

test('colour list, chips and readout follow the saved order', () => {
  const session = { series: { ...series('heartRate', 5, 60), ...series('hrv', 5, 40), ...series('tempBedC', 5, 20) } };
  const t = setup(session);
  assert.deepEqual([...t.prefs().order], ['heartRate', 'hrv', 'tempBedC', 'respiratoryRate', 'tempRoomC']);
  t.ctx.moveStream('tempBedC', 0);
  t.prefs().active.push('hrv', 'tempBedC');
  t.ctx.renderSessionChart();
  assert.deepEqual([...t.prefs().order], ['tempBedC', 'heartRate', 'hrv', 'respiratoryRate', 'tempRoomC']);
  assert.deepEqual(t.ids['chart-chips'].children.map(c => c.children[1].textContent), ['Bed Temp', 'Heart Rate', 'HRV', 'Resp Rate', 'Room Temp']);
  t.svg().handlers.keydown({ key: 'Home', preventDefault() {} });
  assert.match(t.ids['chart-readout'].textContent, /Bed 20°C · HR 60 · HRV 40$/);
  t.ctx.renderChartColors();
  assert.deepEqual(t.ids['chart-colors'].children.slice(0, 5).map(r => r.children[1].textContent), ['Bed Temp', 'Heart Rate', 'HRV', 'Resp Rate', 'Room Temp']);
});

test('moving a row with the arrow keys reorders, saves, and keeps focus on the moved row', () => {
  const t = setup(null);
  const box = t.ids['chart-colors'];
  box.querySelectorAll = () => box.children.filter(c => c._key);
  t.ctx.renderChartColors();
  box.children[1]._handle.handlers.keydown({ key: 'ArrowUp', preventDefault() {} });   // HRV up
  assert.deepEqual([...t.prefs().order].slice(0, 2), ['hrv', 'heartRate']);
  assert.equal(box.children[0]._key, 'hrv');
  assert.equal(box.children[0]._handle.focused, true);
  t.timers[t.timers.length - 1]();
  assert.deepEqual(JSON.parse(t.fetches[0].init.body).order.slice(0, 2), ['hrv', 'heartRate']);
  box.children[0]._handle.handlers.keydown({ key: 'Enter', preventDefault() { throw Error('other keys are ignored'); } });
});

test('read-only devices cannot reorder, and reset restores the default order', () => {
  const locked = setup(null, { readOnly: true });
  locked.ctx.renderChartColors();
  const box = locked.ids['chart-colors'];
  box.querySelectorAll = () => box.children.filter(c => c._key);
  box.children[1]._handle.handlers.keydown({ key: 'ArrowUp', preventDefault() {} });
  assert.deepEqual([...locked.prefs().order].slice(0, 2), ['heartRate', 'hrv']);
  const t = setup(null);
  t.ctx.moveStream('hrv', 4);
  t.ctx.renderChartColors();
  t.ids['chart-colors'].children.at(-1).handlers.click();
  assert.deepEqual([...t.prefs().order], ['heartRate', 'hrv', 'tempBedC', 'respiratoryRate', 'tempRoomC']);
});

test('stored order is validated and completed', () => {
  const t = setup(null);
  assert.deepEqual([...t.ctx.normalizeChartPrefs({ order: ['hrv', 'bogus', 'hrv', 'tempRoomC'] }).order], ['hrv', 'tempRoomC', 'heartRate', 'tempBedC', 'respiratoryRate']);
  assert.deepEqual([...t.ctx.normalizeChartPrefs(null).order], ['heartRate', 'hrv', 'tempBedC', 'respiratoryRate', 'tempRoomC']);
});

test('dragging a row reorders through document-level listeners, so moving the row cannot lose the drag', () => {
  const t = setup(null);
  const box = t.ids['chart-colors'];
  t.ctx.renderChartColors();
  const rows = () => box.children.filter(c => c._key);
  box.querySelectorAll = () => rows();
  box.insertBefore = (node, ref) => { box.children = box.children.filter(c => c !== node); const i = ref ? box.children.indexOf(ref) : box.children.length; box.children.splice(i < 0 ? box.children.length : i, 0, node); };
  rows().forEach((r, i) => { r.getBoundingClientRect = () => ({ top: i * 36 + 300, height: 28 }); r.nextSibling = box.children[box.children.indexOf(r) + 1] || null; });
  const grab = rows()[3];                                           // Resp Rate
  let prevented = false;
  grab.handlers.pointerdown({ button: 0, target: { closest: () => null }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.ok(t.docHandlers.pointermove?.length === 1 && t.docHandlers.pointerup?.length === 1);
  assert.equal(grab.handlers.pointermove, undefined);               // nothing hangs off the moving element
  t.docHandlers.pointermove[0]({ clientY: 310 });                   // pointer above the first row
  assert.equal(box.children[0]._key, 'respiratoryRate');
  t.docHandlers.pointerup[0]();
  assert.deepEqual([...t.prefs().order].slice(0, 2), ['respiratoryRate', 'heartRate']);
  assert.deepEqual(t.docHandlers.pointermove, []);                  // listeners removed after the drop
  t.timers[t.timers.length - 1]();
  assert.deepEqual(JSON.parse(t.fetches[0].init.body).order.slice(0, 2), ['respiratoryRate', 'heartRate']);
});

test('pressing on the colour swatch or on a read-only list does not start a drag', () => {
  const t = setup(null);
  t.ctx.renderChartColors();
  const row = t.ids['chart-colors'].children[0];
  row.handlers.pointerdown({ button: 0, target: { closest: () => ({}) }, preventDefault() { throw Error('swatch must stay a normal click'); } });
  assert.equal(t.docHandlers.pointermove, undefined);
  const locked = setup(null, { readOnly: true });
  locked.ctx.renderChartColors();
  locked.ids['chart-colors'].children[0].handlers.pointerdown({ button: 0, target: { closest: () => null }, preventDefault() { throw Error('read-only'); } });
  assert.equal(locked.docHandlers.pointermove, undefined);
});

test('saved preferences are requested when the page starts', () => {
  // Regression: an edit once dropped the startup call, so colors, indicators and order were saved but never loaded.
  assert.match(source, /^void loadChartPrefs\(\);\r?$/m);
});
