import { App, TFile } from "obsidian";
import { cardInfo, oracleEnglish, refetchCard } from "./cards";
import { Settings } from "./settings";
import { DECK_DIR, parseDeck } from "./deck";
import { loadRule, needsRule } from "./cardrules";
import { CardBrief, formatCardList } from "./botinfo";
import { CardDef, makeDef } from "./engine";

export interface BattleDeck {
  name: string;
  defs: CardDef[]; // メインのカードを1枚ずつ
  playbook: string; // 「動き方」欄
  list: string; // ボットに見せるカード一覧 (種類ごとの枚数と効果)
  noStats: number; // パワー・タフネスが無いクリーチャーの種類数 (情報取得で補う)
}

export const deckFiles = (app: App) => app.vault.getFiles().filter((f) => f.path.startsWith(`${DECK_DIR}/`) && f.extension === "md");

// メインのカードだけ使う (サイド・トークン・コマンダーは使わない)
export async function loadBattleDeck(app: App, file: TFile): Promise<BattleDeck> {
  const content = await app.vault.cachedRead(file);
  const deck = parseDeck(content);
  const defs: CardDef[] = [];
  const briefs: CardBrief[] = [];
  let noStats = 0;
  for (const [key, e] of deck.main) {
    const info = cardInfo(app, key);
    if (!info) continue;
    const oracle = (await oracleEnglish(app, key)).replace(/\s+\n/g, "\n").trim();
    const rule = await loadRule(app, key);
    const num = (v: string | undefined, fallback: number) => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : fallback); // "*" や "1+*" は計算できないので、パワー 0・タフネス 1 にする (簡略。出てすぐ死なないように)
    if (/\bCreature\b/.test(info.typeLine) && (info.power === undefined || info.keywords === undefined)) noStats++;
    const def = makeDef({ key, name: info.name, typeLine: info.typeLine, manaCost: info.manaCost, cmc: info.cmc, power: num(info.power, 0), toughness: num(info.toughness, 1), oracle, abilities: rule?.abilities, keywords: info.keywords });
    for (let i = 0; i < e.n; i++) defs.push(def);
    briefs.push({ n: e.n, name: info.name, manaCost: info.manaCost, typeLine: info.typeLine, power: info.power, toughness: info.toughness, oracle, abilities: rule?.abilities, unsupported: rule?.unsupported ?? [], needsRule: needsRule(info.typeLine, oracle) });
  }
  const m = content.match(/\n## 動き方\n([\s\S]*?)(?=\n## |$)/);
  return { name: file.basename, defs, playbook: m?.[1].trim() ?? "", list: formatCardList(briefs), noStats };
}

// パワー・タフネスやキーワードが無い古いクリーチャーのノート (メインのカードだけ)
export async function statsMissing(app: App, file: TFile): Promise<string[]> {
  const deck = parseDeck(await app.vault.cachedRead(file));
  return [...deck.main.keys()].filter((k) => {
    const i = cardInfo(app, k);
    return i && /\bCreature\b/.test(i.typeLine) && (i.power === undefined || i.keywords === undefined);
  });
}

// 無いものを Scryfall から取り直す (API キーは要らない)。取れなかったカード名と理由を返す
export async function fetchStats(app: App, settings: Settings, keys: string[], progress?: (done: number) => void): Promise<string[]> {
  const failed: string[] = [];
  let done = 0;
  for (const k of keys) {
    try {
      await refetchCard(app, settings, k);
    } catch (e) {
      failed.push(`${k} (${(e as Error).message})`);
    }
    progress?.(++done);
    await new Promise((r) => setTimeout(r, 100)); // Scryfall の負荷配慮
  }
  // ノートの更新が、Obsidian の読み取り (metadataCache) に反映されるのを待つ
  for (let i = 0; i < 15 && keys.some((k) => !failed.some((f) => f.startsWith(`${k} `)) && cardInfo(app, k)?.power === undefined && /\bCreature\b/.test(cardInfo(app, k)?.typeLine ?? "")); i++) await new Promise((r) => setTimeout(r, 200));
  return failed;
}
