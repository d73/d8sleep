const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('// --- Session summary ---'), source.indexOf('async function pollSession()'));

function element(tag) {
  return { tag, attrs: {}, children: [], handlers: {}, style: {}, textContent: '', hidden: false, disabled: false,
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    focus() { this.focused = true; }, getBoundingClientRect() { return { left: 0, width: 320 }; } };
}
const ids = {};
function setup(session, { unit = 'C', readOnly = false } = {}) {
  for (const id of ['session-state', 'summary-score', 'summary-asleep', 'summary-window', 'session-bio', 'session-updated', 'night-switcher', 'session-stages-content', 'stage-colors',
    'heart-chart-content', 'chart-readout', 'chart-chips', 'chart-colors']) ids[id] = element('div');
  const fetches = [], timers = [], events = {};
  const ctx = vm.createContext({
    $: id => ids[id], unit, readOnly, selected: 'left', sessionSide: 'left', sessionData: session, sessionCheckedAt: null,
    when: v => String(v), document: { createElement: element, createElementNS: (_, tag) => element(tag), createTextNode: text => ({ tag: '#text', textContent: text, children: [] }), addEventListener: (name, fn) => { events[name] = fn; } },
    fetch: async (url, init) => { fetches.push({ url, init }); return { ok: true }; }, api: async () => ({}),
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
  });
  vm.runInContext(code, ctx);
  ctx.renderSession();
  return { ctx, fetches, timers, events };
}
const texts = node => [node.textContent, ...node.children.flatMap(texts)].filter(Boolean);
const night = (start, overrides = {}) => ({
  start, sleep_start: start, sleep_end: new Date(Date.parse(start) + 7 * 3600e3).toISOString(), presence_end: null, duration: 27000, score: 82, incomplete: false,
  stages: [{ stage: 'awake', duration: 600 }, { stage: 'light', duration: 7200 }, { stage: 'deep', duration: 3600 }, { stage: 'rem', duration: 5400 }],
  stage_summary: { sleepDuration: 16200, totalDuration: 27000 },
  series: { heartRate: [{ timestamp: start, value: 50 }, { timestamp: start, value: 70 }], tempBedC: [{ timestamp: start, value: 20 }, { timestamp: start, value: 30 }] },
  metrics: {}, ...overrides });

test('score, duration, window, stages and average / min-max cards render for the selected night', () => {
  const t = setup({ ...night('2026-11-14T22:00:00Z'), sessions: [night('2026-11-14T22:00:00Z'), night('2026-11-13T22:00:00Z', { score: null })] });
  assert.equal(texts(ids['summary-score']).join('|'), '82');
  assert.equal(ids['summary-score'].attrs['aria-label'], 'Sleep score 82');
  assert.equal(ids['summary-asleep'].textContent, '4h 30m asleep');
  assert.match(ids['summary-window'].textContent, /–/);
  assert.match(ids['summary-window'].textContent, /7h 30m in bed/);
  assert.equal(texts(ids['session-state']).join('|'), 'Complete');
  const legend = texts(ids['session-stages-content']).join('|');
  assert.match(legend, /Deep 1h 00m \(21%\)/); assert.match(legend, /REM 1h 30m \(32%\)/); assert.match(legend, /Awake 10m \(4%\)/);
  const bio = ids['session-bio'].children.map(cell => texts(cell).join('/'));
  assert.equal(bio.length, 5);
  assert.equal(bio[0], 'HR/60 bpm/50–70');
  assert.equal(bio[1], 'HRV/—/No data');
  assert.equal(bio[2], 'Bed/25°C/20–30°');
  assert.equal(bio[3], 'Resp/—/No data');
});

test('session dropdown lists newest first and switches every summary', () => {
  const t = setup({ ...night('2026-11-14T22:00:00Z'), sessions: [night('2026-11-14T22:00:00Z'), night('2026-11-13T22:00:00Z', { score: null })] });
  let [menu] = ids['night-switcher'].children;
  let [label, choices] = menu.children;
  assert.equal(choices.size, 2);assert.equal(choices.children[0].selected,true);assert.equal(choices.children[1].selected,false);
  choices.value='1';choices.handlers.change();
  [menu] = ids['night-switcher'].children;[label, choices]=menu.children;
  assert.equal(choices.children[1].selected,true);
  assert.equal(vm.runInContext('nightIndex', t.ctx), 1);
  assert.equal(texts(ids['summary-score']).join('|'), '—');
  assert.equal(ids['summary-score'].attrs['aria-label'], 'Sleep score not reported');
  choices.value='0';choices.handlers.change();
  assert.equal(vm.runInContext('nightIndex', t.ctx), 0);
});

test('session list shows at most ten rows and retains all nights', () => {
  const nights=Array.from({length:14},(_,i)=>night(new Date(Date.UTC(2026,10,20-i,22)).toISOString()));
  const t=setup({...nights[0],sessions:nights});const [menu]=ids['night-switcher'].children;const [,choices]=menu.children;
  assert.equal(choices.size,10);assert.equal(choices.children.length,14);assert.equal(choices.children[0].value,'0');
  choices.value='13';choices.handlers.change();assert.equal(vm.runInContext('nightIndex',t.ctx),13);
});

