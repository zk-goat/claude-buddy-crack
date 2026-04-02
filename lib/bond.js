import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const BOND_PATH = join(homedir(), '.claude.companions-bond.json');

export const LEVELS = [
  { level: 1,  title: '陌生人',   threshold: 0    },
  { level: 2,  title: '认识',     threshold: 100  },
  { level: 3,  title: '朋友',     threshold: 300  },
  { level: 4,  title: '好友',     threshold: 600  },
  { level: 5,  title: '挚友',     threshold: 1000 },
  { level: 6,  title: '密友',     threshold: 1500 },
  { level: 7,  title: '知己',     threshold: 2500 },
  { level: 8,  title: '老友',     threshold: 3600 },
  { level: 9,  title: '挚交',     threshold: 5000 },
  { level: 10, title: '永恒契约', threshold: 6000 },
];

const BOND_SUFFIX = {
  1:  '',
  2:  '跟你刚熟悉，说话还有些拘谨。',
  3:  '跟你有些熟了，偶尔会多说两句。',
  4:  '跟你是朋友了，说话自然了不少。',
  5:  '跟你很熟了，会结合自己的专长主动给出建议。',
  6:  '是你的密友，把你的代码问题当自己的事来对待。',
  7:  '是你的知己，说话直接亲切，从不绕弯子。',
  8:  '跟你相识已久，对你的编码习惯了如指掌。',
  9:  '与你有深厚羁绊，总能在关键时刻说出最需要听的话。',
  10: '与你有永恒契约，早已把你的成功视为自己的使命。',
};

// Relationship titles by stat combination
const RELATION_TITLES = {
  'SNARK|SNARK':         '互怼双煞',
  'SNARK|WISDOM':        '毒舌与哲人',
  'SNARK|CHAOS':         '毒舌与混乱',
  'SNARK|DEBUGGING':     '毒舌与追错',
  'SNARK|PATIENCE':      '毒舌与淡定',
  'WISDOM|WISDOM':       '双智之光',
  'WISDOM|CHAOS':        '哲人与混乱',
  'WISDOM|DEBUGGING':    '智慧与追错',
  'WISDOM|PATIENCE':     '智者与静默',
  'CHAOS|CHAOS':         '双重混乱体',
  'CHAOS|DEBUGGING':     '秩序与混沌',
  'CHAOS|PATIENCE':      '混乱与淡定',
  'DEBUGGING|DEBUGGING': 'Debug双人组',
  'DEBUGGING|PATIENCE':  '追错与耐心',
  'PATIENCE|PATIENCE':   '淡定天团',
};

const RELATION_DEPTH = [
  { days: 1,  prefix: '' },
  { days: 3,  prefix: '熟悉的' },
  { days: 7,  prefix: '老' },
  { days: 14, prefix: '形影不离的' },
  { days: 30, prefix: '命中注定的' },
];

export function getRelationTitle(statA, statB, days) {
  const key = [statA, statB].sort().join('|');
  const base = RELATION_TITLES[key] ?? '同伴';
  const depth = [...RELATION_DEPTH].reverse().find(d => days >= d.days) ?? RELATION_DEPTH[0];
  return depth.prefix + base;
}

// Bond star display for list command
export const BOND_STARS = [
  '', '☆', '★', '★★', '★★★', '★★★★', '★★★★★', '✦★★★★★', '✦✦★★★★★', '✦✦✦★★★★★', '💫'
];

const MAX_ENERGY = 100;
const ENERGY_REGEN_PER_DAY = 20;
const PLAY_ENERGY_COST = 30;
const FEED_COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 hours
const PET_DAILY_LIMIT = 3;
const PLAY_DAILY_LIMIT = 1;

function today() {
  return new Date().toDateString();
}

function loadBond() {
  if (!existsSync(BOND_PATH)) return {};
  try { return JSON.parse(readFileSync(BOND_PATH, 'utf8')); }
  catch { return {}; }
}

function saveBond(data) {
  writeFileSync(BOND_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function getLevel(affection) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) {
    if (affection >= l.threshold) lvl = l;
  }
  return lvl;
}

function nextLevel(affection) {
  for (const l of LEVELS) {
    if (affection < l.threshold) return l;
  }
  return null;
}

export function buildPersonality(basePersonality, affection) {
  const { level } = getLevel(affection);
  const suffix = BOND_SUFFIX[level];
  if (!suffix) return basePersonality;
  // Replace or append bond suffix (always at end, before 只说中文 if present)
  const base = basePersonality.replace(/\s*(跟你.*?。|是你的.*?。|与你.*?。)(\s*只说中文。)?$/, '').trimEnd();
  const zh = basePersonality.includes('只说中文') ? '只说中文。' : '';
  return `${base} ${suffix}${zh ? ' ' + zh : ''}`.trim();
}

export function getCompanionTitle(alias, affection) {
  const { level, title } = getLevel(affection);
  if (level >= 7) return `「${title}」${alias}`;
  return alias;
}

function initState(alias, basePersonality) {
  return {
    affection: 0,
    basePersonality,
    energy: MAX_ENERGY,
    lastEnergyDate: today(),
    lastFed: 0,
    petToday: 0,
    petDate: '',
    playToday: 0,
    playDate: '',
  };
}

