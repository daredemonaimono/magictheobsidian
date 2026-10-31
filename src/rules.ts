import { Board, Deck } from "./deck";

// フォーマットごとのルール。デッキのノートの frontmatter `format:` で選ぶ (無ければ constructed = 旧版互換で制限は枚数だけ)。
// 新しいフォーマットは FORMATS に足す

export interface AddCheck {
  deck: Deck;
  board: Board;
  key: string; // Cards/ のファイル名
  typeLine: string;
  text: string; // 英語のオラクルテキスト
  legal?: string[]; // 使えるフォーマット (未取得なら undefined)
  restricted?: string[]; // 制限カードになっているフォーマット (Vintage)
}

export interface FormatRules {
  name: string;
  legalId?: string; // Scryfall の legalities のキー。無ければカードの使用可否は見ない
  boards: Board[]; // デッキ画面のタブ (先頭が最初に開く)
  hasCommander?: boolean; // コマンダー欄がある (タブにはせず、メインの上に並べて出す)
  // 1枚足してよければ null、だめなら理由
  canAdd(c: AddCheck): string | null;
}

const NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// 基本土地は無制限。「何枚でも」「N枚まで」と書かれたカードはその通り。それ以外は standard 枚
export function copyLimit(typeLine: string, text: string, standard = 4): number {
  if (/\bBasic\b/.test(typeLine) && /\bLand\b/.test(typeLine)) return Infinity;
  if (/A deck can have any number of cards named/i.test(text)) return Infinity;
  const up = text.match(/A deck can have up to (\w+) cards named/i);
  return (up && NUMBERS[up[1].toLowerCase()]) || standard;
}

const sum = (m: Map<string, { n: number }>) => [...m.values()].reduce((a, e) => a + e.n, 0);

function notLegal(c: AddCheck, id: string | undefined, name: string): string | null {
  return id && c.legal && !c.legal.includes(id) ? `${c.key} は ${name} では使えない` : null;
}

// 60枚のフォーマット: 同名はメインとサイドの合計で4枚まで (Vintage の制限カードは1枚)、サイドは15枚まで。
// メインの下限60枚は組みかけを許すので追加時は見ない (状態の表示で見る)
function sixty(name: string, legalId?: string): FormatRules {
  return {
    name,
    legalId,
    boards: ["main", "side"],
    canAdd(c) {
      const bad = notLegal(c, legalId, name);
      if (bad) return bad;
      if (c.board === "side" && sum(c.deck.side) >= 15) return "サイドボードは15枚まで";
      const limit = legalId === "vintage" && c.restricted?.includes("vintage") ? 1 : copyLimit(c.typeLine, c.text);
      const have = (c.deck.main.get(c.key)?.n ?? 0) + (c.deck.side.get(c.key)?.n ?? 0);
      return have >= limit ? `${c.key} は${limit}枚まで (メインとサイドの合計)` : null;
    },
  };
}

// 統率戦: 同名は1種のみ (基本土地と例外カードを除く)、コマンダー1体 + 99枚 = 100枚。
// shortcut: 色の同一性 (コマンダーの色の外のカードを入れない) とパートナーは未対応。必要になったら足す
const commander: FormatRules = {
  name: "Commander",
  legalId: "commander",
  boards: ["main"],
  hasCommander: true,
  canAdd(c) {
    const bad = notLegal(c, "commander", "Commander");
    if (bad) return bad;
    if (c.board === "commander") {
      if (sum(c.deck.commander) >= 1) return "コマンダーは1体まで";
      const ok = (/\bLegendary\b/.test(c.typeLine) && /\bCreature\b/.test(c.typeLine)) || /can be your commander/i.test(c.text);
      if (!ok) return `${c.key} はコマンダーにできない (伝説のクリーチャーが必要)`;
    }
    if (sum(c.deck.main) + sum(c.deck.commander) >= 100) return "デッキは100枚まで";
    const have = (c.deck.main.get(c.key)?.n ?? 0) + (c.deck.commander.get(c.key)?.n ?? 0);
    const limit = copyLimit(c.typeLine, c.text, 1);
    return have >= limit ? `${c.key} は${limit}枚まで (統率戦は同名1種)` : null;
  },
};

export const FORMATS: Record<string, FormatRules> = {
  standard: sixty("Standard", "standard"),
  pioneer: sixty("Pioneer", "pioneer"),
  modern: sixty("Modern", "modern"),
  legacy: sixty("Legacy", "legacy"),
  vintage: sixty("Vintage", "vintage"),
  pauper: sixty("Pauper", "pauper"),
  commander,
  // 旧版のデッキ (`format: constructed`) 用。カードの使用可否は見ない
  constructed: sixty("構築戦"),
};

export const formatOf = (id?: string): FormatRules => FORMATS[id ?? ""] ?? FORMATS.constructed;

// 新しいデッキで選べるフォーマット
export const CREATABLE = ["standard", "pioneer", "modern", "legacy", "vintage", "pauper", "commander"];

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
// commanderDeck: コマンダーが入っているデッキは、Commander 以外のフォーマットでは使えない
export function judge(cards: { key: string; legal?: string[] }[], format: string, commanderDeck = false): Verdict {
  if (commanderDeck && format !== "commander") return "ng";
  if (cards.some((c) => c.legal && !c.legal.includes(format))) return "ng";
  return cards.some((c) => !c.legal) || !cards.length ? "unknown" : "ok";
}
