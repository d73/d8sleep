const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const sliderCode = source.slice(source.indexOf('function syncSliderAvailability('), source.indexOf('function render()'));
const levelCode = source.slice(source.indexOf('function level(n)'), source.indexOf('let levelSending='));

test('off disables the slider and gives an accessible explanation', () => {
  const slider = { dataset: {}, setAttribute(k, v) { this[k] = v; } };
  const ctx = vm.createContext({ $: () => slider, busy: false, levelRunning: false, readOnly: false });
  vm.runInContext(sliderCode, ctx);
  ctx.syncSliderAvailability({ power: false }, 0);
  assert.equal(slider.disabled, true);
  assert.equal(slider.dataset.off, 'true');
  assert.match(slider['aria-describedby'], /slider-off-help/);
  ctx.syncSliderAvailability({ power: true }, 0);
  assert.equal(slider.disabled, false);
  assert.equal(slider['aria-describedby'], 'current-level-help');
  ctx.busy = true;
  ctx.syncSliderAvailability({ power: true }, 0);
  assert.equal(slider.disabled, true);
});

test('the command path ignores level changes when the side is off', () => {
  let sends = 0;
  const item = { side: 'left', power: false, target: 10 };
  const ctx = vm.createContext({ sides: [item], selected: 'left', busy: false,
    levelRunning: false, levelSending: false, queuedLevel: null, revision: 0,
    render() {}, say() {}, sendLevels() { sends++; } });
  vm.runInContext(levelCode, ctx);
  ctx.level(5);
  assert.equal(item.target, 10);
  assert.equal(sends, 0);
  item.power = true;
  ctx.level(5);
  assert.equal(item.target, 50);
  assert.equal(sends, 1);
});
