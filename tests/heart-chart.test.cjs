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
    replaceChildren(...nodes) { this.children = nodes; } };
}
function chart(samples) {
  const container = element('div');
  const ctx = vm.createContext({ $: () => container, document: { createElement: element, createElementNS: (_, tag) => element(tag) } });
  vm.runInContext(code, ctx);
  ctx.renderHeartChart(samples);
  return container;
}

test('each sample has a hover/tap target and keyboard navigation shows the correct value', () => {
  const samples = Array.from({ length: 301 }, (_, i) => ({ timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), value: 50 + i / 10 }));
  const container = chart(samples), svg = container.children[0], detail = container.children.find(n => n.className === 'heart-chart-detail');
  const hits = svg.children.filter(n => n.attrs.class === 'chart-hit');
  assert.equal(hits.length, samples.length);
  assert.equal(svg.attrs.tabindex, '0');
  hits[101].handlers.mouseenter();
  assert.match(detail.textContent, /^60\.1 bpm · /);
  hits[200].handlers.click();
  assert.match(detail.textContent, /^70 bpm · /);
  let prevented = false;
  svg.handlers.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.match(detail.textContent, /^70\.1 bpm · /);
});

test('one valid point is inspectable and empty data remains empty', () => {
  const single = chart([{ timestamp: '2026-01-01T00:00:00Z', value: 61 }, { timestamp: 'invalid', value: 20 }]);
  const svg = single.children[0], detail = single.children.find(n => n.className === 'heart-chart-detail');
  assert.equal(svg.children.filter(n => n.attrs.class === 'chart-hit').length, 1);
  svg.handlers.focus();
  assert.match(detail.textContent, /^61 bpm · /);
  assert.match(chart([]).children[0].textContent, /No heart-rate samples/);
});
