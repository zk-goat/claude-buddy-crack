# claude-buddy-crack Design Spec

**Date:** 2026-04-01  
**Status:** Approved

## Overview

An npm package that cracks the Claude Code companion algorithm to generate a specific rarity/shiny companion. Reverse-engineered from Claude Code CLI `cli.js` — uses FNV-1a hash (not Bun wyhash as hatch.py incorrectly assumes).

## Background

Claude Code's companion system derives species, rarity, and shiny status from `userID` (or `oauthAccount.accountUuid` if present) via:

```
ch1() → seed
seed + "friend-2026-401" → Xk_() FNV-1a → uint32
uint32 → Mk_() SplitMix32 PRNG
PRNG → Zk_(): rarity, species, eye, hat, shiny
```

Key discovery: `typeof Bun === "undefined"` in Node.js, so Claude Code uses the FNV-1a fallback — not Bun's wyhash. This is why hatch.py predictions are wrong.

## Project Structure

```
claude-buddy-crack/
├── index.js          # CLI entry point (bin)
├── lib/
│   ├── algorithm.js  # FNV-1a + SplitMix32 + companion derivation
│   └── config.js     # Read/write/backup ~/.claude.json
├── package.json
└── README.md
```

## CLI Interface

```bash
npx claude-buddy-crack                          # find legendary shiny, auto-inject
npx claude-buddy-crack --rarity legendary       # specific rarity
npx claude-buddy-crack --rarity epic --shiny    # epic shiny
npx claude-buddy-crack --dry-run                # preview only, no write
npx claude-buddy-crack --restore                # restore from backup
```

## Execution Flow

1. Parse CLI args (rarity target, shiny flag, dry-run, restore)
2. Auto-backup current `~/.claude.json` → `~/.claude.json.buddy-backup`
3. Brute-force search: random 64-char hex userID until FNV-1a + SplitMix32 produces target
4. Display result: rarity, species, shiny status, attempts, elapsed time
5. Prompt user to confirm injection
6. Write userID to `.claude.json`, set `companion: null`
7. Instruct user to run `/buddy` to hatch

## Algorithm (lib/algorithm.js)

```js
// FNV-1a 32-bit
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++)
    h ^= str.charCodeAt(i), h = Math.imul(h, 16777619);
  return h >>> 0;
}

// SplitMix32 PRNG
function splitmix32(seed) {
  let K = seed >>> 0;
  return () => {
    K |= 0; K = K + 1831565813 | 0;
    let _ = Math.imul(K ^ K >>> 15, 1 | K);
    return _ = _ + Math.imul(_ ^ _ >>> 7, 61 | _) ^ _,
           ((_ ^ _ >>> 14) >>> 0) / 4294967296;
  };
}

// Derive companion traits
function deriveCompanion(userID) {
  const prng = splitmix32(fnv1a(userID + "friend-2026-401"));
  const rarity = pickRarity(prng);
  const species = pick(prng, SPECIES);
  pick(prng, EYES); // eye
  if (rarity !== "common") pick(prng, HATS); // hat
  const shiny = prng() < 0.01;
  return { rarity, species, shiny };
}
```

## Config (lib/config.js)

- Locate `.claude.json`: `~/.claude.json` (current simplified format)
- Backup: copy to `~/.claude.json.buddy-backup` before any write
- Inject: set `userID` field, set `companion: null`
- Restore: copy backup back

## README Structure

1. What it does (one line)
2. Quick start: `npx claude-buddy-crack`
3. How the algorithm works (key functions from cli.js)
4. Why hatch.py is wrong (Bun vs FNV-1a)
5. Options reference
6. Disclaimer

## Error Handling

- Config not found: print clear message, suggest running Claude Code first, exit 1
- Malformed JSON: print error, do NOT overwrite, exit 1
- Backup fails: abort before any write
- Search limit: max 10,000,000 attempts (legendary shiny ~1/10000, so this is 1000x expected); if exceeded, print stats and exit 1

## Path Resolution

Check in order, use first found:
1. `~/.claude/.claude.json`
2. `~/.claude.json`

On Windows, resolve `~` via `os.homedir()` (not `%USERPROFILE%` string expansion).

## Progress & UX

- Print `Searching... (N attempts)` updating every 100k attempts
- On find: print rarity, species, shiny, attempts, elapsed time
- Confirmation prompt: `Inject this userID? [y/N]` (default no)
- `--dry-run`: skip confirmation and injection entirely
- `--restore`: check backup exists, confirm `Restore backup? [y/N]`, then copy back

## Algorithm Verification

The algorithm in `lib/algorithm.js` is a direct copy of the functions `Xk_`, `Mk_`, `Zk_`, `Pk_`, `$T6` extracted verbatim from Claude Code CLI `cli.js`. The `K |= 0` in SplitMix32 is intentional (converts to signed int32 for the subsequent `| 0` addition). Test vector: userID `cd41e3f9c606a29fbb17b0411a8e1cd4fefae0cbd44abb04ec11d4834cedee78` → rarity `uncommon`. Include this as a self-test on startup.

## Constraints

- No dependencies beyond Node.js built-ins (os, fs, path, readline, crypto)
- Works on macOS, Windows (Node.js native, not just Git Bash), Linux
- SALT `"friend-2026-401"` is hardcoded from cli.js; if it changes in future versions, users will see wrong predictions (document this in README)
