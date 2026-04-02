# claude-buddy-crack

Crack the [Claude Code](https://claude.ai/code) companion algorithm to get any rarity or shiny companion.

```bash
npx claude-buddy-crack
```

## Usage

```bash
# Find legendary shiny (recommended)
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
hash = FNV-1a(seed)            // Xk_() in cli.js
prng = SplitMix32(hash)        // Mk_() in cli.js
companion = deriveTraits(prng) // Zk_() in cli.js
```

This tool brute-forces a 64-char hex `userID` that produces your desired rarity/shiny, then injects it into `~/.claude.json`.

## Why hatch.py's predictions are wrong

[hatch.py](https://github.com/cminn10/claude-buddy-hatchery) uses `Bun.hash` (wyhash) for cracking. But Claude Code runs in **Node.js**, where `typeof Bun === "undefined"` — so it falls through to the **FNV-1a fallback** in `Xk_()`. Different hash function → different companion predictions.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--rarity` | `legendary` | Target rarity: common, uncommon, rare, epic, legendary |
| `--shiny` | off | Also require shiny status (1% extra chance) |
| `--dry-run` | off | Preview result without modifying config |
| `--restore` | off | Restore from backup |

## Disclaimer

For fun only. Changing `userID` only affects companion display. Your account, billing, and API access are unaffected. Backup is created automatically at `~/.claude.json.buddy-backup`.
