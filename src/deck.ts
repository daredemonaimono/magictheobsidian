// デッキ md: "## Main" / "## Side" 見出しの下に `4 [[カード名]] (set 番号)` を1行ずつ並べる。
// カード名は Cards/ のファイル名 (= グラフビューのリンク先)。(set 番号) はイラスト指定で省略可。

// print = "m11 149" (Printings 表の set と no)
export interface Entry {
  n: number;
  print?: string;
}

export interface Deck {
  main: Map<string, Entry>;
  side: Map<string, Entry>;
}

export type Board = keyof Deck;

const HEADING: Record<Board, string> = { main: "## Main", side: "## Side" };
const LINE = /^(\d+)\s+\[\[([^\]|]+)[^\]]*\]\](?:\s*\(([^)]+)\))?/;

export function parseDeck(content: string): Deck {
  const deck: Deck = { main: new Map(), side: new Map() };
  let cur: Board | null = null;
  for (const line of content.split("\n")) {
    if (line.startsWith("## ")) cur = line === HEADING.main ? "main" : line === HEADING.side ? "side" : null;
    const m = cur && line.match(LINE);
    if (cur && m) {
      const prev = deck[cur].get(m[2]);
      deck[cur].set(m[2], { n: (prev?.n ?? 0) + Number(m[1]), print: prev?.print ?? m[3]?.trim() });
    }
  }
  return deck;
}

// 見出し以外 (動き方メモなど) は触らず、カード行だけ差し替える
export function writeDeck(content: string, deck: Deck): string {
  const lines = content.split("\n");
  for (const board of ["main", "side"] as Board[]) {
    const body = [...deck[board]].map(([k, e]) => `${e.n} [[${k}]]${e.print ? ` (${e.print})` : ""}`);
    const start = lines.indexOf(HEADING[board]);
    if (start < 0) {
      lines.push("", HEADING[board], ...body, "");
      continue;
    }
    let end = start + 1;
    while (end < lines.length && !lines[end].startsWith("#")) end++;
    lines.splice(start + 1, end - start - 1, ...body, "");
  }
  return lines.join("\n");
}
