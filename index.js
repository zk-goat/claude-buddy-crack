#!/usr/bin/env node
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { deriveCompanion, deriveCompanionFull, SPECIES } from './lib/algorithm.js';
import { findConfigPath, readConfig, hasAccountUuid, backupConfig, writeConfig, writeConfigWithCompanion, restoreBackup } from './lib/config.js';
import { buildChineseName, buildChinesePersonality, SPECIES_ZH, RARITY_ZH } from './lib/locale.js';
import { stableSave, stableList, stableGet, stableRemove, STABLE_PATH } from './lib/stable.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { cmd: null, rarity: 'legendary', shiny: false, species: null, lang: null, dryRun: false, restore: false };

  // Subcommands: save <alias>, list, switch <alias>, remove <alias>
  if (['save', 'list', 'switch', 'remove'].includes(args[0])) {
    opts.cmd = args[0];
    opts.alias = args[1] ?? null;
    return opts;
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rarity' && args[i + 1]) opts.rarity = args[++i];
    else if (args[i] === '--species' && args[i + 1]) opts.species = args[++i];
    else if (args[i] === '--lang' && args[i + 1]) opts.lang = args[++i];
    else if (args[i] === '--shiny') opts.shiny = true;
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--restore') opts.restore = true;
    else if (args[i] === '--help') { printHelp(); process.exit(0); }
  }
  if (!RARITIES.includes(opts.rarity)) {
    console.error(`Unknown rarity: ${opts.rarity}. Valid: ${RARITIES.join(', ')}`);
    process.exit(1);
  }
  if (opts.species && !SPECIES.includes(opts.species)) {
    console.error(`Unknown species: ${opts.species}. Valid: ${SPECIES.join(', ')}`);
    process.exit(1);
  }
  if (opts.lang && opts.lang !== 'zh') {
    console.error(`Unknown lang: ${opts.lang}. Only 'zh' is supported.`);
    process.exit(1);
  }
  return opts;
}

function printHelp() {
  console.log(`
claude-buddy-crack -- crack the Claude Code companion algorithm

Usage:
  npx claude-buddy-crack [options]          搜索并注入新伴侣
  npx claude-buddy-crack save <别名>        保存当前伴侣到马厩
  npx claude-buddy-crack list               列出马厩里所有伴侣
  npx claude-buddy-crack switch <别名>      切换到马厩中的伴侣
  npx claude-buddy-crack remove <别名>      从马厩删除某只伴侣

Options:
  --rarity <rarity>   Target rarity (default: legendary)
                      Values: common, uncommon, rare, epic, legendary
  --species <name>    Target species (optional)
                      Values: ${SPECIES.join(', ')}
  --shiny             Also require shiny status
  --lang zh           Chinese companion name & personality
  --dry-run           Show result without modifying .claude.json
  --restore           Restore from backup (.claude.json.buddy-backup)
  --help              Show this help
  `);
}

function calcProbability(rarity, speciesTarget, shiny) {
  let p = RARITY_WEIGHTS[rarity] / 100;
  if (speciesTarget) p *= 1 / SPECIES.length;
  if (shiny) p *= 0.01;
  return p;
}

function formatEta(attemptsLeft, attemptsPerSec) {
  if (attemptsPerSec <= 0) return '...';
  const secs = Math.ceil(attemptsLeft / attemptsPerSec);
  if (secs < 60) return `${secs}秒`;
  if (secs < 3600) return `${Math.ceil(secs / 60)}分钟`;
  return `${(secs / 3600).toFixed(1)}小时`;
}

