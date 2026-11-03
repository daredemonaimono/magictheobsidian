import { App, normalizePath } from "obsidian";
import { LibAbility, inlineRefs, keywordEntries, libMd, parseLibMd, unknownKeyword, withBuiltin } from "./abilities";
import { readRuleText, ruleKeys, writeRuleText } from "./rulestore";
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
  // 同梱の処理 (Amass など) を、処理待ちの能力に入れる
  for (const l of [...lib.values()]) {
    const next = withBuiltin(l);
    if (!next) continue;
    await saveAbility(app, next);
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

// 共有の能力 (名詞でないもの) を廃止する: 記録の ref をカード固有の能力に展開して、使われなくなった定義を消す。何度やっても、同じ結果
export async function retireLibrary(app: App): Promise<{ cards: number; removed: number }> {
  const lib = await getLibrary(app);
  const used = new Set<string>();
  let cards = 0;
  for (const key of await ruleKeys(app)) {
    const text = await readRuleText(app, key);
    const m = text?.match(/```json\n([\s\S]*?)\n```/);
    if (!text || !m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      const raw: unknown[] = Array.isArray(parsed.abilities) ? parsed.abilities : [];
      const r = inlineRefs(raw, lib);
      for (const x of r.raw) if (typeof (x as { ref?: unknown })?.ref === "string") used.add((x as { ref: string }).ref);
      if (!r.changed) continue;
      await writeRuleText(app, key, text.replace(m[0], () => "```json\n" + JSON.stringify({ ...parsed, abilities: r.raw }, null, 1) + "\n```"), true);
      cards++;
    } catch {
      /* 壊れた記録は、触らない */
    }
  }
  let removed = 0;
  for (const l of [...lib.values()]) {
    if (l.keyword || used.has(l.id)) continue; // 名詞と、まだ使われているものは残す
    await deleteAbility(app, l.id);
    removed++;
  }
  return { cards, removed };
}
