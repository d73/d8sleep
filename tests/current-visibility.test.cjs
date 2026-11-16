const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const helpers = source.slice(source.indexOf('function syncCurrentDetail()'), source.indexOf('function update(data)'));
function fixture(request) {
  const detail = { hidden: false };
  const ctx = vm.createContext({ sides: [{ side: 'left', current: 20, power: true }], selected: 'left',
    statusRequests: 0, statusAvailable: true, $: () => detail, api: request });
  vm.runInContext(helpers, ctx);
  return { ctx, detail };
}

test('current reading is hidden for missing, off or unavailable values', () => {
  const page = fixture(() => {});
  page.ctx.syncCurrentDetail();
  assert.equal(page.detail.hidden, false);
  for (const current of [null, undefined, NaN, false]) {
    page.ctx.sides[0].current = current;
    page.ctx.syncCurrentDetail();
    assert.equal(page.detail.hidden, true);
  }
  page.ctx.sides[0] = { side: 'left', current: 20, power: false };
  page.ctx.syncCurrentDetail();
  assert.equal(page.detail.hidden, true);
});

test('refresh hides the reading until completion and leaves it hidden on failure', async () => {
  let finish;
  const page = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = page.ctx.readStatus();
  assert.equal(page.detail.hidden, true);
  finish({});
  await pending;
  assert.equal(page.detail.hidden, false);
  page.ctx.api = async () => { throw Error('offline'); };
  await assert.rejects(page.ctx.readStatus(), /offline/);
  assert.equal(page.detail.hidden, true);
});