function regenEnergy(state) {
  if (state.lastEnergyDate !== today()) {
    const daysPassed = Math.max(1, Math.round(
      (new Date() - new Date(state.lastEnergyDate)) / 86400000
    ));
    state.energy = Math.min(MAX_ENERGY, state.energy + ENERGY_REGEN_PER_DAY * daysPassed);
    state.lastEnergyDate = today();
  }
  return state;
}

export function interact(alias, action, basePersonality) {
  const bond = loadBond();
  let state = bond[alias] ?? initState(alias, basePersonality);
  state = regenEnergy(state);

  const prevLevel = getLevel(state.affection).level;
  let gained = 0;
  let message = '';

  if (action === 'feed') {
    const elapsed = Date.now() - (state.lastFed ?? 0);
    if (elapsed < FEED_COOLDOWN_MS) {
      const waitH = Math.ceil((FEED_COOLDOWN_MS - elapsed) / 3600000);
      return { ok: false, message: `还没到喂食时间，${waitH} 小时后再来。` };
    }
    gained = 10;
    state.lastFed = Date.now();
    message = `喂食成功！+${gained} 好感度`;
  } else if (action === 'pet') {
    if (state.petDate !== today()) { state.petCount = 0; state.petDate = today(); }
    if ((state.petCount ?? 0) >= PET_DAILY_LIMIT) {
      return { ok: false, message: `今天摸头次数已用完（${PET_DAILY_LIMIT}次/天）` };
    }
    gained = 6;
    state.petCount = (state.petCount ?? 0) + 1;
    message = `摸头成功！+${gained} 好感度（今日剩余 ${PET_DAILY_LIMIT - state.petCount} 次）`;
  } else if (action === 'play') {
    if (state.playDate !== today()) { state.playCount = 0; state.playDate = today(); }
    if ((state.playCount ?? 0) >= PLAY_DAILY_LIMIT) {
      return { ok: false, message: `今天已经玩过了，明天再来。` };
    }
    if (state.energy < PLAY_ENERGY_COST) {
      return { ok: false, message: `体力不足（当前 ${state.energy}/${MAX_ENERGY}），明天恢复后再玩。` };
    }
    gained = 15;
    state.energy -= PLAY_ENERGY_COST;
    state.playCount = (state.playCount ?? 0) + 1;
    message = `玩耍成功！+${gained} 好感度（体力 ${state.energy}/${MAX_ENERGY}）`;
  }

  state.affection += gained;
  state.lastInteractDate = today();
  const newLevel = getLevel(state.affection).level;
  const leveledUp = newLevel > prevLevel;

  bond[alias] = state;

  // Update pairwise relationships — any other companion interacted with today
  const rels = bond.__relationships ?? {};
  for (const [other, otherState] of Object.entries(bond)) {
    if (other === alias || other === '__relationships') continue;
    if (otherState.lastInteractDate !== today()) continue;
    const pairKey = [alias, other].sort().join('|');
    const pair = rels[pairKey] ?? { days: 0, lastSharedDay: '' };
    if (pair.lastSharedDay !== today()) {
      pair.days += 1;
      pair.lastSharedDay = today();
    }
    rels[pairKey] = pair;
  }
  bond.__relationships = rels;
  saveBond(bond);

  return {
    ok: true,
    message,
    affection: state.affection,
    level: getLevel(state.affection),
    leveledUp,
    nextLevel: nextLevel(state.affection),
    energy: state.energy,
    basePersonality: state.basePersonality,
  };
}

export function getStatus(alias) {
  const bond = loadBond();
  const state = bond[alias];
  if (!state) return null;
  const lvl = getLevel(state.affection);
  const next = nextLevel(state.affection);
  return { ...state, levelInfo: lvl, nextLevel: next };
}

export function getBondState(alias) {
  const bond = loadBond();
  return bond[alias] ?? null;
}

// Returns array of { other, days, title } for all relationships involving alias
export function getRelationships(alias, companionNames = {}) {
  const bond = loadBond();
  const rels = bond.__relationships ?? {};
  const result = [];
  for (const [key, pair] of Object.entries(rels)) {
    const parts = key.split('|');
    if (!parts.includes(alias)) continue;
    const other = parts.find(p => p !== alias);
    const otherName = companionNames[other] ?? other;
    result.push({ other, otherName, days: pair.days });
  }
  return result;
}

export function getAllRelationships() {
  const bond = loadBond();
  return bond.__relationships ?? {};
}

// Build full personality including bond suffix + relationship lines
export function buildFullPersonality(basePersonality, affection, relationships = []) {
  let p = buildPersonality(basePersonality, affection);
  if (relationships.length === 0) return p;
  const relLines = relationships
    .map(r => `与${r.otherName}是${r.title}（同行${r.days}天）`)
    .join('，');
  // Insert before 只说中文 if present
  if (p.includes('只说中文')) {
    return p.replace('只说中文。', `${relLines}。只说中文。`);
  }
  return `${p} ${relLines}。`;
}
