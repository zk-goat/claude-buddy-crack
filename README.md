# claude-buddy-crack

为 [Claude Code](https://claude.ai/code) 伴侣系统定制你想要的小动物——指定物种、稀有度、闪光，可选中文名和中文性格。多线程搜索，通常在 1 秒内完成。

## 快速开始

```bash
# 克隆到本地
git clone https://github.com/zk-goat/claude-buddy-crack.git
cd claude-buddy-crack

# 抽一只传奇闪光龙（中文）
node index.js --rarity legendary --shiny --species dragon --lang zh

# 完成后在 Claude Code 里发一条消息，伴侣就会出现
```

> 需要 Node.js 18+，且已安装并登录过 Claude Code（需要存在 `~/.claude.json`）

---

## 所有选项

```bash
node index.js [选项]

--rarity <稀有度>    目标稀有度（默认 legendary）
                    可选：common / uncommon / rare / epic / legendary

--species <物种>     目标物种（可选，不填则随机）
                    可选：duck goose blob cat dragon octopus owl penguin
                          turtle snail ghost axolotl capybara cactus
                          robot rabbit mushroom chonk

--shiny             要求闪光（额外 1% 概率）

--lang zh           中文模式：根据物种+性格生成中文名，伴侣将说中文

--dry-run           预览结果，不修改配置文件

--restore           还原上一次备份
```

### 示例

```bash
# 传奇闪光猫，中文
node index.js --rarity legendary --shiny --species cat --lang zh

# 史诗水豚，不要闪光
node index.js --rarity epic --species capybara

# 随便来只传奇，看看是什么
node index.js --rarity legendary --lang zh

# 先预览，再决定要不要注入
node index.js --rarity legendary --shiny --species ghost --lang zh --dry-run
```

---

## 马厩：同时管理多只伴侣

搜到喜欢的就存起来，随时一键切换，不用重新搜索。

```bash
# 保存当前伴侣到马厩
node index.js save 哲学鬼

# 查看马厩里所有伴侣
node index.js list

# 切换伴侣（不带参数会显示列表让你选）
node index.js switch
node index.js switch 哲学鬼

# 从马厩删除
node index.js remove 哲学鬼
```

---

## 原理

Claude Code 在 `cli.js` 里通过以下链条从 `userID`（或 `oauthAccount.accountUuid`）派生伴侣特征：

```
seed     = userID + "friend-2026-401"
hash     = FNV-1a(seed)          ← Node.js 环境下的实际 hash 函数
prng     = SplitMix32(hash)
companion = deriveTraits(prng)   ← 稀有度 / 物种 / 眼睛 / 帽子 / 闪光 / 属性
```

本工具用多线程暴力搜索一个满足目标条件的 64 位 hex `userID`，找到后注入 `~/.claude.json`。

指定 `--lang zh` 时，工具会根据伴侣最高属性（DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK）生成对应风格的中文名和中文 personality，并直接写入 companion 对象，无需重新 `/buddy`。

> **为什么不用 hatch.py？**  
> [hatch.py](https://github.com/cminn10/claude-buddy-hatchery) 使用 `Bun.hash`（wyhash），但 Claude Code 运行在 Node.js 环境中，`typeof Bun === "undefined"`，实际走的是 FNV-1a fallback。hash 函数不同，预测结果也不同。

---

## 注意事项

- 修改仅影响伴侣外观，账号、计费、API 功能不受影响
- 每次注入前自动备份到 `~/.claude.json.buddy-backup`，随时可 `--restore` 还原
- 马厩数据保存在 `~/.claude.companions.json`
