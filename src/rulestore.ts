import { App, TFile, TFolder, normalizePath } from "obsidian";

// ルールブックの保存先: プラグインの専用フォルダ (vault の索引に入らない、隠しフォルダ)。
//   <プラグインのフォルダ>/rulebook/cards/<カード名>.md    カードごとの処理の記録 (ルール md)
//   <プラグインのフォルダ>/rulebook/backup/<カード名>.md   直す前の版 (1つ前の分だけ)
//   <プラグインのフォルダ>/rulebook/memos.json            型ごとの要望・メモ
// vault の API ではなく adapter で読み書きする。内容はメモリに持つので、対戦中に何度読んでも軽い。

let base = "";
const cache = new Map<string, string | null>(); // カード名 → 本文 (無ければ null)
let keysCache: string[] | undefined;

export function initRuleStore(manifestDir: string) {
  base = normalizePath(`${manifestDir}/rulebook`);
  cache.clear();
  keysCache = undefined;
}

const dir = (sub: string) => normalizePath(`${base}/${sub}`);
const file = (key: string, sub = "cards") => normalizePath(`${base}/${sub}/${key}.md`);

async function mkdirs(app: App) {
  for (const p of [base, dir("cards"), dir("backup")]) if (!(await app.vault.adapter.exists(p))) await app.vault.adapter.mkdir(p);
}

export async function readRuleText(app: App, key: string): Promise<string | undefined> {
  if (cache.has(key)) return cache.get(key) ?? undefined;
  const p = file(key);
  const text = (await app.vault.adapter.exists(p)) ? await app.vault.adapter.read(p) : null;
  cache.set(key, text);
  return text ?? undefined;
}

// backup = true のとき、上書き前の本文を backup/ に残す (1つ前の分だけ)
export async function writeRuleText(app: App, key: string, text: string, backup = false) {
  await mkdirs(app);
  const old = await readRuleText(app, key);
  if (backup && old !== undefined) await app.vault.adapter.write(file(key, "backup"), old);
  await app.vault.adapter.write(file(key), text);
  cache.set(key, text);
  keysCache = undefined;
}

export async function removeRule(app: App, key: string) {
  const p = file(key);
  if (await app.vault.adapter.exists(p)) await app.vault.adapter.remove(p);
  cache.set(key, null);
  keysCache = undefined;
}

export async function hasBackup(app: App, key: string) {
  return app.vault.adapter.exists(file(key, "backup"));
}

export async function restoreBackup(app: App, key: string): Promise<boolean> {
  const p = file(key, "backup");
  if (!(await app.vault.adapter.exists(p))) return false;
  await writeRuleText(app, key, await app.vault.adapter.read(p));
  return true;
}

export async function ruleKeys(app: App): Promise<string[]> {
  if (keysCache) return keysCache;
  await mkdirs(app);
  const l = await app.vault.adapter.list(dir("cards"));
  keysCache = l.files.filter((f) => f.endsWith(".md")).map((f) => f.split("/").pop()!.replace(/\.md$/, ""));
  return keysCache;
}

// ---- 型ごとの要望・メモ ----
export interface Memo {
  memo: string;
  request: boolean;
}

export async function readMemos(app: App): Promise<Record<string, Memo>> {
  const p = normalizePath(`${base}/memos.json`);
  if (!(await app.vault.adapter.exists(p))) return {};
  try {
    return JSON.parse(await app.vault.adapter.read(p));
  } catch {
    return {};
  }
}

export async function writeMemos(app: App, memos: Record<string, Memo>) {
  await mkdirs(app);
  await app.vault.adapter.write(normalizePath(`${base}/memos.json`), JSON.stringify(memos, null, 1));
}

// ---- 旧い置き場 (vault の Bot/Rules, Bot/Types) からの移行 ----
// ルールの記録は、隠しフォルダへ写してから、vault のノートを Obsidian のゴミ箱へ送る (戻せる)。
// 型の要望・メモ (自分で書いたもの) は memos.json に写す。Bot/Games と Bot/Diagnostics は、そのまま。
const DEFAULT_MEMO = "(この型について";

export async function migrateToRulebook(app: App): Promise<{ rules: number; memos: number }> {
  let rules = 0;
  let memos = 0;
  const ruleDir = app.vault.getAbstractFileByPath("Bot/Rules");
  if (ruleDir instanceof TFolder) {
    for (const f of [...ruleDir.children]) {
      if (!(f instanceof TFile) || f.extension !== "md") continue;
      if ((await readRuleText(app, f.basename)) === undefined) await writeRuleText(app, f.basename, await app.vault.read(f));
      await app.fileManager.trashFile(f);
      rules++;
    }
    if (ruleDir.children.length === 0) await app.fileManager.trashFile(ruleDir);
  }
  const typeDir = app.vault.getAbstractFileByPath("Bot/Types");
  if (typeDir instanceof TFolder) {
    const saved = await readMemos(app);
    for (const f of app.vault.getFiles().filter((x) => x.path.startsWith("Bot/Types/") && x.extension === "md")) {
      const text = await app.vault.read(f);
      const id = text.match(/^id: (.+)$/m)?.[1];
      const i = text.indexOf("## 要望・メモ(自分で書く)");
      const isReq = f.basename === "Requests" || f.basename === "要望";
      // 要望のノートは、最初に作った見出しと案内文を除いた、自分で書いた部分だけ写す
      const memo = i >= 0 ? text.slice(i + "## 要望・メモ(自分で書く)".length).trim() : isReq ? text.replace(/^---[\s\S]*?---\n/, "").split("\n").filter((l) => !l.startsWith("# ") && !l.includes("[[Index]]") && !l.includes("[[一覧]]") && l.trim() !== "- [ ]").join("\n").trim() : "";
      const request = /^request: true$/m.test(text);
      const key = id ?? (f.basename === "Requests" || f.basename === "要望" ? "_requests" : undefined);
      if (key && ((memo && !memo.startsWith(DEFAULT_MEMO)) || request) && !saved[key]) {
        saved[key] = { memo: memo.startsWith(DEFAULT_MEMO) ? "" : memo, request };
        memos++;
      }
    }
    await writeMemos(app, saved);
    await app.fileManager.trashFile(typeDir);
  }
  return { rules, memos };
}