async function crackMultiThreaded({ rarity, shiny, species, useUuid, expectedAttempts }) {
  const numWorkers = cpus().length;
  const maxAttemptsPerWorker = Math.ceil(50_000_000 / numWorkers);
  const workerProgress = new Array(numWorkers).fill(0);
  const startTime = Date.now();

  return new Promise((resolve) => {
    const workers = [];
    let done = false;
    let finishedWorkers = 0;

    const cleanup = () => { for (const w of workers) w.terminate(); };

    const printProgress = () => {
      const total = workerProgress.reduce((a, b) => a + b, 0);
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? Math.round(total / elapsed) : 0;
      const remaining = expectedAttempts - total;
      const eta = remaining > 0 ? formatEta(remaining, speed) : '即将完成';
      process.stdout.write(
        `\r搜索中... ${total.toLocaleString()} 次 | ${speed.toLocaleString()} 次/秒 | 预计剩余 ~${eta} | ${numWorkers} 线程`
      );
    };

    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(join(__dirname, 'lib', 'worker.js'), {
        workerData: { rarity, shiny, species, useUuid, maxAttempts: maxAttemptsPerWorker },
      });

      worker.on('message', (msg) => {
        if (done) return;
        if (msg.type === 'progress') {
          workerProgress[i] = msg.attempts;
          printProgress();
        } else if (msg.type === 'result') {
          if (msg.result) {
            done = true;
            cleanup();
            const total = workerProgress.reduce((a, b) => a + b, 0);
            resolve({ ...msg.result, attempts: total, elapsed: Date.now() - startTime });
          } else {
            finishedWorkers++;
            if (finishedWorkers === numWorkers) {
              done = true;
              resolve(null);
            }
          }
        }
      });

      worker.on('error', (err) => {
        if (!done) { done = true; cleanup(); resolve(null); console.error(err); }
      });

      workers.push(worker);
    }
  });
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function confirm(question) {
  return (await prompt(question)).toLowerCase() === 'y';
}

function formatCompanion(entry, alias) {
  const c = entry.companion;
  const date = new Date(entry.savedAt).toLocaleDateString('zh-CN');
  const shiny = c.shiny ? ' ✦' : '';
  const name = c.name ?? '?';
  const species = SPECIES_ZH[c.species] ?? c.species ?? '?';
  const rarity = RARITY_ZH[c.rarity] ?? c.rarity ?? '?';
  return `  ${alias.padEnd(16)} ${name}${shiny}  ${rarity}${species}  (${date})`;
}

async function runStableCmd(opts) {
  const configPath = findConfigPath();

  if (opts.cmd === 'list') {
    const stable = stableList();
    const entries = Object.entries(stable);
    if (entries.length === 0) {
      console.log(`马厩是空的。用 save <别名> 存入伴侣。`);
      return;
    }
    console.log(`马厩 (${STABLE_PATH})：\n`);
    for (const [alias, entry] of entries) {
      console.log(formatCompanion(entry, alias));
    }
    return;
  }

  if (opts.cmd === 'save') {
    if (!opts.alias) { console.error('用法：save <别名>'); process.exit(1); }
    if (!configPath) { console.error('找不到 ~/.claude.json'); process.exit(1); }
    const config = readConfig(configPath);
    const companion = config.companion;
    if (!companion) { console.error('当前没有伴侣，先运行 /buddy 孵化。'); process.exit(1); }
    const uid = config.oauthAccount?.accountUuid ?? config.userID;
    if (!uid) { console.error('找不到 userID/accountUuid。'); process.exit(1); }
    stableSave(opts.alias, uid, companion);
    const name = companion.name ?? '未知';
    console.log(`已保存「${name}」为 "${opts.alias}"`);
    return;
  }

  if (opts.cmd === 'switch') {
    if (!configPath) { console.error('找不到 ~/.claude.json'); process.exit(1); }
    const stable = stableList();
    const entries = Object.entries(stable);
    if (entries.length === 0) { console.log('马厩是空的。用 save <别名> 存入伴侣。'); process.exit(0); }

    let alias = opts.alias;
    if (!alias) {
      console.log('马厩里的伴侣：\n');
      entries.forEach(([a, e], i) => console.log(`  ${i + 1}. ${formatCompanion(e, a)}`));
      const answer = await prompt('\n输入序号或别名：');
      const num = parseInt(answer);
      if (!isNaN(num) && num >= 1 && num <= entries.length) {
        alias = entries[num - 1][0];
      } else {
        alias = answer.trim();
      }
    }

    const entry = stableGet(alias);
    if (!entry) { console.error(`马厩里没有 "${alias}"`); process.exit(1); }
    backupConfig(configPath);
    writeConfigWithCompanion(configPath, entry.uid, entry.companion);
    const name = entry.companion?.name ?? alias;
    console.log(`已切换到「${name}」`);
    console.log(`备份保存至 ${configPath}.buddy-backup`);
    return;
  }

  if (opts.cmd === 'remove') {
    if (!opts.alias) { console.error('用法：remove <别名>'); process.exit(1); }
    const ok = stableRemove(opts.alias);
    if (!ok) { console.error(`马厩里没有 "${opts.alias}"`); process.exit(1); }
    console.log(`已删除 "${opts.alias}"`);
    return;
  }
}

