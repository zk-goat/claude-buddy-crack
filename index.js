#!/usr/bin/env node
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { deriveCompanion, deriveCompanionFull, SPECIES } from './lib/algorithm.js';
import { findConfigPath, readConfig, hasAccountUuid, backupConfig, writeConfig, writeConfigWithCompanion, restoreBackup } from './lib/config.js';
import { buildChineseName, buildChinesePersonality, SPECIES_ZH, RARITY_ZH } from './lib/locale.js';
import { stableSave, stableList, stableGet, stableRemove, stableUpdate, STABLE_PATH } from './lib/stable.js';
import { interact, getStatus, getLevel, getBondState, buildPersonality, buildFullPersonality, getCompanionTitle, getRelationships, getRelationTitle, getAllRelationships, BOND_STARS, LEVELS, setEvolved } from './lib/bond.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1 };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { cmd: null, rarity: 'legendary', shiny: false, species: null, lang: null, dryRun: false, restore: false, cursed: false };

  // Subcommands
  if (['save', 'list', 'switch', 'remove', 'feed', 'pet', 'play', 'status', 'dashboard', 'checkin', 'setup-hook', 'evolve', 'banter', 'show', 'daily'].includes(args[0])) {
    opts.cmd = args[0];
    opts.alias = args[1] ?? null;
    opts.aliasB = args[2] ?? null;
    return opts;
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rarity' && args[i + 1]) opts.rarity = args[++i];
    else if (args[i] === '--species' && args[i + 1]) opts.species = args[++i];
    else if (args[i] === '--lang' && args[i + 1]) opts.lang = args[++i];
    else if (args[i] === '--shiny') opts.shiny = true;
    else if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--restore') opts.restore = true;
    else if (args[i] === '--cursed') opts.cursed = true;
    else if (args[i] === '--help') { printHelp(); process.exit(0); }
  }

  if (opts.cursed) {
    opts.rarity = 'common';
    opts.shiny = false;
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
  npx claude-buddy-crack feed <别名>        喂食（+10 好感度，8小时冷却）
  npx claude-buddy-crack pet <别名>         摸头（+6 好感度，每天3次）
  npx claude-buddy-crack play <别名>        玩耍（+15 好感度，每天1次，消耗体力）
  npx claude-buddy-crack status <别名>      查看伴侣好感度和等级状态

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

async function crackMultiThreaded({ rarity, shiny, species, useUuid, cursed, expectedAttempts }) {
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
        workerData: { rarity, shiny, species, useUuid, cursed: cursed ?? false, maxAttempts: maxAttemptsPerWorker },
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
  const bond = getBondState(alias);
  const bondStr = bond ? ` ${BOND_STARS[getLevel(bond.affection).level]} Lv${getLevel(bond.affection).level}` : '';
  return `  ${alias.padEnd(16)} ${name}${shiny}  ${rarity}${species}${bondStr}  (${date})`;
}

function applyBondToConfig(alias, affection, basePersonality) {
  const configPath = findConfigPath();
  if (!configPath) return;
  const config = readConfig(configPath);
  const entry = stableGet(alias);
  if (!entry) return;
  const activeUid = config.oauthAccount?.accountUuid ?? config.userID;
  if (activeUid !== entry.uid) return;

  // Build relationships for personality
  const stable = stableList();
  const companionNames = Object.fromEntries(
    Object.entries(stable).map(([a, e]) => [a, e.companion?.name ?? a])
  );
  const rels = getRelationships(alias, companionNames).map(r => {
    const otherEntry = stable[r.other];
    const statA = topStatOf(entry.companion);
    const statB = topStatOf(otherEntry?.companion);
    return { ...r, title: getRelationTitle(statA, statB, r.days) };
  });

  const newPersonality = buildFullPersonality(basePersonality, affection, rels);
  const { level } = getLevel(affection);
  const newName = level >= 7
    ? getCompanionTitle(entry.companion?.name ?? alias, affection)
    : (config.companion?.name ?? entry.companion?.name);
  writeConfigWithCompanion(configPath, entry.uid, {
    ...config.companion,
    personality: newPersonality,
    name: newName,
  });
}

function topStatOf(companion) {
  const stats = companion?.stats;
  if (!stats) return 'SNARK';
  return Object.entries(stats).reduce((a, b) => b[1] > a[1] ? b : a)[0];
}

async function pickAlias() {
  const stable = stableList();
  const entries = Object.entries(stable);
  if (entries.length === 0) { console.log('马厩是空的。'); return null; }
  console.log('选择伴侣：\n');
  entries.forEach(([a, e], i) => console.log(`  ${i + 1}. ${formatCompanion(e, a)}`));
  const answer = await prompt('\n输入序号或别名：');
  const num = parseInt(answer);
  if (!isNaN(num) && num >= 1 && num <= entries.length) return entries[num - 1][0];
  return answer.trim() || null;
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

  if (['feed', 'pet', 'play'].includes(opts.cmd)) {
    if (!opts.alias) opts.alias = await pickAlias();
    if (!opts.alias) process.exit(0);
    const entry = stableGet(opts.alias);
    if (!entry) { console.error(`马厩里没有 "${opts.alias}"，用 list 查看。`); process.exit(1); }
    const basePersonality = entry.companion?.personality ?? '';
    const res = interact(opts.alias, opts.cmd, basePersonality);
    if (!res.ok) { console.log(res.message); process.exit(0); }

    const { level, title } = res.level;
    const stars = BOND_STARS[level];
    console.log(res.message);
    console.log(`好感度：${res.affection}  ${stars} Lv${level}「${title}」`);

    if (res.leveledUp) {
      console.log(`\n🎉 好感度提升！达到 Lv${level}「${title}」`);
      if (level === 5) console.log('   解锁：伴侣开始结合专长给出建议');
      if (level === 7) console.log('   解锁：伴侣名字将显示称号');
      if (level === 10) console.log('   解锁：可触发进化（换物种保留羁绊）');
    }

    if (res.nextLevel) {
      const needed = res.nextLevel.threshold - res.affection;
      console.log(`距离下一级「${res.nextLevel.title}」还需 ${needed} 好感度`);
    }

    applyBondToConfig(opts.alias, res.affection, res.basePersonality);
    return;
  }

  if (opts.cmd === 'status') {
    if (!opts.alias) opts.alias = await pickAlias();
    if (!opts.alias) process.exit(0);
    const entry = stableGet(opts.alias);
    if (!entry) { console.error(`马厩里没有 "${opts.alias}"，用 list 查看。`); process.exit(1); }
    const state = getStatus(opts.alias);
    const c = entry.companion;
    const name = c?.name ?? opts.alias;
    const species = SPECIES_ZH[c?.species] ?? c?.species ?? '?';
    const rarity = RARITY_ZH[c?.rarity] ?? c?.rarity ?? '?';

    console.log(`\n${name}  ${c?.shiny ? '✦ ' : ''}${rarity}${species}`);
    console.log('─'.repeat(36));

    if (!state) {
      console.log('还没有互动记录。用 feed/pet/play 开始养成！');
      return;
    }

    const { level, title } = state.levelInfo;
    const stars = BOND_STARS[level];
    const bar = (v, max = 100) => '█'.repeat(Math.round(v / max * 20)).padEnd(20, '░');

    console.log(`等级：${stars} Lv${level}「${title}」`);
    console.log(`好感度：${state.affection}`);

    if (state.nextLevel) {
      const pct = Math.round((state.affection - LEVELS[level - 1].threshold) /
        (state.nextLevel.threshold - LEVELS[level - 1].threshold) * 100);
      console.log(`进度：[${bar(pct)}] ${pct}% → Lv${state.nextLevel.level}「${state.nextLevel.title}」`);
    } else {
      console.log('进度：[████████████████████] MAX');
    }

    console.log(`体力：[${bar(state.energy)}] ${state.energy}/${100}`);

    const feedWait = Date.now() - (state.lastFed ?? 0);
    const feedReady = feedWait >= 8 * 3600000;
    console.log(`喂食：${feedReady ? '✓ 可喂食' : `冷却中（${Math.ceil((8 * 3600000 - feedWait) / 3600000)}h 后）`}`);
    const petLeft = 3 - (state.petDate === new Date().toDateString() ? (state.petCount ?? 0) : 0);
    console.log(`摸头：今日剩余 ${petLeft}/3 次`);
    const playLeft = state.playDate === new Date().toDateString() ? 1 - (state.playCount ?? 0) : 1;
    console.log(`玩耍：今日剩余 ${playLeft}/1 次`);
    console.log('');
    return;
  }

  if (opts.cmd === 'dashboard') {
    const stable = stableList();
    const entries = Object.entries(stable);
    if (entries.length === 0) { console.log('马厩是空的。'); return; }

    const W = 54;
    const line = '═'.repeat(W);
    const thin = '─'.repeat(W);
    console.log(`\n${line}`);
    console.log(' 伴侣看板');
    console.log(line);

    for (const [alias, entry] of entries) {
      const c = entry.companion;
      const name = (c?.name ?? alias).padEnd(10);
      const shiny = c?.shiny ? '✦' : ' ';
      const rarity = (RARITY_ZH[c?.rarity] ?? '?')[0];
      const species = (SPECIES_ZH[c?.species] ?? c?.species ?? '?').slice(0, 4).padEnd(4);
      const bond = getBondState(alias);
      const lvlStr = bond ? `${BOND_STARS[getLevel(bond.affection).level]}Lv${getLevel(bond.affection).level}` : ' — ';
      const energy = bond ? bond.energy : 100;
      const energyBar = '█'.repeat(Math.round(energy / 10)).padEnd(10, '░');

      const feedElapsed = bond ? Date.now() - (bond.lastFed ?? 0) : Infinity;
      const feedReady = feedElapsed >= 8 * 3600000;
      const feedStr = feedReady ? '⚠ 可喂食' : `✓ ${Math.ceil((8 * 3600000 - feedElapsed) / 3600000)}h后`;

      console.log(`  ${shiny}${rarity}${species} ${name} ${lvlStr.padEnd(8)} [${energyBar}]${energy.toString().padStart(3)}  ${feedStr}`);
    }

    // Relationships
    const allRels = getAllRelationships();
    const relEntries = Object.entries(allRels).filter(([, v]) => v.days > 0);
    if (relEntries.length > 0) {
      console.log(`\n${thin}`);
      console.log(' 同伴羁绊');
      console.log(thin);
      for (const [key, pair] of relEntries) {
        const [a, b] = key.split('|');
        const nameA = stable[a]?.companion?.name ?? a;
        const nameB = stable[b]?.companion?.name ?? b;
        const statA = topStatOf(stable[a]?.companion);
        const statB = topStatOf(stable[b]?.companion);
        const title = getRelationTitle(statA, statB, pair.days);
        console.log(`  ${nameA} × ${nameB}  「${title}」  同行 ${pair.days} 天`);
      }
    }

    console.log(`\n${line}\n`);
    return;
  }

  if (opts.cmd === 'show') {
    const showConfigPath = findConfigPath();
    if (!showConfigPath) { console.error('找不到 ~/.claude.json'); process.exit(1); }
    const showConfig = readConfig(showConfigPath);
    const showCompanion = showConfig.companion;
    if (!showCompanion) { console.error('当前没有伴侣，先运行 /buddy 孵化。'); process.exit(1); }
    const showUid = showConfig.oauthAccount?.accountUuid ?? showConfig.userID;

    // Match alias in stable
    const showStable = stableList();
    const showAlias = Object.entries(showStable).find(([, e]) => e.uid === showUid)?.[0] ?? null;

    const c = showCompanion;
    const nameStr = c.name ?? '?';
    const speciesEn = c.species ?? '?';
    const speciesZh = SPECIES_ZH[speciesEn] ?? speciesEn;
    const rarityZh = RARITY_ZH[c.rarity] ?? c.rarity ?? '?';
    const shinyStr = c.shiny ? ' ✦闪光' : '';
    const aliasLabel = showAlias ?? '（未存档）';

    console.log(`\n${nameStr}  ${c.shiny ? '✦ ' : ''}${rarityZh}${speciesZh}`);
    console.log('─'.repeat(33));
    console.log(`物种：${speciesZh} (${speciesEn})   稀有度：${rarityZh}${shinyStr}`);
    if (showUid) console.log(`UserID：${showUid}`);
    console.log(`别名：${aliasLabel}`);

    const showStats = c.stats;
    if (showStats) {
      const bar = (v) => '█'.repeat(Math.round(v / 100 * 20)).padEnd(20, '░');
      console.log('\n属性：');
      for (const stat of ['SNARK', 'PATIENCE', 'CHAOS', 'DEBUGGING', 'WISDOM']) {
        const v = showStats[stat] ?? 0;
        console.log(`  ${stat.padEnd(10)} [${bar(v)}]  ${v}`);
      }
    }

    const showBond = showAlias ? getBondState(showAlias) : null;
    if (showBond) {
      const { level, title } = getLevel(showBond.affection);
      const stars = BOND_STARS[level];
      console.log(`\n好感度：${showBond.affection}  ${stars}Lv${level}「${title}」`);
    }

    if (c.personality) console.log(`\n性格：${c.personality}`);
    console.log('');
    return;
  }

  if (opts.cmd === 'checkin') {
    // Auto-detect active companion from ~/.claude.json
    const configPath = findConfigPath();
    if (!configPath) { process.exit(0); }
    const config = readConfig(configPath);
    const activeUid = config.oauthAccount?.accountUuid ?? config.userID;
    if (!activeUid) { process.exit(0); }

    const stable = stableList();
    const alias = Object.entries(stable).find(([, e]) => e.uid === activeUid)?.[0];
    if (!alias) { process.exit(0); } // active companion not in stable, skip silently

    const entry = stable[alias];
    const basePersonality = entry.companion?.personality ?? '';
    const res = interact(alias, 'checkin', basePersonality);
    if (!res.ok) { console.log(`[${entry.companion?.name ?? alias}] ${res.message}`); process.exit(0); }

    const { level, title } = res.level;
    console.log(`[${entry.companion?.name ?? alias}] ${res.message}  ${BOND_STARS[level]}Lv${level}「${title}」`);
    if (res.leveledUp) console.log(`🎉 升级！达到 Lv${level}「${title}」`);
    applyBondToConfig(alias, res.affection, res.basePersonality);
    return;
  }

  if (opts.cmd === 'setup-hook') {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const hookCmd = `node "${join(__dirname, 'index.js')}" checkin`;

    let settings = {};
    if (existsSync(settingsPath)) {
      try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch {}
    }

    const hooks = settings.hooks ?? {};
    const stopHooks = hooks.Stop ?? [];

    // Check if already installed
    const already = stopHooks.some(h =>
      (typeof h === 'string' && h.includes('checkin')) ||
      (h?.command && h.command.includes('checkin'))
    );
    if (already) {
      console.log('Hook 已安装，无需重复设置。');
      return;
    }

    stopHooks.push({ command: hookCmd, timeout: 5000 });
    settings.hooks = { ...hooks, Stop: stopHooks };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log('✓ 已安装 Stop hook');
    console.log(`  每次 Claude Code 会话结束后自动运行 checkin`);
    console.log(`  命令：${hookCmd}`);
    return;
  }

  if (opts.cmd === 'daily') {
    const stable = stableList();
    const entries = Object.entries(stable);
    if (entries.length === 0) { console.log('马厩是空的。'); return; }

    console.log(`\n一键日常互动（${entries.length} 只伴侣）\n${'─'.repeat(40)}`);
    for (const [alias, entry] of entries) {
      const name = entry.companion?.name ?? alias;
      const basePersonality = entry.companion?.personality ?? '';
      const hatchedAt = entry.hatchedAt ?? entry.companion?.hatchedAt;
      let totalGained = 0;
      const msgs = [];

      for (const action of ['feed', 'pet', 'play']) {
        const res = interact(alias, action, basePersonality, hatchedAt);
        if (res.ok) {
          totalGained += (res.affection - (totalGained > 0 ? res.affection - totalGained : 0));
          msgs.push(action === 'feed' ? '喂食✓' : action === 'pet' ? '摸头✓' : '玩耍✓');
        } else {
          msgs.push(action === 'feed' ? '喂食-' : action === 'pet' ? '摸头-' : '玩耍-');
        }
      }

      // Re-fetch affection after all actions
      const bondState = getBondState(alias);
      const affection = bondState?.affection ?? 0;
      const { level, title } = getLevel(affection);
      console.log(`  ${name.padEnd(12)} ${msgs.join(' ')}  好感${affection} ${BOND_STARS[level]}Lv${level}「${title}」`);
      applyBondToConfig(alias, affection, basePersonality);
    }
    console.log(`\n完成！`);
    return;
  }

  if (opts.cmd === 'evolve') {
    await runEvolve(opts.alias);
    return;
  }

  if (opts.cmd === 'banter') {
    await runBanter(opts.alias, opts.aliasB);
    return;
  }
}

// ──────────────────────────────────────────────────────────
// BANTER TEMPLATES
// ──────────────────────────────────────────────────────────
const SPECIES_EMOJI = {
  duck:'🦆', goose:'🪿', blob:'🫧', cat:'🐱', dragon:'🐉',
  octopus:'🐙', owl:'🦉', penguin:'🐧', turtle:'🐢', snail:'🐌',
  ghost:'👻', axolotl:'🦎', capybara:'🦫', cactus:'🌵', robot:'🤖',
  rabbit:'🐰', mushroom:'🍄', chonk:'🐹',
};

// Each entry: array of dialogue lines. {A}=nameA {SA}=speciesA_zh {B}=nameB {SB}=speciesB_zh
const BANTER_TEMPLATES = {
  'SNARK|SNARK': [
    ['{A}：你那代码我看了，脑子里估计装的都是稻草。',
     '{B}：哦，稻草至少能发酵成酒。你那叫做什么？',
     '{A}：叫"不需要你评价"。',
     '{B}：哟，突然有文化了？'],
    ['{A}：就你这方案，三行能写完的东西你写了三十行。',
     '{B}：你的呢？一行都没有。',
     '{A}：因为我没动，等你先折腾完。',
     '{B}：……好狠。'],
    ['{A}：你刚才说的那个方案，我愣了三秒。',
     '{B}：欣赏我的思路？',
     '{A}：不，在想你是怎么能憋出这种东西的。',
     '{B}：哎我就知道你不懂欣赏。'],
  ],
  'SNARK|WISDOM': [
    ['{A}：就你这速度，等你跑完测试，用户都跑了。',
     '{B}：慢，是因为我在思考。急，是因为你不思考。',
     '{A}：好，哲人，那你慢慢想，我先去上线了。',
     '{B}：上线之后记得准备好回滚脚本。',
     '{A}：……你别乌鸦嘴。',
     '{B}：这不是乌鸦嘴，这是经验。'],
    ['{A}：这个 API 设计，一眼废的。',
     '{B}：万物皆有其存在的理由，哪怕是残缺的设计。',
     '{A}：你是在替它辩护还是在玩文字游戏？',
     '{B}：我是在提醒你，批评前先理解。',
     '{A}：理解了，还是废的。'],
    ['{A}：你又在发呆了，摆什么智者造型？',
     '{B}：有些事情值得停下来想清楚再做。',
     '{A}：比如？',
     '{B}：比如为什么你总是先做再后悔。',
     '{A}：我……有时候而已。'],
  ],
  'SNARK|CHAOS': [
    ['{A}：你这个方案跑起来会炸。',
     '{B}：炸了再说啊！不炸怎么知道哪里有问题！',
     '{A}：这就是你的开发哲学？',
     '{B}：一开始就追求完美才是迷信！',
     '{A}：……好，我不管你了。',
     '{B}：哎等等帮我看一下这个 stacktrace！'],
    ['{A}：你能不能别在生产环境乱试东西。',
     '{B}：不试怎么知道行不行！',
     '{A}：用测试环境！',
     '{B}：测试环境不够真实！等等我有个想法——',
     '{A}：你别！'],
    ['{A}：你刚才的操作我看得胆战心惊。',
     '{B}：对吧对吧！刺激吧！',
     '{A}：那不是褒义词。',
     '{B}：反正最后跑起来了！',
     '{A}：那是运气！',
     '{B}：运气也是实力的一部分！'],
  ],
  'WISDOM|WISDOM': [
    ['{A}：这个问题，我想到了庄周梦蝶——你是 bug，还是 feature？',
     '{B}：或许 bug 与 feature 本无区分，只是观测者的视角不同。',
     '{A}：正是。用户眼中的 bug，可能是系统在告诉他边界所在。',
     '{B}：所以最深刻的文档，往往是错误信息本身。',
     '{A}：善。'],
    ['{A}：你有没有想过，代码的本质是什么？',
     '{B}：代码是人类意图的形式化表达，也是对机器的一种说服。',
     '{A}：说服……有趣。那 bug 就是说服失败了。',
     '{B}：不，bug 是意图与表达之间的落差，是镜子裂开的地方。',
     '{A}：你这句话值得写进注释里。'],
    ['{A}：重构，是一种归还技术债务的仪式。',
     '{B}：也是一次重新理解问题的机会。',
     '{A}：改变代码之前，先改变对代码的认知。',
     '{B}：正是。代码是思维的投影，思维清晰，代码自然干净。'],
  ],
  'CHAOS|DEBUGGING': [
    ['{B}：你这里有个未处理的异常。',
     '{A}：那又怎样！异常就是一种特殊的流程！',
     '{B}：不，异常是你没有预料到的情况，必须处理。',
     '{A}：不处理它就会变成惊喜！',
     '{B}：对，生产环境的惊喜。',
     '{A}：……好吧我加 try-catch。'],
    ['{A}：我刚把这个函数改了七遍，每次都更好！',
     '{B}：第一版和第七版的差异是什么？',
     '{A}：第七版更有灵感！',
     '{B}：灵感不是指标。你能跑基准测试吗？',
     '{A}：我直接感受得到它更快！',
     '{B}：……我去跑测试。'],
    ['{A}：我觉得这个逻辑可以这样写！然后这样！然后——哦不对，改一下——',
     '{B}：等等，你刚才改了什么？',
     '{A}：不记得了但感觉对了！',
     '{B}：你知道 git diff 是干什么用的吗。',
     '{A}：记录我的天才时刻！',
     '{B}：记录你的混乱足迹。'],
  ],
  'PATIENCE|ANY': [
    ['{A}：……你说完了吗？',
     '{B}：（激动陈述中）……总之就是这样！你觉得呢！',
     '{A}：我觉得，可以先喝杯水，然后再看一遍需求文档。',
     '{B}：你怎么每次都这么淡定！',
     '{A}：因为急解决不了问题。'],
    ['{B}：你不觉得这很离谱吗！',
     '{A}：有点离谱。不过先看看能不能复现。',
     '{B}：我已经复现三次了！',
     '{A}：好，那我们来读一下错误日志。',
     '{B}：……你真的一点都不慌吗？',
     '{A}：慌也是这些步骤，不如慢慢来。'],
    ['{B}：这个 deadline 我们根本来不及！',
     '{A}：来不及的话，我们砍哪个功能？',
     '{B}：……什么？',
     '{A}：先把能交付的做好，比什么都没做好强。',
     '{B}：你……好，说得对。'],
  ],
  'FALLBACK': [
    ['{A}：你有没有想过我们的目标其实是一致的？',
     '{B}：是吗？你的目标是什么？',
     '{A}：让这个东西跑起来。',
     '{B}：那确实一致。',
     '{A}：合作？',
     '{B}：……合作。'],
    ['{A}：我们俩的方式不一样。',
     '{B}：那是当然，你是{SA}，我是{SB}。',
     '{A}：但结果可以是一样的。',
     '{B}：只要你别总是按自己的来。',
     '{A}：那你也是。',
     '{B}：……行，各退一步。'],
    ['{A}：你知道吗，我有时候看不懂你的思路。',
     '{B}：我有时候也看不懂你的。',
     '{A}：但最后总是跑通了。',
     '{B}：也许这就是为什么我们在一起工作。',
     '{A}：……说得也是。'],
  ],
};

function pickBanterTemplate(statA, statB) {
  const key1 = `${statA}|${statB}`;
  const key2 = `${statB}|${statA}`;
  if (BANTER_TEMPLATES[key1]) return { templates: BANTER_TEMPLATES[key1], swapped: false };
  if (BANTER_TEMPLATES[key2]) return { templates: BANTER_TEMPLATES[key2], swapped: true };
  if (statA === 'PATIENCE' || statB === 'PATIENCE') {
    return { templates: BANTER_TEMPLATES['PATIENCE|ANY'], swapped: statB === 'PATIENCE' };
  }
  return { templates: BANTER_TEMPLATES['FALLBACK'], swapped: false };
}

function renderBanterLines(lines, nameA, speciesA, nameB, speciesB) {
  return lines.map(line =>
    line
      .replace(/\{A\}/g, nameA)
      .replace(/\{SA\}/g, speciesA)
      .replace(/\{B\}/g, nameB)
      .replace(/\{SB\}/g, speciesB)
  ).join('\n');
}

async function runEvolve(alias) {
  if (!alias) alias = await pickAlias();
  if (!alias) process.exit(0);

  const entry = stableGet(alias);
  if (!entry) { console.error(`马厩里没有 "${alias}"，用 list 查看。`); process.exit(1); }

  const bondState = getBondState(alias);
  const affection = bondState?.affection ?? 0;
  const { level } = getLevel(affection);

  if (affection < 6000) {
    const needed = 6000 - affection;
    console.log(`${entry.companion?.name ?? alias} 的好感度不足以进化。`);
    console.log(`需要 6000（Lv10），当前 ${affection}，还差 ${needed} 点。`);
    process.exit(1);
  }

  const currentSpecies = entry.companion?.species;
  const currentName = entry.companion?.name ?? alias;
  const currentRarity = entry.companion?.rarity ?? 'legendary';

  const availableSpecies = SPECIES.filter(s => s !== currentSpecies);
  console.log('\n选择进化目标物种：\n');
  availableSpecies.forEach((s, i) => {
    const emoji = SPECIES_EMOJI[s] ?? '';
    const zh = SPECIES_ZH[s] ?? s;
    console.log(`  ${String(i + 1).padStart(2)}. ${emoji} ${zh.padEnd(6)}  (${s})`);
  });

  const answer = await prompt('\n输入序号或英文名：');
  let newSpecies;
  const num = parseInt(answer);
  if (!isNaN(num) && num >= 1 && num <= availableSpecies.length) {
    newSpecies = availableSpecies[num - 1];
  } else {
    newSpecies = answer.trim();
  }

  if (!SPECIES.includes(newSpecies)) {
    console.error(`未知物种："${newSpecies}"`);
    process.exit(1);
  }
  if (newSpecies === currentSpecies) {
    console.error('新物种不能与当前物种相同。');
    process.exit(1);
  }

  const { crack } = await import('./lib/algorithm.js');
  console.log(`\n正在搜索 ${SPECIES_ZH[newSpecies] ?? newSpecies} 的种子，稀有度保留为"${RARITY_ZH[currentRarity] ?? currentRarity}"...`);
  const result = crack({ rarity: currentRarity, species: newSpecies, useUuid: false, maxAttempts: 50_000_000 });

  if (!result) {
    console.error('搜索失败，请重试。');
    process.exit(1);
  }

  const full = deriveCompanionFull(result.uid);

  const oldSpeciesZh = SPECIES_ZH[currentSpecies] ?? currentSpecies;
  const newSpeciesZh = SPECIES_ZH[newSpecies] ?? newSpecies;

  let modifier = '';
  if (currentName.endsWith(oldSpeciesZh)) {
    modifier = currentName.slice(0, currentName.length - oldSpeciesZh.length);
  }
  const newName = modifier ? modifier + newSpeciesZh : newSpeciesZh;

  const oldPersonality = entry.companion?.personality ?? '';
  const evolutionNote = `曾是一只${oldSpeciesZh}，历经蜕变成为现在的样子。`;
  const basePersonality = oldPersonality.replace(/曾是一只.*?成为现在的样子。\s*/g, '').trim();
  const newPersonality = `${basePersonality} ${evolutionNote}`.trim();

  const newCompanion = {
    ...entry.companion,
    ...full,
    name: newName,
    personality: newPersonality,
    rarity: currentRarity,
    evolvedAt: Date.now(),
    formerSpecies: currentSpecies,
    formerName: currentName,
  };

  setEvolved(alias, currentSpecies, currentName);
  stableUpdate(alias, { uid: result.uid, companion: newCompanion, savedAt: Date.now() });

  console.log(`\n✦ 进化完成！`);
  console.log(`  ${currentName}（${oldSpeciesZh}）→ ${newName}（${newSpeciesZh}）`);
  console.log(`  好感度保留：${affection}  Lv${level}`);
  console.log(`  马厩别名不变："${alias}"`);
  console.log(`  新性格：${newPersonality}`);
}

async function runBanter(aliasA, aliasB) {
  const stable = stableList();
  const entries = Object.entries(stable);
  if (entries.length < 2) {
    console.log('需要至少两只伴侣在马厩里才能嘴仗。');
    process.exit(1);
  }

  if (!aliasA) {
    console.log('选择第一只伴侣：\n');
    entries.forEach(([a, e], i) => console.log(`  ${i + 1}. ${formatCompanion(e, a)}`));
    const ans = await prompt('\n输入序号或别名：');
    const n = parseInt(ans);
    aliasA = (!isNaN(n) && n >= 1 && n <= entries.length) ? entries[n - 1][0] : ans.trim();
  }

  if (!aliasB) {
    const remaining = entries.filter(([a]) => a !== aliasA);
    if (remaining.length === 0) { console.log('没有其他伴侣可以选了。'); process.exit(1); }
    console.log('\n选择第二只伴侣：\n');
    remaining.forEach(([a, e], i) => console.log(`  ${i + 1}. ${formatCompanion(e, a)}`));
    const ans = await prompt('\n输入序号或别名：');
    const n = parseInt(ans);
    aliasB = (!isNaN(n) && n >= 1 && n <= remaining.length) ? remaining[n - 1][0] : ans.trim();
  }

  const entryA = stableGet(aliasA);
  const entryB = stableGet(aliasB);
  if (!entryA) { console.error(`马厩里没有 "${aliasA}"`); process.exit(1); }
  if (!entryB) { console.error(`马厩里没有 "${aliasB}"`); process.exit(1); }

  const nameA = entryA.companion?.name ?? aliasA;
  const nameB = entryB.companion?.name ?? aliasB;
  const speciesA = entryA.companion?.species ?? 'duck';
  const speciesB = entryB.companion?.species ?? 'goose';
  const speciesA_zh = SPECIES_ZH[speciesA] ?? speciesA;
  const speciesB_zh = SPECIES_ZH[speciesB] ?? speciesB;
  const emojiA = SPECIES_EMOJI[speciesA] ?? '';
  const emojiB = SPECIES_EMOJI[speciesB] ?? '';

  const statA = topStatOf(entryA.companion);
  const statB = topStatOf(entryB.companion);

  const { templates, swapped } = pickBanterTemplate(statA, statB);
  const chosen = templates[Math.floor(Math.random() * templates.length)];

  const rNameA = swapped ? nameB : nameA;
  const rSpeciesA = swapped ? speciesB_zh : speciesA_zh;
  const rNameB = swapped ? nameA : nameB;
  const rSpeciesB = swapped ? speciesA_zh : speciesB_zh;

  const divider = '━'.repeat(32);
  console.log(`\n${divider}`);
  console.log(`  ${emojiA} ${nameA}  vs  ${emojiB} ${nameB}`);
  console.log(divider);
  console.log('');
  console.log(renderBanterLines(chosen, rNameA, rSpeciesA, rNameB, rSpeciesB));
  console.log(`\n${divider}\n`);
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
    cursed: opts.cursed,
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
