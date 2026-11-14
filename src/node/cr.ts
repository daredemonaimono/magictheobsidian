// 総合ルール (CR) の番号の並べ方。定義 (種類・タイミング・動作・条件・対象・キーワード・カードタイプ) は、作った順ではなく、
// CR の番号順に並べる (画面の一覧も、この順)。"701.6" は "701.13" より前。"613.1f" は "613.4c" より前。番号が無いものは、最後。
const parts = (cr: string): (number | string)[] =>
  (/^(\d+(?:\.\d+)*)([a-z]*)$/.exec(cr.trim()) ? cr.trim().match(/\d+|[a-z]+/g)! : []).map((x) => (/^\d+$/.test(x) ? Number(x) : x));

export function cmpCr(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  if (!x.length || !y.length) return x.length ? -1 : y.length ? 1 : 0; // 番号が無いものは、最後
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    // 数どうし・文字どうしで比べる (文字 = 項の枝: 1a)。数と文字が並んだら、数 (深い階層) の前に、文字
    if (typeof x[i] === typeof y[i]) return x[i] < y[i] ? -1 : 1;
    return typeof x[i] === "string" ? -1 : 1;
  }
  return x.length - y.length; // 短いほうが先 (702 は 702.1 より前)
}

export const byCr = (a: { cr: string }, b: { cr: string }): number => cmpCr(a.cr, b.cr);
