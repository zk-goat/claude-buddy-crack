import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STABLE_PATH = join(homedir(), '.claude.companions.json');

function loadStable() {
  if (!existsSync(STABLE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STABLE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveStable(data) {
  writeFileSync(STABLE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function stableSave(alias, uid, companion) {
  const stable = loadStable();
  stable[alias] = { uid, companion, savedAt: Date.now() };
  saveStable(stable);
}

export function stableList() {
  return loadStable();
}

export function stableGet(alias) {
  const stable = loadStable();
  return stable[alias] ?? null;
}

export function stableRemove(alias) {
  const stable = loadStable();
  if (!(alias in stable)) return false;
  delete stable[alias];
  saveStable(stable);
  return true;
}

export { STABLE_PATH };
