import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ACHIEVEMENTS_PATH = join(homedir(), '.claude.companions-achievements.json');

const ACHIEVEMENTS = [
  { id: 'first_companion',   name: '初来乍到',   desc: '存入第一只伴侣',       icon: '🐣' },
  { id: 'full_stable',       name: '满厩生辉',   desc: '马厩同时存有5只伴侣',  icon: '🏠' },
  { id: 'species_collector', name: '物种图鉴',   desc: '集齐全部18种物种',     icon: '📖' },
  { id: 'shiny_hunter',      name: '闪光猎人',   desc: '拥有3只闪光伴侣',      icon: '✨' },
  { id: 'legendary_only',    name: '传奇收藏家', desc: '马厩全是传奇',          icon: '👑' },
  { id: 'lv5',               name: '真·好友',    desc: '任意伴侣达到Lv5',      icon: '⭐' },
  { id: 'lv10',              name: '永恒契约',   desc: '任意伴侣达到Lv10',     icon: '💫' },
  { id: 'bond_week',         name: '形影不离',   desc: '任意两只伴侣同行7天',  icon: '🤝' },
  { id: 'daily_7',           name: '七日坚持',   desc: '连续7天与同一伴侣互动', icon: '🔥' },
  { id: 'birthday',          name: '生日快乐',   desc: '在伴侣生日当天与它互动', icon: '🎂' },
];

function loadAchievements() {
  if (!existsSync(ACHIEVEMENTS_PATH)) return { unlocked: [] };
  try {
    return JSON.parse(readFileSync(ACHIEVEMENTS_PATH, 'utf8'));
  } catch {
    return { unlocked: [] };
  }
}

function saveAchievements(data) {
  writeFileSync(ACHIEVEMENTS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Check all achievements against current game state.
 * Returns an array of newly unlocked achievement objects.
 *
 * @param {Object} stable        - Result of stableList(): { [alias]: { uid, companion, hatchedAt, ... } }
 * @param {Object} bondData      - Bond data keyed by alias: { [alias]: { affection, consecutiveDays, birthdayInteracted, ... } }
 * @param {Object} relationships - Pairwise relationship data: { [pairKey]: { days, lastSharedDay } }
 */
export function checkAchievements(stable, bondData, relationships) {
  const data = loadAchievements();
  const alreadyUnlocked = new Set(data.unlocked.map(u => u.id));
  const newlyUnlocked = [];

  const stableEntries = Object.values(stable ?? {});
  const bondEntries = Object.values(bondData ?? {});
  const relEntries = Object.values(relationships ?? {});

  for (const achievement of ACHIEVEMENTS) {
    if (alreadyUnlocked.has(achievement.id)) continue;

    let earned = false;

    switch (achievement.id) {
      case 'first_companion':
        earned = stableEntries.length >= 1;
        break;

      case 'full_stable':
        earned = stableEntries.length >= 5;
        break;

      case 'species_collector': {
        const species = new Set(
          stableEntries.map(e => e.companion?.species).filter(Boolean)
        );
        earned = species.size >= 18;
        break;
      }

      case 'shiny_hunter': {
        const shinyCount = stableEntries.filter(
          e => e.companion?.shiny === true
        ).length;
        earned = shinyCount >= 3;
        break;
      }

      case 'legendary_only': {
        const nonEmpty = stableEntries.length >= 2;
        const allLegendary = stableEntries.every(
          e => e.companion?.rarity === 'legendary'
        );
        earned = nonEmpty && allLegendary;
        break;
      }

      case 'lv5':
        earned = bondEntries.some(b => (b.affection ?? 0) >= 1000);
        break;

      case 'lv10':
        earned = bondEntries.some(b => (b.affection ?? 0) >= 6000);
        break;

      case 'bond_week':
        earned = relEntries.some(r => (r.days ?? 0) >= 7);
        break;

      case 'daily_7':
        earned = bondEntries.some(b => (b.consecutiveDays ?? 0) >= 7);
        break;

      case 'birthday':
        earned = bondEntries.some(b => b.birthdayInteracted === true);
        break;

      default:
        break;
    }

    if (earned) {
      const unlockEntry = { ...achievement, unlockedAt: Date.now() };
      newlyUnlocked.push(unlockEntry);
      alreadyUnlocked.add(achievement.id);
    }
  }

  if (newlyUnlocked.length > 0) {
    const updated = {
      ...data,
      unlocked: [...data.unlocked, ...newlyUnlocked],
    };
    saveAchievements(updated);
  }

  return newlyUnlocked;
}

/**
 * Return all currently unlocked achievements.
 * @returns {Array} Array of unlocked achievement objects (with unlockedAt timestamp).
 */
export function getUnlocked() {
  const data = loadAchievements();
  return data.unlocked ?? [];
}

/**
 * Return a formatted string displaying all achievements with lock/unlock status.
 * @returns {string}
 */
export function formatAchievements() {
  const data = loadAchievements();
  const unlockedIds = new Set((data.unlocked ?? []).map(u => u.id));

  const lines = ACHIEVEMENTS.map(a => {
    const unlocked = unlockedIds.has(a.id);
    const status = unlocked ? '✅' : '🔒';
    return `${status} ${a.icon} ${a.name}  —  ${a.desc}`;
  });

  const total = ACHIEVEMENTS.length;
  const done = unlockedIds.size;

  return [
    `成就进度：${done}/${total}`,
    '',
    ...lines,
  ].join('\n');
}
