const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const code = source.slice(source.indexOf('const SIDE_CACHE'), source.indexOf('document.querySelectorAll'));
function fixture(saved, blocked = false) {
  const row = { children: [], append(button) { this.children.push(button); } };
  let value = saved;
  const storage = {
    getItem() { if (blocked) throw Error('blocked'); return value; },
    setItem(_, v) { if (blocked) throw Error('blocked'); value = v; },
    removeItem() { if (blocked) throw Error('blocked'); value = null; },
  };
  const ctx = vm.createContext({ sessionStorage: storage, $: () => row,
    document: { createElement: () => ({}) }, sides: [] });
  vm.runInContext(code, ctx);
  return { row, ctx, value: () => value };
}

test('reload restores only side labels as disabled placeholders', () => {
  const page = fixture('["left","right"]');
  assert.deepEqual(page.row.children.map(b => [b.textContent, b.disabled]), [['Left', true], ['Right', true]]);
  assert.equal(fixture('["left","left"]').row.children.length, 0);
  assert.equal(fixture('["left","unexpected"]').row.children.length, 0);
  assert.equal(fixture('bad JSON').row.children.length, 0);
});

test('fresh single-side status clears old labels and blocked storage is safe', () => {
  const page = fixture('["left","right"]');
  page.ctx.sides = [{ side: 'solo' }];
  page.ctx.rememberSideLabels();
  assert.equal(page.value(), null);
  const blocked = fixture(null, true);
  blocked.ctx.sides = [{ side: 'left' }, { side: 'right' }];
  assert.doesNotThrow(() => blocked.ctx.rememberSideLabels());
});
