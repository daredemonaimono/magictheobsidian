import { App, TFile } from "obsidian";

// 所持カードはセットごとのノート: Collection/M11.md
// 行は `3 [[Lightning Bolt]] (149) LP foil`。セットはファイル名、括弧内はコレクター番号。
// 状態 (NM/LP/MP/HP/DMG) と foil は省略可 (省略 = NM の通常版)。

export const COLLECTION_DIR = "Collection";
export const CONDS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Cond = (typeof CONDS)[number];

export interface Row {
  n: number;
  card: string; // Cards/ のファイル名
  print: string; // "set 番号"
  cond: Cond;
  foil: boolean;
}

export const rowKey = (r: Omit<Row, "n">) => `${r.card}|${r.print}|${r.cond}|${r.foil ? 1 : 0}`;

const LINE = /^(\d+)\s+\[\[([^\]|]+)[^\]]*\]\]\s*\(([^)]+)\)(.*)$/;
const HEADING = "## Cards";

const inDir = (app: App) => app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${COLLECTION_DIR}/`));

export async function loadCollection(app: App): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  for (const f of inDir(app)) {
    const set = f.basename.toLowerCase();
    for (const line of (await app.vault.cachedRead(f)).split("\n")) {
      const m = line.match(LINE);
      if (!m) continue;
      const tags = m[4].toLowerCase().split(/\s+/);
      const row = {
        card: m[2],
        print: `${set} ${m[3].trim()}`,
        cond: CONDS.find((c) => tags.includes(c.toLowerCase())) ?? "NM",
        foil: tags.includes("foil"),
      };
      const key = rowKey(row);
      out.set(key, { ...row, n: (out.get(key)?.n ?? 0) + Number(m[1]) });
    }
  }
  return out;
}

// 枚数が0になって空いたセットも書き換えるため、読み込み時に在ったセットを渡す
export async function saveCollection(app: App, rows: Map<string, Row>, knownSets: Set<string>) {
  const bySet = new Map<string, string[]>([...knownSets].map((s) => [s, []]));
  for (const r of rows.values()) {
    const [set, no] = r.print.split(" ");
    if (!bySet.has(set)) bySet.set(set, []);
    bySet.get(set)!.push(`${r.n} [[${r.card}]] (${no})${r.cond !== "NM" ? ` ${r.cond}` : ""}${r.foil ? " foil" : ""}`);
    knownSets.add(set);
  }
  if (!app.vault.getAbstractFileByPath(COLLECTION_DIR)) await app.vault.createFolder(COLLECTION_DIR);
  for (const [set, lines] of bySet) {
    const path = `${COLLECTION_DIR}/${set.toUpperCase()}.md`;
    const f = app.vault.getAbstractFileByPath(path);
    lines.sort();
    if (f instanceof TFile) {
      await app.vault.process(f, (c) => replaceCards(c, lines));
    } else if (lines.length) {
      await app.vault.create(path, `---\nmtg: collection\nset: ${set}\ntags: [mtg/collection]\n---\n\n${HEADING}\n${lines.join("\n")}\n`);
    }
  }
}

// カード行だけ差し替え、他のメモは残す
function replaceCards(content: string, lines: string[]): string {
  const all = content.split("\n");
  const start = all.indexOf(HEADING);
  if (start < 0) return [...all, "", HEADING, ...lines, ""].join("\n");
  let end = start + 1;
  while (end < all.length && !all[end].startsWith("#")) end++;
  all.splice(start + 1, end - start - 1, ...lines, "");
  return all.join("\n");
}
