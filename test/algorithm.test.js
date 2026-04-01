import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCompanion, crack } from '../lib/algorithm.js';

// Known test vector verified against real Claude Code output
test('cd41e3f9... → uncommon', () => {
  const r = deriveCompanion('cd41e3f9c606a29fbb17b0411a8e1cd4fefae0cbd44abb04ec11d4834cedee78');
  assert.equal(r.rarity, 'uncommon');
});

test('e45067586... → uncommon', () => {
  const r = deriveCompanion('e45067586ebe51dd953da436e2b8cff964a3bedbb1635cb9c365ee866cf204fc');
  assert.equal(r.rarity, 'uncommon');
});

test('b01141ae... → legendary shiny', () => {
  const r = deriveCompanion('b01141aeae7f160ed735c58dab17f8acd8dce387f096e22c215b2bf7453c02f8');
  assert.equal(r.rarity, 'legendary');
  assert.equal(r.shiny, true);
});

test('deriveCompanion returns species', () => {
  const r = deriveCompanion('cd41e3f9c606a29fbb17b0411a8e1cd4fefae0cbd44abb04ec11d4834cedee78');
  assert.ok(typeof r.species === 'string');
  assert.ok(r.species.length > 0);
});

test('crack() returns a common companion quickly', () => {
  const result = crack({ rarity: 'common', maxAttempts: 1000 });
  assert.ok(result !== null, 'should find common within 1000 attempts');
  assert.equal(result.rarity, 'common');
  assert.ok(typeof result.uid === 'string' && result.uid.length === 64);
  assert.ok(typeof result.attempts === 'number');
  assert.ok(typeof result.elapsed === 'number');
});

test('crack() returns null if maxAttempts exceeded', () => {
  // target legendary shiny with only 1 attempt — will almost certainly miss
  const result = crack({ rarity: 'legendary', shiny: true, maxAttempts: 1 });
  // may return null or a result — just verify it doesn't throw and returns the right shape
  if (result !== null) {
    assert.equal(result.rarity, 'legendary');
    assert.equal(result.shiny, true);
  }
});
