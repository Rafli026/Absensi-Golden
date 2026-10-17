import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLateDeduction } from '../server/lib/deduction.js';

const blockRules = { mode: 'per_minute_block', perBlock: 5000, blockMinutes: 10 };
const flatRules = { mode: 'per_occurrence', perOccurrence: 25000 };

test('not late => no deduction', () => {
  assert.equal(computeLateDeduction(0, blockRules).deduction, 0);
  assert.equal(computeLateDeduction(0, flatRules).deduction, 0);
  assert.equal(computeLateDeduction(0, blockRules, { isLate: false }).deduction, 0);
});

test('per-minute block: 1 minute late => 1 block', () => {
  const r = computeLateDeduction(1, blockRules);
  assert.equal(r.blocks, 1);
  assert.equal(r.deduction, 5000);
});

test('per-minute block: exactly 10 minutes => 1 block', () => {
  const r = computeLateDeduction(10, blockRules);
  assert.equal(r.blocks, 1);
  assert.equal(r.deduction, 5000);
});

test('per-minute block: 11 minutes => 2 blocks (started block counts)', () => {
  const r = computeLateDeduction(11, blockRules);
  assert.equal(r.blocks, 2);
  assert.equal(r.deduction, 10000);
});

test('per-minute block: 25 minutes => 3 blocks', () => {
  const r = computeLateDeduction(25, blockRules);
  assert.equal(r.blocks, 3);
  assert.equal(r.deduction, 15000);
});

test('per-minute block respects custom block size', () => {
  const r = computeLateDeduction(30, { mode: 'per_minute_block', perBlock: 2000, blockMinutes: 15 });
  assert.equal(r.blocks, 2);
  assert.equal(r.deduction, 4000);
});

test('flat mode ignores the number of minutes', () => {
  assert.equal(computeLateDeduction(1, flatRules).deduction, 25000);
  assert.equal(computeLateDeduction(120, flatRules).deduction, 25000);
});

test('flat mode still charges when minutes were not recorded', () => {
  assert.equal(computeLateDeduction(0, flatRules, { isLate: true }).deduction, 25000);
});

test('zero rates produce zero deductions', () => {
  assert.equal(computeLateDeduction(50, { mode: 'per_minute_block', perBlock: 0, blockMinutes: 10 }).deduction, 0);
  assert.equal(computeLateDeduction(50, { mode: 'per_occurrence', perOccurrence: 0 }).deduction, 0);
});

test('negative minutes are clamped to zero blocks but still one block when late', () => {
  const r = computeLateDeduction(-5, blockRules, { isLate: true });
  assert.equal(r.blocks, 1);
});
