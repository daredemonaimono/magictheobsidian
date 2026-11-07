// デッキ md: "## Main" / "## Side" 見出しの下に `4 [[カード名]] (set 番号)` を1行ずつ並べる。
// カード名は Cards/ のファイル名 (= グラフビューのリンク先)。(set 番号) はイラスト指定で省略可。

// print = "m11 149" (Printings 表の set と no)
export const DECK_DIR = "Decks";

// 同じカードで、版 (絵柄) やフォイルが違うものは、行を分ける。n は合計枚数 (ルールの判定は、これまでどおり n を見る)。
// 先頭の (print, foil) が alts を除いた残りの枚数 (1 枚以上)。alts = 絵違い・フォイルの別の行
export interface Variant {
  n: number;
  print?: string;
  foil?: boolean;
}
export interface Entry {
  n: number;
  print?: string;
  foil?: boolean;
  alts?: Variant[];
}

const same = (a: Variant, b: Variant) => (a.print ?? "") === (b.print ?? "") && !!a.foil === !!b.foil;

// 行ごとの一覧 (先頭が、alts を除いた残り)
export const variantsOf = (e: Entry): Variant[] => [{ n: e.n - (e.alts ?? []).reduce((a, v) => a + v.n, 0), print: e.print, foil: e.foil }, ...(e.alts ?? [])];

// 行の一覧から Entry を作る。同じ (print, foil) は 1 行にまとめ、0 枚の行は消す。先頭の行が主になる。空なら undefined
export function fromVariants(vs: Variant[]): Entry | undefined {
  const merged: Variant[] = [];
  for (const v of vs) {
    if (v.n <= 0) continue;
    const at = merged.find((m) => same(m, v));
    if (at) at.n += v.n;
    else merged.push({ ...v });
  }
  if (!merged.length) return undefined;
  const [main, ...alts] = merged;
  return { n: merged.reduce((a, v) => a + v.n, 0), ...(main.print ? { print: main.print } : {}), ...(main.foil ? { foil: true } : {}), ...(alts.length ? { alts: alts.map((v) => ({ n: v.n, ...(v.print ? { print: v.print } : {}), ...(v.foil ? { foil: true } : {}) })) } : {}) };
}

// i 番目の行の 1 枚 (all なら全部) の版・フォイルを変える。同じ版・フォイルの行があれば、そこに合流する
export function changeVariant(e: Entry, i: number, patch: { print?: string | undefined; foil?: boolean }, all = false): Entry {
  const vs = variantsOf(e).map((v) => ({ ...v }));
  const v = vs[i];
  if (!v) return e;
  const count = all ? v.n : 1;
  v.n -= count;
  vs.push({ n: count, print: "print" in patch ? patch.print : v.print, foil: "foil" in patch ? patch.foil : v.foil });
  return fromVariants(vs) ?? e;
}

// 1 枚取り出す (既定は最後の行から)。残りの Entry (空なら undefined) と、取り出した 1 枚
export function takeOne(e: Entry, i?: number): { rest: Entry | undefined; taken: Variant } {
  const vs = variantsOf(e).map((v) => ({ ...v }));
  const at = i ?? vs.length - 1;
  const v = vs[at];
  v.n--;
  return { rest: fromVariants(vs), taken: { n: 1, print: v.print, foil: v.foil } };
}

// 行を足す (同じ版・フォイルがあれば合流)
export const addVariant = (e: Entry | undefined, v: Variant): Entry => fromVariants([...(e ? variantsOf(e) : []), v])!;

export interface Deck {
  main: Map<string, Entry>;
  side: Map<string, Entry>;
  commander: Map<string, Entry>; // 統率戦のコマンダー。他のフォーマットでは空
  token: Map<string, Entry>; // トークン。メイン/サイドの枚数やフォーマットのルールには数えない別枠
}

export type Board = keyof Deck;

const HEADING: Record<Board, string> = { main: "## Main", side: "## Side", commander: "## Commander", token: "## Token" };

export const emptyDeck = (): Deck => ({ main: new Map(), side: new Map(), commander: new Map(), token: new Map() });
const LINE = /^(\d+)\s+\[\[([^\]|]+)[^\]]*\]\](?:\s*\(([^)]+)\))?(\s*\*F\*)?/;

