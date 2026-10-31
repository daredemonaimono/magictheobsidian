// マナシンボルは Scryfall の画像 (SVG)。コスト {2}{W/U} → コード 2, WU (スラッシュを除く) がファイル名
export const symbolUrl = (code: string) => `https://svgs.scryfall.io/card-symbols/${code}.svg`;

export const manaCodes = (cost: string) => [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].replace("/", ""));

export function symbolImg(parent: HTMLElement, code: string) {
  return parent.createEl("img", { cls: "mtg-sym", attr: { src: symbolUrl(code), alt: `{${code}}`, loading: "lazy" } });
}

// `{2}{W}{W}` をシンボルの並びにする。コストが無い (土地など) と空
export function manaCost(parent: HTMLElement, cost: string) {
  const span = parent.createSpan("mtg-cost");
  for (const code of manaCodes(cost)) symbolImg(span, code);
  return span;
}
