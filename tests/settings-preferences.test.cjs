const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('const ACCENT_KEY'), source.indexOf('// Only side labels'));

function fixture(initial = {}, blocked = false) {
  const stored = new Map(Object.entries(initial)), root = { dataset: {} }, estimate = {}, show = {};
  const buttons = ['blue', 'teal', 'violet'].map(accent => ({ dataset: { accent },
    setAttribute(key, value) { this[key] = value; }, addEventListener(_, fn) { this.click = fn; } }));
  show.addEventListener = (_, fn) => { show.change = fn; };
  const localStorage = { getItem(key) { if (blocked) throw Error('blocked'); return stored.get(key); },
    setItem(key, value) { if (blocked) throw Error('blocked'); stored.set(key, value); } };
  const ctx = vm.createContext({ localStorage, $: id => id === 'estimate' ? estimate : show,
    document: { documentElement: root, querySelectorAll: () => buttons } });
  vm.runInContext(code, ctx);
  return { root, estimate, show, buttons, stored };
}

test('temperature estimate starts hidden and can be saved and restored', () => {
  const page = fixture();
  assert.equal(page.estimate.hidden, true);
  page.show.change({ target: { checked: true } });
  assert.equal(page.estimate.hidden, false);
  assert.equal(page.stored.get('d8sleep.show-temperature'), 'true');
  assert.equal(fixture({ 'd8sleep.show-temperature': 'true' }).estimate.hidden, false);
  assert.equal(fixture({}, true).estimate.hidden, true);
});

test('accent selection is saved, accessible, and rejects invalid values', () => {
  const page = fixture();
  assert.equal(page.root.dataset.accent, 'violet');
  page.buttons[0].click();
  assert.equal(page.root.dataset.accent, 'blue');
  assert.equal(page.buttons[0]['aria-pressed'], 'true');
  assert.equal(page.buttons[2]['aria-pressed'], 'false');
  assert.equal(page.stored.get('d8sleep.accent'), 'blue');
  assert.equal(fixture({ 'd8sleep.accent': 'invalid' }).root.dataset.accent, 'violet');
});
