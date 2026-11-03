import { App, TFile } from "obsidian";
import { cardInfo, oracleEnglish } from "./cards";
import { DECK_DIR, parseDeck } from "./deck";

// ひとり回しの試し用の最小限の盤面。本実装のエンジンではなく、捨てる前提。
// 簡略: 土地1枚 = 色を問わず 1 マナ。呪文は唱えると場 (クリーチャー等) か墓地 (インスタント・ソーサリー) に行くだけで、効果は実行しない。戦闘・相手は無し。

export interface BCard {
  id: number;
  key: string;
  name: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  oracle: string;
}
export interface Land {
  card: BCard;
  tapped: boolean;
}
export interface Game {
  library: BCard[];
  hand: BCard[];
  lands: Land[];
  field: BCard[];
  graveyard: BCard[];
  turn: number;
  landDropped: boolean;
}
export interface Action {
  id: number;
  kind: "land" | "cast" | "pass";
  card?: BCard;
  label: string;
}

export const isLand = (c: BCard) => /\bLand\b/.test(c.typeLine);
export const decks = (app: App) => app.vault.getFiles().filter((f) => f.path.startsWith(`${DECK_DIR}/`) && f.extension === "md");

export interface LoadedDeck {
  name: string;
  cards: BCard[];
  playbook: string; // デッキのノートの「動き方」欄
  list: string; // bot に見せるカード一覧 (種類ごとの枚数と効果)
}

// メインのカードだけ (サイド・トークン・コマンダーは使わない)
export async function loadDeck(app: App, file: TFile): Promise<LoadedDeck> {
  const content = await app.vault.cachedRead(file);
  const deck = parseDeck(content);
  const cards: BCard[] = [];
  const lines: string[] = [];
  let id = 0;
  for (const [key, e] of deck.main) {
    const info = cardInfo(app, key);
    if (!info) continue;
    const oracle = (await oracleEnglish(app, key)).replace(/\s+/g, " ").slice(0, 400);
    for (let i = 0; i < e.n; i++) cards.push({ id: id++, key, name: info.name, typeLine: info.typeLine, manaCost: info.manaCost, cmc: info.cmc, oracle });
    lines.push(`${e.n}x ${info.name} ${info.manaCost} [${info.typeLine}] ${oracle}`);
  }
  const m = content.match(/\n## 動き方\n([\s\S]*?)(?=\n## |$)/);
  return { name: file.basename, cards, playbook: m?.[1].trim() ?? "", list: lines.join("\n") };
}

export function newGame(cards: BCard[]): Game {
  const library = [...cards];
  for (let i = library.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [library[i], library[j]] = [library[j], library[i]];
  }
  return { library, hand: library.splice(0, 7), lands: [], field: [], graveyard: [], turn: 0, landDropped: false };
}

// ターン開始: アンタップ → ドロー (最初のターンは引かない)
export function startTurn(g: Game): string[] {
  g.turn++;
  g.landDropped = false;
  g.lands.forEach((l) => (l.tapped = false));
  const log = [`--- ターン ${g.turn} ---`];
  if (g.turn > 1) {
    const c = g.library.shift();
    if (c) {
      g.hand.push(c);
      log.push(`ドロー: ${c.name}`);
    } else log.push("山札が無い");
  }
  return log;
}

// 手札が8枚以上なら、コストの高いものから捨てる (試し用の簡略)
export function endTurn(g: Game): string[] {
  const log: string[] = [];
  while (g.hand.length > 7) {
    g.hand.sort((a, b) => a.cmc - b.cmc);
    const c = g.hand.pop()!;
    g.graveyard.push(c);
    log.push(`手札上限で捨てる: ${c.name}`);
  }
  return log;
}

export function legalActions(g: Game): Action[] {
  const acts: Omit<Action, "id">[] = [];
  const seen = new Set<string>();
  const free = g.lands.filter((l) => !l.tapped).length;
  for (const c of g.hand) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    if (isLand(c)) {
      if (!g.landDropped) acts.push({ kind: "land", card: c, label: `土地を出す: ${c.name}` });
    } else if (c.cmc <= free) acts.push({ kind: "cast", card: c, label: `唱える: ${c.name} ${c.manaCost}` });
  }
  acts.push({ kind: "pass", label: "ターンを終える" });
  return acts.map((a, i) => ({ ...a, id: i + 1 }));
}

// 実行して、ログの1行を返す
export function apply(g: Game, a: Action): string {
  if (a.kind === "pass" || !a.card) return "ターンを終える";
  const i = g.hand.findIndex((c) => c.key === a.card!.key);
  const [c] = g.hand.splice(i, 1);
  if (a.kind === "land") {
    g.lands.push({ card: c, tapped: false });
    g.landDropped = true;
    return `土地を出す: ${c.name}`;
  }
  let pay = c.cmc;
  for (const l of g.lands) if (pay > 0 && !l.tapped) (l.tapped = true), pay--;
  (/Instant|Sorcery/.test(c.typeLine) ? g.graveyard : g.field).push(c);
  return `唱える: ${c.name} (効果は未実行)`;
}

export function stateText(g: Game, recent: string[]): string {
  const names = (cs: BCard[]) => (cs.length ? cs.map((c) => c.name).join(", ") : "なし");
  return [
    `ターン ${g.turn} のメインフェイズ`,
    `手札: ${names(g.hand)}`,
    `場の土地: ${g.lands.length} 枚 (未タップ ${g.lands.filter((l) => !l.tapped).length})${g.landDropped ? " / このターンは土地を出し済み" : ""}`,
    `場のカード: ${names(g.field)}`,
    `墓地: ${names(g.graveyard)}`,
    `山札: 残り ${g.library.length} 枚`,
    `直近のログ:\n${recent.slice(-8).join("\n")}`,
  ].join("\n");
}
