import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findConfigPath, readConfig, backupConfig, writeConfig, restoreBackup } from '../lib/config.js';

const TMP = join(tmpdir(), 'buddy-crack-test-' + Date.now());
mkdirSync(TMP, { recursive: true });

test('findConfigPath: returns path when .claude.json exists', () => {
  const p = join(TMP, '.claude.json');
  writeFileSync(p, '{}');
  const result = findConfigPath(TMP);
  assert.equal(result, p);
  rmSync(p);
});

test('findConfigPath: returns null when no config found', () => {
  const result = findConfigPath(join(TMP, 'nonexistent'));
  assert.equal(result, null);
});

test('readConfig: parses JSON', () => {
  const p = join(TMP, '.claude.json');
  writeFileSync(p, JSON.stringify({ userID: 'abc123' }));
  const config = readConfig(p);
  assert.equal(config.userID, 'abc123');
  rmSync(p);
});

test('readConfig: throws on malformed JSON', () => {
  const p = join(TMP, 'bad.json');
  writeFileSync(p, '{not valid json}');
  assert.throws(() => readConfig(p), /JSON/);
  rmSync(p);
});

test('backupConfig: creates backup file', () => {
  const p = join(TMP, '.claude.json');
  const bak = p + '.buddy-backup';
  writeFileSync(p, '{"userID":"orig"}');
  backupConfig(p);
  const content = JSON.parse(readFileSync(bak, 'utf8'));
  assert.equal(content.userID, 'orig');
  rmSync(p); rmSync(bak);
});

test('writeConfig: injects userID and sets companion null', () => {
  const p = join(TMP, '.claude.json');
  writeFileSync(p, JSON.stringify({ userID: 'old', companion: { name: 'X' } }));
  writeConfig(p, 'newuid123');
  const result = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(result.userID, 'newuid123');
  assert.equal(result.companion, null);
  rmSync(p);
});

test('restoreBackup: copies backup back to original', () => {
  const p = join(TMP, '.claude.json');
  const bak = p + '.buddy-backup';
  writeFileSync(p, '{"userID":"new"}');
  writeFileSync(bak, '{"userID":"original"}');
  restoreBackup(p);
  const result = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(result.userID, 'original');
  rmSync(p); rmSync(bak);
});

test('restoreBackup: throws when no backup exists', () => {
  const p = join(TMP, 'no-backup.json');
  assert.throws(() => restoreBackup(p), /backup/i);
});
