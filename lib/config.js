import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function findConfigPath(home = homedir()) {
  const candidates = [
    join(home, '.claude', '.claude.json'),
    join(home, '.claude.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function readConfig(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Malformed JSON in ${filePath}: ${e.message}`);
  }
}

export function backupConfig(filePath) {
  copyFileSync(filePath, filePath + '.buddy-backup');
}

// Returns true if oauthAccount.accountUuid is present (takes priority over userID in ch1())
export function hasAccountUuid(config) {
  return typeof config?.oauthAccount?.accountUuid === 'string';
}

export function writeConfig(filePath, seed) {
  const config = readConfig(filePath);
  const updated = hasAccountUuid(config)
    ? { ...config, oauthAccount: { ...config.oauthAccount, accountUuid: seed }, companion: null }
    : { ...config, userID: seed, companion: null };
  writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');
}

export function restoreBackup(filePath) {
  const bak = filePath + '.buddy-backup';
  if (!existsSync(bak)) {
    throw new Error(`No backup found at ${bak}`);
  }
  copyFileSync(bak, filePath);
}
