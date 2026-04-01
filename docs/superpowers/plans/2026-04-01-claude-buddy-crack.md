# claude-buddy-crack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish an npm package that cracks the Claude Code companion algorithm to set any desired rarity/shiny status.

**Architecture:** Three focused modules — `lib/algorithm.js` (pure companion derivation), `lib/config.js` (file I/O), `index.js` (CLI). Tests use Node.js built-in `node:test`. No external dependencies.

**Tech Stack:** Node.js 18+, node:test, node:fs, node:os, node:path, node:readline, node:crypto

---

## File Map

| File | Responsibility |
|------|---------------|
| `lib/algorithm.js` | FNV-1a hash, SplitMix32 PRNG, companion derivation, brute-force search |
| `lib/config.js` | Locate, read, backup, write `~/.claude.json` |
| `index.js` | CLI arg parsing, progress output, confirmation prompt, orchestration |
| `test/algorithm.test.js` | Unit tests for algorithm |
| `test/config.test.js` | Unit tests for config file logic |
| `package.json` | npm metadata, bin entry, scripts |
| `README.md` | Usage, algorithm explanation, hatch.py comparison |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `lib/algorithm.js` (empty)
- Create: `lib/config.js` (empty)
- Create: `index.js` (empty)
- Create: `test/algorithm.test.js` (empty)
- Create: `test/config.test.js` (empty)
- Create: `.gitignore`

- [ ] **Step 1: Init git repo**

```bash
cd ~/claude-buddy-crack
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "claude-buddy-crack",
  "version": "1.0.0",
  "description": "Crack the Claude Code companion algorithm to get legendary/shiny companions",
  "main": "index.js",
  "bin": {
    "claude-buddy-crack": "./index.js"
  },
  "scripts": {
    "test": "node --test test/*.test.js"
  },
  "engines": {
    "node": ">=18"
  },
  "keywords": ["claude", "claude-code", "companion", "buddy"],
  "license": "MIT"
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
*.backup
```

- [ ] **Step 4: Create empty source files**

```bash
mkdir -p lib test
touch lib/algorithm.js lib/config.js index.js test/algorithm.test.js test/config.test.js
```

- [ ] **Step 5: Commit scaffold**

```bash
git add .
git commit -m "chore: project scaffold"
```

---

### Task 2: Algorithm — FNV-1a hash and SplitMix32 PRNG

**Files:**
- Modify: `lib/algorithm.js`
- Modify: `test/algorithm.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/algorithm.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCompanion } from '../lib/algorithm.js';

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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test test/algorithm.test.js
```
Expected: errors — `deriveCompanion` not exported

- [ ] **Step 3: Implement algorithm.js**

```js
// lib/algorithm.js
// Exact reimplementation of Claude Code's companion algorithm.
// Extracted from @anthropic-ai/claude-code cli.js functions: Xk_, Mk_, Zk_, Pk_, $T6
// Key finding: Claude Code runs in Node.js where typeof Bun === 'undefined',
// so it uses the FNV-1a fallback — NOT Bun's wyhash (which hatch.py uses).

const SALT = 'friend-2026-401';

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };

const SPECIES = [
  'duck', 'goose', 'blob', 'cat', 'dragon', 'octopus', 'owl', 'penguin',
  'turtle', 'snail', 'ghost', 'axolotl', 'capybara', 'cactus', 'robot',
  'rabbit', 'mushroom', 'chonk',
];
const EYES = ['·', '✦', '×', '◉', '@', '°'];
const HATS = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck'];

// Xk_: FNV-1a 32-bit hash (the actual fallback in Claude Code's cli.js)
function fnv1a(str) {
  let K = 2166136261;
  for (let i = 0; i < str.length; i++)
    K ^= str.charCodeAt(i), K = Math.imul(K, 16777619);
  return K >>> 0;
}

// Mk_: SplitMix32 PRNG
function splitmix32(seed) {
  let K = seed >>> 0;
  return function () {
    K |= 0, K = K + 1831565813 | 0;
    let _ = Math.imul(K ^ K >>> 15, 1 | K);
    return _ = _ + Math.imul(_ ^ _ >>> 7, 61 | _) ^ _,
      ((_ ^ _ >>> 14) >>> 0) / 4294967296;
  };
}

function pick(prng, arr) {
  return arr[Math.floor(prng() * arr.length)];
}

// Pk_: weighted rarity selection
function pickRarity(prng) {
  let r = prng() * 100;
  for (const rarity of RARITIES) {
    r -= RARITY_WEIGHTS[rarity];
    if (r < 0) return rarity;
  }
  return 'common';
}

// Zk_: derive all companion traits from PRNG
export function deriveCompanion(userID) {
  const prng = splitmix32(fnv1a(userID + SALT));
  const rarity = pickRarity(prng);
  const species = pick(prng, SPECIES);
  pick(prng, EYES); // eye (advance PRNG)
  if (rarity !== 'common') pick(prng, HATS); // hat (advance PRNG)
  const shiny = prng() < 0.01;
  return { rarity, species, shiny };
}

// Brute-force search for a userID producing the target traits
export function crack({ rarity: targetRarity = 'legendary', shiny: targetShiny = false, onProgress } = {}) {
  const chars = '0123456789abcdef';
  let attempts = 0;
  const start = Date.now();

  while (true) {
    attempts++;
    let uid = '';
    for (let i = 0; i < 64; i++) uid += chars[Math.floor(Math.random() * 16)];

    const { rarity, species, shiny } = deriveCompanion(uid);

    if (rarity === targetRarity && (!targetShiny || shiny)) {
      return { uid, rarity, species, shiny, attempts, elapsed: Date.now() - start };
    }

    if (onProgress && attempts % 100000 === 0) {
      onProgress(attempts);
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --test test/algorithm.test.js
```
Expected: all 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/algorithm.js test/algorithm.test.js
git commit -m "feat: implement FNV-1a + SplitMix32 companion algorithm"
```

---

### Task 3: Config — read, backup, write ~/.claude.json

**Files:**
- Modify: `lib/config.js`
- Modify: `test/config.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, writeConfig, backupConfig, findConfigPath } from '../lib/config.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = join(tmpdir(), 'buddy-crack-test-' + Date.now());
mkdirSync(TMP, { recursive: true });

