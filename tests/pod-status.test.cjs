const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8').replace(/\r\n/g, '\n');
const code = source.slice(source.indexOf('function whenShort('), source.indexOf('let sessionRequest='));

function element(tag) {
  return { tag, children: [], attrs: {}, style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, textContent: '', className: '',
    setAttribute(k, v) { this.attrs[k] = v; }, append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; } };
}
const texts = node => [node.textContent, ...node.children.flatMap(texts)].filter(Boolean);

function render(device, side) {
  const ids = { 'status-strip': element('div'), 'live-status': element('div'), 'live-details': element('div'), 'pod-side-heading': element('h3') };
  const ctx = vm.createContext({
    $: id => ids[id], deviceData: device, sides: [side], selected: side.side,
    document: { createElement: element }, choiceList: () => element('div'), displayLevel: v => String(v / 10),
    formatDuration: s => Number.isFinite(s) ? `${Math.floor(s / 3600)}h ${String(Math.round(s % 3600 / 60)).padStart(2, '0')}m` : '—',
  });
  vm.runInContext(code, ctx);
  ctx.renderLive();
  return ids;
}
const rows = group => group.children[1].children;                       // section > [heading, body]; body > rows
const cells = row => row.children[1].children.map(c => texts(c).join('/'));

const device = { online: true, hasWater: true, firmwareVersion: '14b0601', priming: false, needsPriming: false, firmwareUpdating: false,
  lastPrime: '2026-11-15T00:16:00Z', lastHeard: '2026-11-17T18:30:00Z', leftNowHeating: true };
const side = { side: 'left', power: true, mode: 'smart:initial', mode_started: '2026-11-17T06:42:00Z', target: -30, current: -20, schedule_type: 'smart',
  smart: { bedTimeLevel: -20, initialSleepLevel: -30, finalSleepLevel: -10 }, timed: { level: 10, durationSeconds: 7200 } };

test('top strip, side heading and thermal running state', () => {
  const ids = render(device, side);
  assert.deepEqual(ids['status-strip'].children.map(c => texts(c).join(' ')), ['Online', 'Water']);   // firmware moved to the hardware card
  assert.equal(ids['pod-side-heading'].textContent, 'This side · Left');
  assert.match(texts(ids['live-status']).join('|'), /Currently -2 · Running: Yes/);
});

test('schedule presets and hardware are grouped rows of label-over-value cells', () => {
  const ids = render(device, side);
  const [presets, hardware] = ids['live-details'].children;
  assert.equal(presets.children[0].textContent, 'Schedule presets');
  assert.equal(hardware.children[0].textContent, 'Pod hardware & system');
  const [smart, timed] = rows(presets), [water, link] = rows(hardware);
  assert.equal(smart.children[0].textContent, 'Smart schedule');
  assert.deepEqual(cells(smart), ['Bedtime/-2', 'Early sleep/-3', 'Late sleep/-1']);
  assert.equal(smart.children[1].style.props['--cols'], '3');
  assert.deepEqual(cells(timed), ['Timed level/1', 'Duration/2h 00m']);       // not raw seconds
  assert.equal(timed.children[1].style.props['--cols'], '3');                  // Duration lines up under Early sleep
  assert.equal(water.children[0].textContent, 'Water & priming');
  assert.equal(cells(water).length, 3);
  assert.deepEqual(cells(water).slice(0, 2), ['Priming/Not running', 'Needs priming/No']);
  assert.match(cells(water)[2], /^Last primed\/Nov 1[45]/);
  assert.equal(link.children[0].textContent, 'Connectivity & firmware');
  assert.deepEqual(cells(link).map(c => c.split('/')[0]), ['Last heard', 'Firmware', 'Firmware updating']);
  assert.equal(cells(link)[1], 'Firmware/14b0601');
  assert.equal(cells(link)[2], 'Firmware updating/No');
  assert.equal(link.children[1].style.props['--cols'], '3');
});

test('missing device data shows dashes instead of failing', () => {
  const ids = render(null, { side: 'right' });
  const [presets, hardware] = ids['live-details'].children;
  assert.deepEqual(cells(rows(presets)[1]), ['Timed level/—', 'Duration/—']);
  assert.deepEqual(cells(rows(hardware)[0]), ['Priming/—', 'Needs priming/—', 'Last primed/—']);
  assert.equal(ids['status-strip'].children.length, 2);
  assert.equal(cells(rows(hardware)[1])[1], 'Firmware/—');
});
