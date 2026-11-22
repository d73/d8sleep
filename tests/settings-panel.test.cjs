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

test('settings presents display choices and an idle timeout', () => {
  const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
  const panel = html.slice(html.indexOf('<section id="settings-panel"'), html.indexOf('</section>', html.indexOf('<section id="settings-panel"')));
  assert.equal((panel.match(/class="settings-row"/g) || []).length, 5);
  assert.match(panel, /id="idle-timeout"/);
  assert.match(panel, /id="unit-off"[^>]*>Off<\/button>.*id="unit-c".*id="unit-f"/);
  assert.match(panel, /id="theme-day"[^>]*aria-label="Day mode"/);
  assert.match(panel, /id="theme-night"[^>]*aria-label="Night mode"/);
});
