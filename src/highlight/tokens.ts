// コードブロック (```mtg-node) の色分け。ルール (正規表現と、色の名前) を 1 か所に置き、
// 閲覧表示 (Prism) と、編集表示 (CodeMirror) の、両方が、同じルールを使う。色は、styles.css の .mtg-tok-* / .token.mtg-*。
// 規則の前半 (グループ 1) は、「先読み」として扱う (色を付けない。Prism の lookbehind と同じ)。
export interface Rule {
  cls: string; // mtg-key など。styles.css で、色を決める
  re: RegExp; // グローバルではない (使う側で、g を付ける)
}
const KEYS = "name|source|kind|timing|loyalty|cost|condition|target|keyword|steps|名前|原文の行|種類|タイミング|忠誠度|コスト|条件|対象|キーワード|手順";

// 先に書いたものが、優先 (同じ場所は、先に取ったものが勝つ)
export const RULES: Rule[] = [
  { cls: "mtg-text", re: new RegExp(`(^[ \\t]*(?:name|source|名前|原文の行):[ \\t]*).+`) }, // 名前・原文の行: 長い文章は、控えめに
  { cls: "mtg-key", re: new RegExp(`(^[ \\t]*)(?:${KEYS})(?=:)`) }, // kind: timing: cost: steps: …
  { cls: "mtg-value", re: new RegExp(`(^[ \\t]*(?:kind|timing|target|keyword|種類|タイミング|対象|キーワード):[ \\t]*)[^(\\s]+[ \\t]*$`) }, // 種類・タイミング・対象・キーワードの id
  { cls: "mtg-fn", re: /\b[a-z][A-Za-z0-9]*(?=\()/ }, // 関数 (動作・条件・各〜)
  { cls: "mtg-param", re: /[A-Za-z][\w-]*(?==)/ }, // 引数の名前
  { cls: "mtg-mana", re: /\{[0-9A-Z]+(?:\/[0-9A-Z]+)*\}/ }, // マナ・シンボル
  { cls: "mtg-link", re: /\[\[[^\]]+\]\]/ },
  { cls: "mtg-value", re: /(=)[^,)\s]+/ }, // 引数の値 (id・数)
  { cls: "mtg-num", re: /(?<![\w-])[+-]?\d+(?![\w-])/ }, // 忠誠度のコスト (+1・0・-2)
];

export interface Token {
  from: number;
  to: number;
  cls: string;
}

// 1 行の色分け (編集表示用)。重ならない範囲を返す
export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  const free = (a: number, b: number) => !out.some((t) => a < t.to && t.from < b);
  for (const r of RULES) {
    for (const m of line.matchAll(new RegExp(r.re.source, "g"))) {
      const from = m.index! + (m[1]?.length ?? 0);
      const to = m.index! + m[0].length;
      if (to > from && free(from, to)) out.push({ from, to, cls: r.cls });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

// 閲覧表示 (Prism) の文法。各ルールを、Prism のトークンにする (alias で、色の名前を付ける)
export function prismGrammar(): Record<string, { pattern: RegExp; lookbehind?: boolean; alias: string }> {
  const g: Record<string, { pattern: RegExp; lookbehind?: boolean; alias: string }> = {};
  RULES.forEach((r, i) => (g[`mtg${i}`] = { pattern: new RegExp(r.re.source, r.re.source.includes("(^") || r.re.source.startsWith("(") ? "m" : ""), lookbehind: /^\((?!\?)/.test(r.re.source), alias: r.cls }));
  return g;
}

// ブロックの開始・終了の行 (古い node は、色分けしない: JavaScript のまま)
export const FENCE_OPEN = /^```mtg-node\b/;
export const FENCE_CLOSE = /^```\s*$/;
