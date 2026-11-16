const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('const ACCENT_KEY'), source.indexOf('// Only side labels'));

function fixture(initial = {}, blocked = false) {
  const stored = new Map(Object.entries(initial)), root = { dataset: {} }, estimate = {};
  const control = () => ({ setAttribute(key, value) { this[key] = value; } });
  const units = { 'unit-off': control(), 'unit-c': control(), 'unit-f': control() };
  const buttons = ['blue', 'teal', 'amber', 'rose', 'plum'].map(accent => ({ dataset: { accent },
    setAttribute(key, value) { this[key] = value; }, addEventListener(_, fn) { this.click = fn; } }));
  const localStorage = { getItem(key) { if (blocked) throw Error('blocked'); return stored.get(key); },
    setItem(key, value) { if (blocked) throw Error('blocked'); stored.set(key, value); } };
  const ctx = vm.createContext({ localStorage, unit: 'F', render() {}, $: id => id === 'estimate' ? estimate : units[id],
    document: { documentElement: root, querySelectorAll: () => buttons } });
  vm.runInContext(code, ctx);
  return { ctx, root, estimate, units, buttons, stored };
}

test('temperature defaults off, changes units, and restores its saved choice', () => {
  const page = fixture();
  assert.equal(page.estimate.hidden, true);
  assert.equal(page.units['unit-off']['aria-pressed'], 'true');
  page.ctx.applyTemperature('C', true);
  assert.equal(page.estimate.hidden, false);
  assert.equal(page.ctx.unit, 'C');
  assert.equal(page.units['unit-c']['aria-pressed'], 'true');
  assert.equal(page.stored.get('d8sleep.temperature'), 'C');
  const restored = fixture({ 'd8sleep.temperature': 'F' });
  assert.equal(restored.estimate.hidden, false);
  assert.equal(restored.units['unit-f']['aria-pressed'], 'true');
  page.ctx.applyTemperature('off', true);
  assert.equal(page.estimate.hidden, true);
  assert.equal(fixture({}, true).estimate.hidden, true);
  assert.equal(fixture({ 'd8sleep.temperature': 'invalid' }).estimate.hidden, true);
});

test('accent defaults to blue, persists, and has accessible selected state', () => {
  const page = fixture();
  assert.equal(page.root.dataset.accent, 'blue');
  page.buttons[2].click();
  assert.equal(page.root.dataset.accent, 'amber');
  assert.equal(page.buttons[2]['aria-pressed'], 'true');
  assert.equal(page.buttons[0]['aria-pressed'], 'false');
  assert.equal(page.stored.get('d8sleep.accent'), 'amber');
  assert.equal(fixture({ 'd8sleep.accent': 'rose' }).root.dataset.accent, 'rose');
  assert.equal(fixture({ 'd8sleep.accent': 'invalid' }).root.dataset.accent, 'blue');
});
