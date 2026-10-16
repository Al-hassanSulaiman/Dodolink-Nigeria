import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductPrice } from './productPrice.ts';

for (const [input, expected] of [
  ['70,000', 70000], ['70000', 70000], ['7,000', 7000],
  ['700,000', 700000], ['1,000,000', 1000000],
  ['₦70,000.50', 70000.5], [' 70,000.25 ', 70000.25],
  ['70000.10', 70000.1], ['7.00', 7], ['0', 0], ['0.50', 0.5],
]) {
  test(`price ${JSON.stringify(input)} is ${expected} naira`, () => {
    assert.equal(parseProductPrice(input), expected);
  });
}

for (const input of ['', ' ', '70,00', '7,00,000', '70,000abc', '70,000.999',
  '-70000', 'NaN', 'Infinity', '1e5', '₦', '70.000,00', '9999999999999999999']) {
  test(`invalid price ${JSON.stringify(input)} is rejected, never truncated`, () => {
    assert.equal(parseProductPrice(input), null);
  });
}
