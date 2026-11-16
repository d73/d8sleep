const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8').split('let sides =')[0];
function fixture(value, blocked = false) {
  let saved = value;
  const button = () => ({ setAttribute(k, v) { this[k] = v; }, addEventListener(_, fn) { this.click = fn; } });
  const buttons = { 'theme-day': button(), 'theme-night': button() };
  const meta = { setAttribute(_, v) { this.content = v; } };
  const root = { dataset: {} };
  const localStorage = {
    getItem() { if (blocked) throw Error('blocked'); return saved; },
    setItem(_, v) { if (blocked) throw Error('blocked'); saved = v; },
  };
  vm.runInNewContext(script, { document: { documentElement: root, getElementById: id => buttons[id], querySelector: () => meta }, localStorage });
  return { buttons, meta, root, saved: () => saved };
}

test('theme toggles and saves a clear accessible action', () => {
  const page = fixture(null);
  assert.equal(page.root.dataset.theme, 'night');
  assert.equal(page.buttons['theme-night']['aria-pressed'], 'true');
  page.buttons['theme-day'].click();
  assert.equal(page.root.dataset.theme, 'day');
  assert.equal(page.buttons['theme-day']['aria-pressed'], 'true');
  assert.equal(page.buttons['theme-night']['aria-pressed'], 'false');
  assert.equal(page.meta.content, '#f0f3f9');
  assert.equal(page.saved(), 'day');
  page.buttons['theme-night'].click();
  assert.equal(page.saved(), 'night');
});

test('saved day mode restores and blocked storage does not stop toggling', () => {
  assert.equal(fixture('day').root.dataset.theme, 'day');
  const page = fixture(null, true);
  assert.doesNotThrow(() => page.buttons['theme-day'].click());
  assert.equal(page.root.dataset.theme, 'day');
});
