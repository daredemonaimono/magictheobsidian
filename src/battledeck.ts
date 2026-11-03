import { App, TFile } from "obsidian";
import { cardInfo, oracleEnglish } from "./cards";
import { DECK_DIR, parseDeck } from "./deck";
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
  const lines: string[] = [];
  let noStats = 0;
  for (const [key, e] of deck.main) {
    const info = cardInfo(app, key);
    if (!info) continue;
    const oracle = (await oracleEnglish(app, key)).replace(/\s+\n/g, "\n").trim();
    const num = (v?: string) => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : 0); // "*" などは 0 にする (簡略)
    if (/\bCreature\b/.test(info.typeLine) && info.power === undefined) noStats++;
    const def = makeDef({ key, name: info.name, typeLine: info.typeLine, manaCost: info.manaCost, cmc: info.cmc, power: num(info.power), toughness: num(info.toughness), oracle });
    for (let i = 0; i < e.n; i++) defs.push(def);
    lines.push(`${e.n}x ${info.name} ${info.manaCost} [${info.typeLine}${info.power !== undefined ? ` ${info.power}/${info.toughness}` : ""}] ${oracle.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  const m = content.match(/\n## 動き方\n([\s\S]*?)(?=\n## |$)/);
  return { name: file.basename, defs, playbook: m?.[1].trim() ?? "", list: lines.join("\n"), noStats };
}
