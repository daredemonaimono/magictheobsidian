import { Board, Deck } from "./deck";

// 枚数制限などはフォーマットごとのルール。デッキのノートの frontmatter `format:` で選ぶ (無ければ constructed)。
// 統率戦など他のフォーマットは、ここに FormatRules を足していく

export interface AddCheck {
  deck: Deck;
  board: Board;
  key: string; // Cards/ のファイル名
  typeLine: string;
  text: string; // 英語のオラクルテキスト
}

export interface FormatRules {
  name: string;
  // 1枚足してよければ null、だめなら理由
  canAdd(c: AddCheck): string | null;
}

const NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// 基本土地は無制限。「何枚でも」「N枚まで」と書かれたカードはその通り
export function copyLimit(typeLine: string, text: string): number {
  if (/\bBasic\b/.test(typeLine) && /\bLand\b/.test(typeLine)) return Infinity;
  if (/A deck can have any number of cards named/i.test(text)) return Infinity;
  const up = text.match(/A deck can have up to (\w+) cards named/i);
  return (up && NUMBERS[up[1].toLowerCase()]) || 4;
}

const sum = (m: Map<string, { n: number }>) => [...m.values()].reduce((a, e) => a + e.n, 0);

export const FORMATS: Record<string, FormatRules> = {
  // 構築戦: 同名カードはメインとサイドの合計で4枚まで、サイドは15枚まで (メインの下限60枚は組みかけを許すので見ない)
  constructed: {
    name: "構築戦",
    canAdd({ deck, board, key, typeLine, text }) {
      if (board === "side" && sum(deck.side) >= 15) return "サイドボードは15枚まで";
      const limit = copyLimit(typeLine, text);
      const have = (deck.main.get(key)?.n ?? 0) + (deck.side.get(key)?.n ?? 0);
      return have >= limit ? `${key} は${limit}枚まで (メインとサイドの合計)` : null;
    },
  },
};

export const formatOf = (id?: string): FormatRules => FORMATS[id ?? ""] ?? FORMATS.constructed;

// ---- カードのリーガル判定 (デッキ内の全カードが使えるフォーマットを ○ / × で出す) ----

// [Scryfall の id, 表示名]
export const LEGAL_FORMATS = [
  ["standard", "Standard"],
  ["pioneer", "Pioneer"],
  ["modern", "Modern"],
  ["legacy", "Legacy"],
  ["vintage", "Vintage"],
  ["pauper", "Pauper"],
  ["commander", "Commander"],
] as const;

export type Verdict = "ok" | "ng" | "unknown";

// legal 未取得 (undefined) のカードは判定できない。1枚でも使えないと分かっていれば ng
export function judge(cards: { key: string; legal?: string[] }[], format: string) {
  const bad = cards.filter((c) => c.legal && !c.legal.includes(format)).map((c) => c.key);
  const unknown = cards.filter((c) => !c.legal).map((c) => c.key);
  const verdict: Verdict = bad.length ? "ng" : unknown.length || !cards.length ? "unknown" : "ok";
  return { verdict, bad, unknown };
}