test('findConfigPath: returns path when file exists', () => {
  const p = join(TMP, '.claude.json');
  writeFileSync(p, '{}');
  const result = findConfigPath(TMP);
  assert.equal(result, p);
  rmSync(p);
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
  const content = JSON.parse(require('node:fs').readFileSync(bak, 'utf8'));
  assert.equal(content.userID, 'orig');
  rmSync(p); rmSync(bak);
});

test('writeConfig: injects userID and sets companion null', () => {
  const p = join(TMP, '.claude.json');
  writeFileSync(p, JSON.stringify({ userID: 'old', companion: { name: 'X' } }));
  writeConfig(p, 'newuid123');
  const result = JSON.parse(require('node:fs').readFileSync(p, 'utf8'));
  assert.equal(result.userID, 'newuid123');
  assert.equal(result.companion, null);
  rmSync(p);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test test/config.test.js
```
Expected: errors — functions not exported

- [ ] **Step 3: Implement config.js**

```js
// lib/config.js
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

export function writeConfig(filePath, userID) {
  const config = readConfig(filePath);
  const updated = { ...config, userID, companion: null };
  writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');
}

export function restoreBackup(filePath) {
  const bak = filePath + '.buddy-backup';
  if (!existsSync(bak)) {
    throw new Error(`No backup found at ${bak}`);
  }
  copyFileSync(bak, filePath);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --test test/config.test.js
```
Expected: all 5 tests pass

- [ ] **Step 5: Run all tests**

```bash
node --test test/*.test.js
```
Expected: all 9 tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/config.js test/config.test.js
git commit -m "feat: add config read/write/backup for .claude.json"
```

---

### Task 4: CLI entry point (index.js)

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Add shebang and implement CLI**

```js
#!/usr/bin/env node
import { crack, deriveCompanion } from './lib/algorithm.js';
import { findConfigPath, readConfig, backupConfig, writeConfig, restoreBackup } from './lib/config.js';
import { createInterface } from 'node:readline';

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { rarity: 'legendary', shiny: false, dryRun: false, restore: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rarity' && args[i + 1]) opts.rarity = args[++i];
    else if (args[i] === '--shiny') opts.shiny = true;
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--restore') opts.restore = true;
    else if (args[i] === '--help') { printHelp(); process.exit(0); }
  }
  if (!RARITIES.includes(opts.rarity)) {
    console.error(`Unknown rarity: ${opts.rarity}. Valid: ${RARITIES.join(', ')}`);
    process.exit(1);
  }
  return opts;
}

function printHelp() {
  console.log(`
claude-buddy-crack — crack the Claude Code companion algorithm

Usage:
  npx claude-buddy-crack [options]

Options:
  --rarity <rarity>   Target rarity (default: legendary)
                      Values: common, uncommon, rare, epic, legendary
  --shiny             Also require shiny status
  --dry-run           Show result without modifying .claude.json
  --restore           Restore from backup (.claude.json.buddy-backup)
  --help              Show this help
  `);
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  const opts = parseArgs();

  const configPath = findConfigPath();
  if (!configPath && !opts.dryRun) {
    console.error('Could not find ~/.claude.json or ~/.claude/.claude.json');
    console.error('Make sure Claude Code has been run at least once.');
    process.exit(1);
  }

  // Self-test
  const test = deriveCompanion('cd41e3f9c606a29fbb17b0411a8e1cd4fefae0cbd44abb04ec11d4834cedee78');
  if (test.rarity !== 'uncommon') {
    console.error('Algorithm self-test failed — Claude Code may have changed its algorithm.');
    process.exit(1);
  }

  if (opts.restore) {
    if (!configPath) { console.error('No config file found.'); process.exit(1); }
    const ok = await confirm('Restore backup? [y/N] ');
    if (!ok) { console.log('Aborted.'); process.exit(0); }
    restoreBackup(configPath);
    console.log('Restored from backup. Run /buddy to re-hatch.');
    return;
  }

  const targetLabel = (opts.shiny ? 'shiny ' : '') + opts.rarity;
  console.log(`Searching for ${targetLabel} companion...`);

  const result = crack({
    rarity: opts.rarity,
    shiny: opts.shiny,
    onProgress: (n) => process.stdout.write(`\rSearching... (${n.toLocaleString()} attempts)`),
  });

  process.stdout.write('\r');
  console.log(`\nFound in ${result.attempts.toLocaleString()} attempts (${result.elapsed}ms)`);
  console.log(`Rarity:  ${result.rarity}${result.shiny ? ' ✨ SHINY' : ''}`);
  console.log(`Species: ${result.species}`);
  console.log(`UserID:  ${result.uid}`);

  if (opts.dryRun) {
    console.log('\n[dry-run] Not modifying .claude.json');
    return;
  }

  const ok = await confirm('\nInject this userID? [y/N] ');
  if (!ok) { console.log('Aborted.'); process.exit(0); }

  backupConfig(configPath);
  writeConfig(configPath, result.uid);
  console.log(`\nDone! Backup saved to ${configPath}.buddy-backup`);
  console.log('Run /buddy in Claude Code to hatch your new companion.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 2: Make executable**

```bash
chmod +x index.js
```

- [ ] **Step 3: Test manually (dry run)**

```bash
node index.js --rarity epic --dry-run
```
Expected: finds an epic companion, prints rarity/species/userID, exits without modifying any file.

- [ ] **Step 4: Run all tests**

```bash
node --test test/*.test.js
```
Expected: all 9 tests pass

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: CLI entry point with crack, dry-run, restore"
```

---

### Task 5: README and publish

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

````markdown
# claude-buddy-crack

Crack the [Claude Code](https://claude.ai/code) companion algorithm to get any rarity or shiny companion.

```bash
npx claude-buddy-crack
```

## Usage

```bash
# Find legendary shiny (default)
npx claude-buddy-crack --rarity legendary --shiny

# Find legendary (no shiny requirement, faster)
npx claude-buddy-crack --rarity legendary

# Preview without modifying config
npx claude-buddy-crack --dry-run

# Restore previous companion
npx claude-buddy-crack --restore
```

After running, open Claude Code and run `/buddy` to hatch your new companion.

## How it works

Claude Code derives your companion from `userID` (or `oauthAccount.accountUuid`) via this chain in `cli.js`:

```
seed = userID + "friend-2026-401"
hash = FNV-1a(seed)          // Xk_()
prng = SplitMix32(hash)      // Mk_()
companion = deriveTraits(prng) // Zk_()
```

This tool brute-forces a 64-char hex `userID` that produces your desired rarity/shiny, then injects it into `~/.claude.json`.

## Why hatch.py's predictions are wrong

[hatch.py](https://github.com/cminn10/claude-buddy-hatchery) uses `Bun.hash` (wyhash) for cracking. But Claude Code runs in **Node.js**, where `typeof Bun === "undefined"` — so it falls through to the FNV-1a fallback in `Xk_()`. Different hash → different companion.

## Disclaimer

For fun only. Changing `userID` only affects companion display. Your account, billing, and API access are unaffected.
````

- [ ] **Step 2: Commit README**

```bash
git add README.md
git commit -m "docs: add README with algorithm explanation"
```

- [ ] **Step 3: Create GitHub repo and push**

```bash
gh repo create claude-buddy-crack --public --source=. --remote=origin --push
```

- [ ] **Step 4: Publish to npm (optional)**

```bash
npm publish --access public
```

---
