import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertProduct } from './productCache.ts';

test('a saved product appears immediately even before the store list has loaded', () => {
  const saved = { id: 42, name: 'New product', price: 70000 };
  assert.deepEqual(upsertProduct(undefined, saved), [saved]);
  assert.deepEqual(upsertProduct([], saved), [saved]);
});
test('adding a product retains existing products and does not mutate the old cache', () => {
  const old = [{ id: 1, name: 'Existing product' }];
  const saved = { id: 2, name: 'New product' };
  assert.deepEqual(upsertProduct(old, saved), [saved, old[0]]);
  assert.equal(old.length, 1);
});
test('editing or retrying replaces the existing entry without duplicates', () => {
  const old = [{ id: 1, price: 7 }, { id: 2 }];
  const saved = { id: 1, price: 70000 };
  assert.deepEqual(upsertProduct(old, saved), [saved, old[1]]);
  assert.equal(old[0].price, 7);
});
