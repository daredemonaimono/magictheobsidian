import { App, TFile } from "obsidian";
import { Entry } from "./deck";

// 所持カードはセットごとのノート: Collection/M11.md
// 行は `3 [[Lightning Bolt]] (149)` (セットはファイル名、括弧内はコレクター番号)。
// 画面内のキーは `カード名|set 番号`。

export const COLLECTION_DIR = "Collection";
const LINE = /^(\d+)\s+\[\[([^\]|]+)[^\]]*\]\]\s*\(([^)]+)\)/;
const HEADING = "## Cards";

const inDir = (app: App) => app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${COLLECTION_DIR}/`));

export async function loadCollection(app: App): Promise<Map<string, Entry>> {
  const out = new Map<string, Entry>();
  for (const f of inDir(app)) {
    const set = f.basename.toLowerCase();
    for (const line of (await app.vault.cachedRead(f)).split("\n")) {
      const m = line.match(LINE);
      if (!m) continue;
      const print = `${set} ${m[3].trim()}`;
      const key = `${m[2]}|${print}`;
      out.set(key, { n: (out.get(key)?.n ?? 0) + Number(m[1]), print });
    }
  }
  return out;
}

// 枚数が0になって空いたセットも書き換えるため、読み込み時に在ったセットを渡す
export async function saveCollection(app: App, entries: Map<string, Entry>, knownSets: Set<string>) {
  const bySet = new Map<string, string[]>([...knownSets].map((s) => [s, []]));
  for (const [key, e] of entries) {
    const [set, no] = (e.print ?? "").split(" ");
    if (!set) continue;
    if (!bySet.has(set)) bySet.set(set, []);
    bySet.get(set)!.push(`${e.n} [[${key.split("|")[0]}]] (${no})`);
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
