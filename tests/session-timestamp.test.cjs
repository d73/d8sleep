const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('async function pollSession()'), source.indexOf('setInterval(pollSession'));

test('session timestamp records the last successful check and survives failure', async () => {
  const error = { textContent: '' };
  const ctx = vm.createContext({ document: { hidden: false }, selected: 'left', busy: false, dragging: false,
    sessionInFlight: null, sessionRequest: 0, sessionData: null, sessionSide: null, sessionCheckedAt: null,
    api: async () => ({ session: { incomplete: false } }), $: () => error, renderSession() {} });
  vm.runInContext(code, ctx);
  await ctx.pollSession();
  assert.equal(ctx.sessionSide, 'left');
  assert.ok(Number.isFinite(Date.parse(ctx.sessionCheckedAt)));
  const lastCheck = ctx.sessionCheckedAt;
  ctx.api = async () => { throw Error('offline'); };
  await ctx.pollSession();
  assert.equal(ctx.sessionCheckedAt, lastCheck);
  assert.match(error.textContent, /offline/);
});

test('late response for a previous side does not set a timestamp', async () => {
  let resolve;
  const ctx = vm.createContext({ document: { hidden: false }, selected: 'left', busy: false, dragging: false,
    sessionInFlight: null, sessionRequest: 0, sessionData: null, sessionSide: null, sessionCheckedAt: null,
    api: () => new Promise(done => { resolve = done; }), $: () => ({}), renderSession() {} });
  vm.runInContext(code, ctx);
  const pending = ctx.pollSession();
  ctx.selected = 'right';
  ctx.sessionRequest++;
  resolve({ session: {} });
  await pending;
  assert.equal(ctx.sessionCheckedAt, null);
  assert.equal(ctx.sessionSide, null);
});
