import { App, normalizePath } from "obsidian";
import { LibAbility, keywordEntries, libMd, parseLibMd, unknownKeyword } from "./abilities";
import { cardInfo } from "./cards";

// 能力ライブラリの保存先: ルールブックの隠しフォルダ (<プラグインのフォルダ>/rulebook/abilities/<id>.md)
let base = "";
let cache: Map<string, LibAbility> | undefined;

export function initAbilityStore(manifestDir: string) {
  base = normalizePath(`${manifestDir}/rulebook/abilities`);
  cache = undefined;
}

async function mk(app: App) {
  for (const p of [normalizePath(`${base}/..`), base]) if (!(await app.vault.adapter.exists(p))) await app.vault.adapter.mkdir(p);
}

export async function getLibrary(app: App): Promise<Map<string, LibAbility>> {
  if (cache) return cache;
  const out = new Map<string, LibAbility>();
  if (await app.vault.adapter.exists(base)) {
    for (const f of (await app.vault.adapter.list(base)).files.filter((x) => x.endsWith(".md"))) {
      const l = parseLibMd(await app.vault.adapter.read(f));
      if (l) out.set(l.id, l);
    }
  }
  return (cache = out);
}

export async function saveAbility(app: App, lib: LibAbility) {
  await mk(app);
  await app.vault.adapter.write(normalizePath(`${base}/${lib.id}.md`), libMd(lib));
  (await getLibrary(app)).set(lib.id, lib);
}

export async function deleteAbility(app: App, id: string) {
  const p = normalizePath(`${base}/${id}.md`);
  if (await app.vault.adapter.exists(p)) await app.vault.adapter.remove(p);
  (await getLibrary(app)).delete(id);
}

// エンジンが動かすキーワードを、ライブラリに入れておく (無いものだけ)
export async function seedKeywords(app: App): Promise<number> {
  const lib = await getLibrary(app);
  let n = 0;
  for (const k of keywordEntries()) {
    if (lib.has(k.id)) continue;
    await saveAbility(app, k);
    n++;
  }
  return n;
}

// カードが持つキーワードのうち、エンジンもライブラリも知らないものを、未処理の能力として登録する (AI は使わない)
export async function ensureKeywordEntries(app: App, keys: string[]): Promise<string[]> {
  const lib = await getLibrary(app);
  const made: string[] = [];
  for (const key of keys) {
    for (const k of cardInfo(app, key)?.keywords ?? []) {
      const e = unknownKeyword(k, lib);
      if (!e) continue;
      await saveAbility(app, e);
      made.push(e.title);
    }
  }
  return made;
}
