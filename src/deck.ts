// デッキ md: "## Main" / "## Side" 見出しの下に `4 [[カード名]] (set 番号)` を1行ずつ並べる。
// カード名は Cards/ のファイル名 (= グラフビューのリンク先)。(set 番号) はイラスト指定で省略可。

// print = "m11 149" (Printings 表の set と no)
export const DECK_DIR = "Decks";

export interface Entry {
  n: number;
  print?: string;
}

export interface Deck {
  main: Map<string, Entry>;
  side: Map<string, Entry>;
  commander: Map<string, Entry>; // 統率戦のコマンダー。他のフォーマットでは空
  token: Map<string, Entry>; // トークン。メイン/サイドの枚数やフォーマットのルールには数えない別枠
}

export type Board = keyof Deck;

const HEADING: Record<Board, string> = { main: "## Main", side: "## Side", commander: "## Commander", token: "## Token" };

export const emptyDeck = (): Deck => ({ main: new Map(), side: new Map(), commander: new Map(), token: new Map() });
const LINE = /^(\d+)\s+\[\[([^\]|]+)[^\]]*\]\](?:\s*\(([^)]+)\))?/;

export function parseDeck(content: string): Deck {
  const deck = emptyDeck();
  let cur: Board | null = null;
  for (const line of content.split("\n")) {
    if (line.startsWith("## ")) cur = (Object.keys(HEADING) as Board[]).find((b) => HEADING[b] === line) ?? null;
    const m = cur && line.match(LINE);
    if (cur && m) {
      const prev = deck[cur].get(m[2]);
      deck[cur].set(m[2], { n: (prev?.n ?? 0) + Number(m[1]), print: prev?.print ?? m[3]?.trim() });
    }
  }
  return deck;
}

// 見出し以外 (メモなど) は触らず、カード行だけ差し替える
export function writeDeck(content: string, deck: Deck): string {
  const lines = content.split("\n");
  for (const board of ["commander", "main", "side", "token"] as Board[]) {
    const body = [...deck[board]].map(([k, e]) => `${e.n} [[${k}]]${e.print ? ` (${e.print})` : ""}`);
    const start = lines.indexOf(HEADING[board]);
    if (start < 0) {
      if (!body.length) continue; // 見出しが無く中身も空なら作らない (統率戦以外に Commander 欄を作らない等)
      lines.push("", HEADING[board], ...body, "");
      continue;
    }
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith("#")) end++;
    lines.splice(start + 1, end - start - 1, ...body, "");
  }
  return lines.join("\n");
}

// Moxfield / MTGO 形式: `4 Card Name (SET) 123`。"SIDEBOARD:" 以降がサイド。
// MAYBEBOARD などサイド以外の見出しは読み飛ばす。key はカード名 (Cards/ のファイル名とは限らない)
const MOX_LINE = /^(\d+)x?\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\S+)/;

export function parseMoxfield(text: string): Deck {
  const deck = emptyDeck();
  let cur: Board | null = "main";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line && cur === "commander") cur = "main"; // COMMANDER: 欄は空行まで
    else if (/^sideboard:?$/i.test(line)) cur = "side";
    else if (/^(maybeboard|considering|tokens?)\b/i.test(line)) cur = null;
    else if (/^commander:?$/i.test(line)) cur = "commander";
    else if (/^(deck|mainboard|companion):?$/i.test(line)) cur = "main";
    const m = cur && line.match(MOX_LINE);
    if (!cur || !m) continue;
    const prev = deck[cur].get(m[2]);
    deck[cur].set(m[2], { n: (prev?.n ?? 0) + Number(m[1]), print: prev?.print ?? `${m[3].toLowerCase()} ${m[4]}` });
  }
  return deck;
}

// コマンダー欄が無いフォーマットのデッキに取り込むときは、コマンダーをメインに入れる
export function foldCommander(deck: Deck): Deck {
  for (const [k, e] of deck.commander) deck.main.set(k, { n: (deck.main.get(k)?.n ?? 0) + e.n, print: deck.main.get(k)?.print ?? e.print });
  deck.commander.clear();
  return deck;
}