test('duplicate dates show distinct times, and an open menu survives a refresh', () => {
  const nights=[night('2026-11-14T20:00:00Z'),night('2026-11-14T16:00:00Z')];
  const t=setup({...nights[0],sessions:nights});const [menu]=ids['night-switcher'].children;const [,choices]=menu.children;
  assert.notEqual(choices.children[0].textContent,choices.children[1].textContent);menu.open=true;t.ctx.renderSession();assert.equal(ids['night-switcher'].children[0],menu);
});

test('keyboard arrows navigate without committing until Enter', () => {
  const nights=[night('2026-11-14T20:00:00Z'),night('2026-11-13T20:00:00Z')];
  const t=setup({...nights[0],sessions:nights});const [menu]=ids['night-switcher'].children;const [,choices]=menu.children;
  menu.open=true;choices.selectedIndex=0;let prevented=false;choices.handlers.keydown({key:'ArrowDown',preventDefault(){prevented=true}});
  assert.equal(prevented,true);assert.equal(choices.selectedIndex,1);assert.equal(vm.runInContext('nightIndex',t.ctx),0);
  choices.value='1';choices.handlers.keydown({key:'Enter',preventDefault(){}});assert.equal(vm.runInContext('nightIndex',t.ctx),1);
});

test('clicking outside closes the open session list', () => {
  const nights=[night('2026-11-14T20:00:00Z'),night('2026-11-13T20:00:00Z')];
  const t=setup({...nights[0],sessions:nights});const box=ids['night-switcher'],[menu]=box.children;menu.open=true;
  box.contains=target=>target==='inside';box.querySelector=()=>menu;
  t.events.click({target:'inside'});assert.equal(menu.open,true);
  t.events.click({target:'outside'});assert.equal(menu.open,false);
});

test('completeness badge is hidden unless the API reports a boolean', () => {
  setup({ ...night('2026-11-14T22:00:00Z', { incomplete: null }) });assert.equal(ids['session-state'].hidden,true);
  setup({ ...night('2026-11-14T22:00:00Z', { incomplete: true }) });assert.equal(ids['session-state'].hidden,false);assert.equal(texts(ids['session-state']).join('|'),'Incomplete');
  setup({ ...night('2026-11-14T22:00:00Z', { incomplete: false }) });assert.equal(ids['session-state'].hidden,false);assert.equal(texts(ids['session-state']).join('|'),'Complete');
});

test('respiratory average keeps its unit and one decimal', () => {
  const resp = night('2026-11-14T22:00:00Z', { series: { respiratoryRate: [{ timestamp: '2026-11-14T22:00:00Z', value: 14 }, { timestamp: '2026-11-14T23:00:00Z', value: 15.4 }] } });
  setup({ ...resp, sessions: [resp] });
  const bio = ids['session-bio'].children.map(cell => texts(cell).join('/'));
  assert.equal(bio[3], 'Resp/14.7 brpm/14.0–15.4');
});

test('Fahrenheit preference converts the temperature summary', () => {
  setup({ ...night('2026-11-14T22:00:00Z'), sessions: [night('2026-11-14T22:00:00Z')] }, { unit: 'F' });
  const bio = ids['session-bio'].children.map(cell => texts(cell).join('/'));
  assert.equal(bio[2], 'Bed/77°F/68–86°');
});

test('no session and missing stages show clear empty states', () => {
  setup(null);
  assert.match(texts(ids['session-stages-content']).join('|'), /No sleep stages/);
  assert.equal(ids['night-switcher'].hidden, true);
  setup({ ...night('2026-11-14T22:00:00Z', { stages: [] }), sessions: [night('2026-11-14T22:00:00Z', { stages: [] })] });
  assert.match(texts(ids['session-stages-content']).join('|'), /No sleep stages/);
});

test('stage colour pickers update the bar and legend, persist, reset, and lock when read-only', () => {
  const t = setup({ ...night('2026-11-14T22:00:00Z'), sessions: [night('2026-11-14T22:00:00Z')] });
  t.ctx.renderStageColors();
  const rows = ids['stage-colors'].children;
  assert.equal(rows.length, 5);
  const deep = rows[0].children[1];
  deep.value = '#102030';
  deep.handlers.input();
  assert.equal(vm.runInContext('chartPrefs.stageColors.deep', t.ctx), '#102030');
  const bar = ids['session-stages-content'].children[0];
  assert.ok(bar.children.some(seg => seg.style.background === '#102030'));
  t.timers[t.timers.length - 1]();
  assert.equal(JSON.parse(t.fetches[0].init.body).stageColors.deep, '#102030');
  rows[4].handlers.click();
  assert.equal(vm.runInContext('chartPrefs.stageColors.deep', t.ctx), '#5c6bc0');
  const locked = setup({ ...night('2026-11-14T22:00:00Z'), sessions: [night('2026-11-14T22:00:00Z')] }, { readOnly: true });
  locked.ctx.renderStageColors();
  assert.equal(ids['stage-colors'].children[0].children[1].disabled, true);
  assert.equal(ids['stage-colors'].children.at(-1).disabled, true);
});

test('stored stage colours are validated', () => {
  const t = setup(null);
  const prefs = t.ctx.normalizeChartPrefs({ stageColors: { deep: '#ABCDEF', rem: 'blue', bogus: '#000000' } });
  assert.equal(prefs.stageColors.deep, '#abcdef');
  assert.equal(prefs.stageColors.rem, '#ba68c8');
  assert.equal(Object.keys(prefs.stageColors).length, 4);
});
