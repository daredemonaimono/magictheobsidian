// 2つのルールのノートが、「同じ内容」かを比べる (純粋な関数)。ヒントあり/なしで作らせた結果を、今の Rules と比べる測定に使う。
// 内容 = 見出しごとの、ノードの行の並び。as= の名前と、$名前 は、書き手で変わるので、番号に直して比べる。引数の順番も、そろえる

const norm = (line: string): string => {
  const [node, ...rest] = line.replace(/^-\s+/, "").trim().split(/\s+/);
  const args = rest.filter((a) => !a.startsWith("as=")).sort();
  return [node, ...args].join(" ");
};

// 見出し (## 〜) ごとに、行を集める。未対応の節は、除く
export function bodyOf(md: string): string[] {
  const out: string[] = [];
  let heading = "";
  let skip = false;
  for (const raw of md.split("\n")) {
    if (raw.startsWith("## ")) {
      heading = raw.trim();
      skip = heading === "## 未対応";
      continue;
    }
    if (!skip && raw.startsWith("- ")) out.push(`${heading} | ${norm(raw)}`);
  }
  // $名前 を、出てきた順の番号にする (名前の違いを、無視する)
  const names = new Map<string, string>();
  return out.map((l) => l.replace(/\$[A-Za-z0-9_]+/g, (m) => (names.has(m) ? names.get(m)! : (names.set(m, `$${names.size + 1}`), names.get(m)!)))).sort();
}

export const sameRule = (a: string, b: string): boolean => JSON.stringify(bodyOf(a)) === JSON.stringify(bodyOf(b));
