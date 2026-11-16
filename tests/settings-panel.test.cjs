const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('function setSettingsOpen('), source.indexOf('// Drawers:'));

test('settings opens downwards and Escape closes it and returns focus', () => {
  let click, keydown, focused = false;
  const panel = { hidden: true };
  const toggle = { setAttribute(name, value) { this[name] = value; },
    addEventListener(_, fn) { click = fn; }, focus() { focused = true; } };
  const ctx = vm.createContext({ $: id => id === 'settings-panel' ? panel : toggle,
    document: { addEventListener(_, fn) { keydown = fn; } } });
  vm.runInContext(code, ctx);
  click();
  assert.equal(panel.hidden, false);
  assert.equal(toggle['aria-expanded'], 'true');
  keydown({ key: 'Escape' });
  assert.equal(panel.hidden, true);
  assert.equal(toggle['aria-expanded'], 'false');
  assert.equal(focused, true);
});
