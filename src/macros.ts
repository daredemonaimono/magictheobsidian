import { App, normalizePath } from "obsidian";
import { Macro, validateMacro } from "./effects";

// マクロの保存先: ルールブックの隠しフォルダ (<プラグインのフォルダ>/rulebook/macros/<名前>.json)
let base = "";
let cache: Map<string, Macro> | undefined;

export function initMacroStore(manifestDir: string) {
  base = normalizePath(`${manifestDir}/rulebook/macros`);
  cache = undefined;
}

async function mk(app: App) {
  const parent = normalizePath(`${base}/..`);
  for (const p of [parent, base]) if (!(await app.vault.adapter.exists(p))) await app.vault.adapter.mkdir(p);
}

export async function getMacros(app: App): Promise<Map<string, Macro>> {
  if (cache) return cache;
  const out = new Map<string, Macro>();
  if (await app.vault.adapter.exists(base)) {
    for (const f of (await app.vault.adapter.list(base)).files.filter((x) => x.endsWith(".json"))) {
      try {
        const v = validateMacro(JSON.parse(await app.vault.adapter.read(f)));
        if (v.macro) out.set(v.macro.name, v.macro);
      } catch {
        /* 壊れたマクロは、無いものとして扱う */
      }
    }
  }
  return (cache = out);
}

export async function saveMacro(app: App, macro: Macro) {
  await mk(app);
  await app.vault.adapter.write(normalizePath(`${base}/${macro.name}.json`), JSON.stringify(macro, null, 1));
  (await getMacros(app)).set(macro.name, macro);
}

export async function deleteMacro(app: App, name: string) {
  const p = normalizePath(`${base}/${name}.json`);
  if (await app.vault.adapter.exists(p)) await app.vault.adapter.remove(p);
  (await getMacros(app)).delete(name);
}