async function main() {
  const opts = parseArgs();

  if (opts.cmd) {
    await runStableCmd(opts);
    return;
  }

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

  // Detect whether oauthAccount.accountUuid is the active seed
  const config = configPath ? readConfig(configPath) : null;
  const useUuid = config ? hasAccountUuid(config) : false;
  if (useUuid) console.log('Detected oauthAccount — will update accountUuid.');

  // Probability warning
  const prob = calcProbability(opts.rarity, opts.species, opts.shiny);
  const expectedAttempts = Math.round(1 / prob);
  const speciesLabel = opts.species
    ? (opts.lang === 'zh' ? (SPECIES_ZH[opts.species] ?? opts.species) : opts.species)
    : null;
  const rarityLabel = opts.lang === 'zh' ? (RARITY_ZH[opts.rarity] ?? opts.rarity) : opts.rarity;

  const targetLabel = [
    opts.shiny ? (opts.lang === 'zh' ? '闪光' : 'shiny') : null,
    rarityLabel,
    speciesLabel,
  ].filter(Boolean).join(' ');

  console.log(`目标：${targetLabel}`);
  console.log(`概率：${(prob * 100).toFixed(4)}%  预计平均 ~${expectedAttempts.toLocaleString()} 次迭代`);
  if (prob < 0.00001) {
    console.warn(`⚠ 概率极低，可能需要较长时间，建议先试试去掉 --shiny 或不指定 --species`);
  }
  console.log('');

  const result = await crackMultiThreaded({
    rarity: opts.rarity,
    shiny: opts.shiny,
    species: opts.species,
    useUuid,
    expectedAttempts,
  });

  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  if (result === null) {
    console.error('Search limit reached without finding a match. Try again.');
    process.exit(1);
  }

  console.log(`找到！共 ${result.attempts.toLocaleString()} 次（${result.elapsed}ms）`);
  console.log(`稀有度：${result.rarity}${result.shiny ? ' SHINY' : ''}`);
  console.log(`物种：  ${result.species}${opts.lang === 'zh' ? ` (${SPECIES_ZH[result.species] ?? result.species})` : ''}`);
  console.log(`UserID：${result.uid}`);

  if (opts.lang === 'zh') {
    const full = deriveCompanionFull(result.uid);
    const name = buildChineseName(full.species, full.stats);
    const personality = buildChinesePersonality(full.rarity, full.species, full.stats);
    console.log(`中文名：${name}`);
    console.log(`性格：  ${personality}`);
    result._companion = { name, personality, ...full, hatchedAt: Date.now() };
  }

  if (opts.dryRun) {
    console.log('\n[dry-run] Not modifying .claude.json');
    return;
  }

  const ok = await confirm('\n注入此 userID？[y/N] ');
  if (!ok) { console.log('Aborted.'); process.exit(0); }

  backupConfig(configPath);

  if (result._companion) {
    writeConfigWithCompanion(configPath, result.uid, result._companion);
    console.log(`\n完成！已直接写入中文伴侣，无需重新 /buddy`);
  } else {
    writeConfig(configPath, result.uid);
    console.log(`\n完成！在 Claude Code 中运行 /buddy 孵化新伴侣`);
  }

  console.log(`备份保存至 ${configPath}.buddy-backup`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
