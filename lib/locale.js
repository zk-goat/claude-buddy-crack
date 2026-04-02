import { STATS } from './algorithm.js';

export const SPECIES_ZH = {
  duck:     '鸭',
  goose:    '鹅',
  blob:     '史莱姆',
  cat:      '猫',
  dragon:   '龙',
  octopus:  '章鱼',
  owl:      '鸮',
  penguin:  '企鹅',
  turtle:   '龟',
  snail:    '蜗牛',
  ghost:    '鬼',
  axolotl:  '美西螈',
  capybara: '水豚',
  cactus:   '仙人掌',
  robot:    '机器人',
  rabbit:   '兔',
  mushroom: '蘑菇',
  chonk:    '胖墩',
};

export const RARITY_ZH = {
  common:    '普通',
  uncommon:  '非凡',
  rare:      '稀有',
  epic:      '史诗',
  legendary: '传奇',
};

const STAT_MODIFIERS_ZH = {
  DEBUGGING: ['追错', '排查', '调试'],
  PATIENCE:  ['淡定', '稳重', '摆烂'],
  CHAOS:     ['乱码', '随机', '爆炸'],
  WISDOM:    ['智慧', '深邃', '哲学'],
  SNARK:     ['毒舌', '嘲讽', '犀利'],
};

const STAT_DESCRIPTIONS_ZH = {
  DEBUGGING: '擅长在代码里找问题，一眼就能看出哪里出了bug',
  PATIENCE:  '极度淡定，任何报错都不能让它皱一下眉',
  CHAOS:     '思维天马行空，给出的建议有时让人摸不着头脑',
  WISDOM:    '洞察深邃，偶尔说出的话让人回味良久',
  SNARK:     '说话毒舌，但总是一针见血',
};

function topStat(stats) {
  return STATS.reduce((a, b) => stats[b] > stats[a] ? b : a);
}

export function buildChineseName(species, stats) {
  const best = topStat(stats);
  const mods = STAT_MODIFIERS_ZH[best];
  const mod = mods[Math.floor(Math.random() * mods.length)];
  return mod + (SPECIES_ZH[species] ?? species);
}

export function buildChinesePersonality(rarity, species, stats) {
  const best = topStat(stats);
  const rarityZh = RARITY_ZH[rarity] ?? rarity;
  const speciesZh = SPECIES_ZH[species] ?? species;
  return `一只${rarityZh}${speciesZh}，${STAT_DESCRIPTIONS_ZH[best]}。只说中文。`;
}
