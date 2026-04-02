#!/usr/bin/env node
import { crack, deriveCompanion } from './lib/algorithm.js';
import { findConfigPath, readConfig, hasAccountUuid, backupConfig, writeConfig, restoreBackup } from './lib/config.js';
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
claude-buddy-crack -- crack the Claude Code companion algorithm

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

  // Self-test: verify algorithm matches known Claude Code output
  const selfTest = deriveCompanion('cd41e3f9c606a29fbb17b0411a8e1cd4fefae0cbd44abb04ec11d4834cedee78');
  if (selfTest.rarity !== 'uncommon') {
    console.error('Algorithm self-test failed -- Claude Code may have changed its algorithm.');
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

  // Detect whether oauthAccount.accountUuid is the active seed (takes priority over userID)
  const config = configPath ? readConfig(configPath) : null;
  const useUuid = config ? hasAccountUuid(config) : false;
  if (useUuid) console.log('Detected oauthAccount — will update accountUuid.');

  const targetLabel = (opts.shiny ? 'shiny ' : '') + opts.rarity;
  console.log(`Searching for ${targetLabel} companion...`);

  const result = crack({
    rarity: opts.rarity,
    shiny: opts.shiny,
    useUuid,
    onProgress: (n) => process.stdout.write(`\rSearching... (${n.toLocaleString()} attempts)`),
  });

  if (result === null) {
    console.error('\nSearch limit reached without finding a match. Try again.');
    process.exit(1);
  }

  process.stdout.write('\r');
  console.log(`\nFound in ${result.attempts.toLocaleString()} attempts (${result.elapsed}ms)`);
  console.log(`Rarity:  ${result.rarity}${result.shiny ? ' SHINY' : ''}`);
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
