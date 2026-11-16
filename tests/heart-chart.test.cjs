const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('function renderHeartChart('), source.indexOf('async function pollSession()'));

function element(tag) {
  return { tag, attrs: {}, children: [], handlers: {}, textContent: '',
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(type, fn) { this.handlers[type] = fn; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    getBoundingClientRect() { return { left: 100, width: 320 }; } };
}
function chart(samples) {
  const container = element('div');
  const ctx = vm.createContext({ $: () => container, document: { createElement: element, createElementNS: (_, tag) => element(tag) } });
  vm.runInContext(code, ctx);
  ctx.renderHeartChart(samples);
  return container;
}

test('dense overlapping samples select the nearest time on pointer movement and tap', () => {
  const samples = Array.from({ length: 301 }, (_, i) => ({ timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), value: 50 + i / 10 }));
  const container = chart(samples), svg = container.children[0], detail = container.children.find(n => n.className === 'heart-chart-detail');
  assert.equal(svg.attrs.tabindex, '0');
  const clientX = i => 100 + 36 + i / 300 * 274;
  svg.handlers.pointermove({ clientX: clientX(101) });
  assert.match(detail.textContent, /^60\.1 bpm · /);
  svg.handlers.pointermove({ clientX: clientX(102) });
  assert.match(detail.textContent, /^60\.2 bpm · /);
  svg.handlers.click({ clientX: clientX(200) });
  assert.match(detail.textContent, /^70 bpm · /);
  let prevented = false;
  svg.handlers.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(detail.textContent, /^70\.1 bpm · /);
});

test('one valid point is inspectable and empty data remains empty', () => {
  const single = chart([{ timestamp: '2026-01-01T00:00:00Z', value: 61 }, { timestamp: 'invalid', value: 20 }]);
  const svg = single.children[0], detail = single.children.find(n => n.className === 'heart-chart-detail');
  svg.handlers.click({ clientX: 200 });
  assert.match(detail.textContent, /^61 bpm · /);
  svg.handlers.focus();
  assert.match(detail.textContent, /^61 bpm · /);
  assert.match(chart([]).children[0].textContent, /No heart-rate samples/);
});
