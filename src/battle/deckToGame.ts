import { startGame } from "./engine";
import { TokenArt } from "./tokenArt";
import { Game, GameCard, RuleBook, createGame } from "./state";

// デッキ → 対戦の局面。Obsidian に依存しない純粋な関数 (カードのノートを読む処理は、画面の側)

// カードのノート (Cards/) から読んだ、対戦に要る内容。name = ノートの名前 (Rules/ のルールのノートと同じ名前)
export interface CardData {
  name: string;
  typeLine: string;
  cmc: number;
  manaCost: string; // "{3}{U}{U} // {U}" のように、両面・冒険・準備は " // " で分かれる。無ければ空
  power?: string; // "*" や "1+*" もある
  toughness?: string;
  keywords?: string[];
  colors: string[];
  loyalty?: number;
  art?: string; // デッキで選んだ版の絵の URL
  foil?: boolean; // デッキで、フォイルにしたカード (見た目だけ)
}

export interface DeckData {
  format: string;
  tokens?: TokenArt[]; // デッキの ## Token に入れてあるトークン
  main: { key: string; n: number; data: CardData }[]; // メイン (コマンダー欄・サイド・トークン欄は、山札に入れない)
}

// 自動対戦 (selfplay) に渡す、名前つきのデッキ
export interface BuiltDeck {
  name: string;
  data: DeckData;
}

export class MatchError extends Error {}

const num = (s?: string): number => (s !== undefined && /^\d+$/.test(s) ? Number(s) : 0); // * や 1+* は 0 (エンジンに特性定義能力が無い。限界)

// カードのデータ → GameCard。id は、1枚ごとに重ならないものを呼び出し側が決める
export function toGameCard(d: CardData, id: string, owner: string): GameCard {
  const front = d.manaCost.split(" // ")[0].trim(); // 前面のコスト
  return {
    id,
    name: d.name,
    typeLine: d.typeLine.split(" // ")[0].trim(), // 前面の型行 (両面・冒険は、全体を渡すと、型の判定が混ざる)
    mv: d.cmc,
    ...(front ? { manaCost: front } : {}),
    ...(/\bRoom\b/.test(d.typeLine) && d.manaCost.split(" // ")[1]?.trim() ? { cost2: d.manaCost.split(" // ")[1].trim() } : {}),
    ...(d.power !== undefined ? { power: num(d.power), toughness: num(d.toughness) } : {}),
    ...(d.keywords ? { keywords: d.keywords } : {}),
    colors: d.colors,
    ...(d.loyalty !== undefined ? { loyalty: d.loyalty } : {}),
    ...(d.art ? { art: d.art } : {}),
    ...(d.foil ? { foil: true } : {}),
    owner,
  };
}

const SIDE = { you: "自分", opp: "相手" } as const;
const OPENING_HAND = 7;

function library(deck: DeckData, owner: "you" | "opp", rng: () => number): GameCard[] {
  const cards: GameCard[] = [];
  let seq = 0;
  for (const e of deck.main) for (let i = 0; i < e.n; i++) cards.push(toGameCard(e.data, `${owner}:${e.key}#${++seq}`, owner));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); // Fisher–Yates
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// 対戦を始める: 山札を切り、手札を 7 枚ずつ引く (自分が先手。マリガンは無し)。統率戦と、メインが 7 枚に足りないデッキは、MatchError
export function buildMatch(self: DeckData, opp: DeckData, rules: RuleBook, rng: () => number = Math.random): Game {
  for (const [who, deck] of [["you", self], ["opp", opp]] as const) {
    if (deck.format === "commander") throw new MatchError(`${SIDE[who]}のデッキは統率戦。統率戦のデッキは、対戦に使えない`);
    const total = deck.main.reduce((a, e) => a + e.n, 0);
    if (total < OPENING_HAND) throw new MatchError(`${SIDE[who]}のデッキが ${OPENING_HAND} 枚に足りない (${total} 枚)`);
  }
  const g = createGame(["you", "opp"]);
  g.libraries["you"] = library(self, "you", rng);
  g.libraries["opp"] = library(opp, "opp", rng);
  if (self.tokens?.length || opp.tokens?.length) g.tokenArt = { you: self.tokens ?? [], opp: opp.tokens ?? [] };
  g.payManaCosts = true;
  g.skipUnruled = true;
  startGame(g, rules, "you");
  return g;
}

// ルールが設定されていないカード (ルールのノートが無い・ノードが空)。重複なし、デッキに出てきた順
export function unruledCards(decks: DeckData[], rules: RuleBook): string[] {
  const out: string[] = [];
  for (const d of decks)
    for (const e of d.main) {
      const r = rules.get(e.key);
      if ((!r || r.abilities.every((a) => a.body.length === 0)) && !out.includes(e.key)) out.push(e.key);
    }
  return out;
}

// 対戦の開始のモーダルに出す、デッキの情報。legal = フォーマットごとの判定 (ok / ng / unknown)
export interface DeckChoice {
  name: string;
  format: string; // デッキのノートの format: (無ければ空)
  commander: boolean;
  legal: Record<string, "ok" | "ng" | "unknown">;
}

// 相手のデッキの候補: 自分と、デッキに設定したフォーマット (frontmatter の format:) が同じもの。統率戦は除く (自分のデッキ自身も候補)。
// フォーマットが無い (制限なし) デッキは、制限なしどうし。自分が決まっていなければ、統率戦以外の全部。自分が統率戦なら、候補なし
const formatKey = (f: string) => (f && f !== "constructed" ? f : "");
export function opponentChoices(self: DeckChoice | undefined, all: DeckChoice[]): DeckChoice[] {
  if (self?.commander) return [];
  return all.filter((d) => !d.commander && (!self || formatKey(d.format) === formatKey(self.format)));
}

// 「ランダム」で相手を引く。noMirror (ミラーは選ばない) なら、自分と同じデッキを除く。ほかに候補が無いときだけ、ミラーを引く (始められなくならないように)。引けなければ空
export function pickRandomOpponent(candidates: DeckChoice[], mine: string, noMirror: boolean, rnd: () => number = Math.random): string {
  const others = candidates.filter((d) => d.name !== mine);
  const pool = noMirror && others.length ? others : candidates;
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))].name : "";
}

// 画面に渡す、対戦の局面とルール
export interface BattleSession {
  game: Game;
  rules: RuleBook;
  // 履歴の保存・リプレイ用 (サンプルの局面には無い)
  seed?: number;
  coin?: boolean; // コイントスで先攻 / 後攻を決める対戦 (リプレイでも、同じ決まり方にするため、記録に残す)
  rng?: () => number;
  self?: string;
  opp?: string;
  oppMemo?: string; // 相手のデッキの、持ち主のメモ
  aiMulligan?: { count: number; bottom: string[] }; // AI の相手のマリガンの結果 (リプレイで、同じ手札を作り直す)
  shared?: string; // 共通ルール (Rules/_agent.md の、共通 + 対戦)。AI への指示に足す
  pendingAi?: Promise<void>; // AI の相手が、マリガンを決めている最中 (終わるまで、自分のマリガンは聞かない。盤面は、先に開く。終わると、aiMulligan が入る)
  // リプレイ: 記録と、同じ初期状態を作り直す関数 (戻る・ジャンプのたびに、作り直して、記録を呼び直す)
  replay?: import("./saved").SavedBattle;
  rebuild?: () => BattleSession;
}
