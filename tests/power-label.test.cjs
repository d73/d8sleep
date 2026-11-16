const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('const POWER_LABEL_CACHE'), source.indexOf('document.querySelectorAll'));

test('reload restores only a known power label and does not enable the control', () => {
  let value = 'Off';
  const button = { textContent: 'Power', disabled: true };
  const sessionStorage = { getItem: () => value, setItem: (_, v) => { value = v; }, removeItem: () => { value = null; } };
  const ctx = vm.createContext({ sessionStorage, $: () => button });
  vm.runInContext(code, ctx);
  assert.equal(button.textContent, 'Off');
  assert.equal(button.disabled, true);
  ctx.rememberPowerLabel(true);
  assert.equal(value, 'On');
  ctx.rememberPowerLabel(null);
  assert.equal(value, null);
  value = 'unexpected';
  ctx.restorePowerLabel();
  assert.equal(button.textContent, 'Off');
  const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
  assert.match(html, /id="power"[^>]*\bdisabled/);
  assert.match(html, /id="slider"[^>]*\bdisabled/);
});