// 行ごとの一覧を、カードごとの Entry にまとめる (同じカードの行は、先に出たものが主)
const collect = (rows: Map<string, Variant[]>): Map<string, Entry> => new Map([...rows].flatMap(([k, vs]) => { const e = fromVariants(vs); return e ? [[k, e] as const] : []; }));

export function parseDeck(content: string): Deck {
  const rows = { main: new Map<string, Variant[]>(), side: new Map<string, Variant[]>(), commander: new Map<string, Variant[]>(), token: new Map<string, Variant[]>() };
  let cur: Board | null = null;
  for (const line of content.split("\n")) {
    if (line.startsWith("## ")) cur = (Object.keys(HEADING) as Board[]).find((b) => HEADING[b] === line) ?? null;
    const m = cur && line.match(LINE);
    if (cur && m) rows[cur].set(m[2], [...(rows[cur].get(m[2]) ?? []), { n: Number(m[1]), print: m[3]?.trim(), foil: !!m[4] }]);
  }
  return { main: collect(rows.main), side: collect(rows.side), commander: collect(rows.commander), token: collect(rows.token) };
}

// 見出し以外 (メモなど) は触らず、カード行だけ差し替える
export function writeDeck(content: string, deck: Deck): string {
  const lines = content.split("\n");
  for (const board of ["commander", "main", "side", "token"] as Board[]) {
    const body = [...deck[board]].flatMap(([k, e]) => variantsOf(e).map((v) => `${v.n} [[${k}]]${v.print ? ` (${v.print})` : ""}${v.foil ? " *F*" : ""}`));
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
const MOX_LINE = /^(\d+)x?\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\S+)(\s+\*[A-Za-z]\*)?/; // 末尾の *F* = フォイル
// セットの無い行: `4 Lightning Bolt` (版は指定なし)
const PLAIN_LINE = /^(\d+)x?\s+(.+)$/;

export function parseMoxfield(text: string): Deck {
  const deck = emptyDeck();
  let cur: Board | null = "main";
  let headed = false; // DECK: などの見出しがあるデッキ (見出しの無いデッキだけ、空行がサイドの区切りになる)
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line && cur === "commander") cur = "main"; // COMMANDER: 欄は空行まで
    else if (!line && cur === "main" && !headed && deck.main.size) cur = "side"; // 見出しの無い形式: メインのあとの空行 (何行でも) から、サイド
    else if (/^sideboard:?$/i.test(line)) (cur = "side"), (headed = true);
    else if (/^(maybeboard|considering|tokens?)\b/i.test(line)) cur = null;
    else if (/^commander:?$/i.test(line)) cur = "commander";
    else if (/^(deck|mainboard|companion):?$/i.test(line)) (cur = "main"), (headed = true);
    const m = cur && line.match(MOX_LINE);
    const plain = cur && !m ? line.match(PLAIN_LINE) : null;
    if (!cur || (!m && !plain)) continue;
    const [n, name, print] = m ? [m[1], m[2], `${m[3].toLowerCase()} ${m[4]}`] : [plain![1], plain![2].trim(), undefined];
    deck[cur].set(name, addVariant(deck[cur].get(name), { n: Number(n), print, foil: !!m?.[5] })); // 版・フォイルが違う行は、別の行として持つ
  }
  return deck;
}

// コマンダー欄が無いフォーマットのデッキに取り込むときは、コマンダーをメインに入れる
export function foldCommander(deck: Deck): Deck {
  for (const [k, e] of deck.commander) deck.main.set(k, variantsOf(e).reduce<Entry | undefined>((acc, v) => addVariant(acc, v), deck.main.get(k))!);
  deck.commander.clear();
  return deck;
}

// デッキのサムネイル (カバー写真) にするカード。frontmatter の thumbnail (デッキに入っているカード名) があればそれ、無ければ (入っていなくても) メインの先頭 (統率戦はコマンダーが先頭)。
// デッキ一覧とデッキ画面のヘッダーが、同じ決め方を使う
export function thumbnailKey(thumb: unknown, deck: Deck): string | undefined {
  const keys = [...deck.commander.keys(), ...deck.main.keys()];
  const all = [...keys, ...deck.side.keys()];
  return typeof thumb === "string" && all.includes(thumb) ? thumb : keys[0];
}
