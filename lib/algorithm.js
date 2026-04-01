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
