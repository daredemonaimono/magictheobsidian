// 色の並び (白青黒赤緑)。色のボタン、デッキ一覧の色の表示、並び替えで共通
export const COLORS = ["W", "U", "B", "R", "G"];

// マナシンボルは、プラグインに埋め込んだ SVG (src/symbolSvgs.ts。scripts/gen-symbols.mjs で作る)。表示で通信しない (オフラインでも出る)。
// コスト {2}{W/U} → コード 2, WU (最初のスラッシュを除く)
import { SYMBOL_SVGS } from "./symbolSvgs";

export const manaCodes = (cost: string) => [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].replace("/", ""));

const uris = new Map<string, string>();
// シンボルの画像 (data URI)。埋め込んでいないシンボルは undefined
export function symbolSrc(code: string): string | undefined {
  const svg = SYMBOL_SVGS[code];
  if (!svg) return undefined;
  let u = uris.get(code);
  if (!u) uris.set(code, (u = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`));
  return u;
}

// シンボルを並べる。埋め込んでいないものは、{コード} の文字で出す (通信しない)
export function symbolImg(parent: HTMLElement, code: string): HTMLElement {
  const src = symbolSrc(code);
  if (!src) return parent.createSpan({ cls: "mtg-sym mtg-sym-text", text: `{${code}}` });
  return parent.createEl("img", { cls: "mtg-sym", attr: { src, alt: `{${code}}` } });
}

// `{2}{W}{W}` をシンボルの並びにする。コストが無い (土地など) と空
export function manaCost(parent: HTMLElement, cost: string) {
  const span = parent.createSpan("mtg-cost");
  for (const code of manaCodes(cost)) symbolImg(span, code);
  return span;
}

// ---- 色の絞り込み (コレクション・カード検索で共通)。W U B R G と、無色 (C)。
// 無色は、色のあるカードとは同時に選べない (無色 = 色が1つも無いカード)。無色を選ぶと色の選択が外れ、色を選ぶと無色が外れる
export const COLORLESS = "C";
export const FILTER_COLORS = [COLORLESS, ...COLORS]; // 無色が先頭

export function toggleColor(sel: Set<string>, c: string): void {
  if (sel.has(c)) return void sel.delete(c);
  if (c === COLORLESS) sel.clear();
  else sel.delete(COLORLESS);
  sel.add(c);
}

// カードの色が、選んだ色の絞り込みに合うか。選んだ色をすべて持つ。無色を選んだときは、色が1つも無い
export function matchesColors(cardColors: readonly string[], sel: ReadonlySet<string>): boolean {
  if (sel.has(COLORLESS)) return cardColors.length === 0;
  return [...sel].every((x) => cardColors.includes(x));
}

// 色のボタンを並べる (無色が先頭、続いて五色)。押すと sel を変えて、onChange を呼ぶ
export function colorFilterButtons(bar: HTMLElement, sel: Set<string>, onChange: () => void): void {
  const buttons = new Map<string, HTMLElement>();
  const paint = () => buttons.forEach((b, c) => b.toggleClass("is-on", sel.has(c)));
  for (const c of FILTER_COLORS) {
    const b = bar.createEl("button", { cls: "mtg-color", attr: { "aria-label": c === COLORLESS ? "無色" : c } });
    symbolImg(b, c);
    buttons.set(c, b);
    b.onclick = () => {
      toggleColor(sel, c);
      paint();
      onChange();
    };
  }
  paint();
}
