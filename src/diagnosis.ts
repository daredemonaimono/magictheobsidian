import { App, TFile, moment, normalizePath } from "obsidian";
import { cardInfo, oracleEnglish } from "./cards";
import { RULE_DIR, VOCAB_VERSION, isStale, loadRule, needsRule } from "./cardrules";
import { DiagCard, renderDiagnosis, smokeTest } from "./diagnose";
import { makeDef } from "./engine";

export const DIAG_DIR = "Bot/Diagnostics";

// デッキのカードを診断して、ノート (Bot/Diagnostics/<デッキ名>.md) に書く。動作テストは API を使わない
export async function runDiagnosis(app: App, deckName: string, keys: string[]): Promise<TFile> {
  const cards: DiagCard[] = [];
  for (const key of keys) {
    const info = cardInfo(app, key);
    if (!info) continue;
    const oracle = await oracleEnglish(app, key);
    const rule = await loadRule(app, key);
    const file = app.vault.getAbstractFileByPath(normalizePath(`${RULE_DIR}/${key}.md`));
    const fm = file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    const num = (v?: string) => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : undefined);
    const def = makeDef({ key, name: info.name, typeLine: info.typeLine, manaCost: info.manaCost, cmc: info.cmc, power: num(info.power) ?? 0, toughness: num(info.toughness) ?? 1, oracle, abilities: rule?.abilities, keywords: info.keywords });
    cards.push({
      key,
      name: info.name,
      typeLine: info.typeLine,
      manaCost: info.manaCost,
      oracle,
      power: info.power,
      toughness: info.toughness,
      keywords: info.keywords ? def.keywords : undefined,
      abilities: rule ? def.abilities : undefined,
      unsupported: rule?.unsupported ?? [],
      status: fm?.status,
      vocab: typeof fm?.vocab === "number" ? fm.vocab : undefined,
      stale: isStale(app, key),
      needsRule: needsRule(info.typeLine, oracle),
      smoke: rule || !needsRule(info.typeLine, oracle) ? await smokeTest(def) : undefined,
    });
  }
  const dir = normalizePath(DIAG_DIR);
  for (const d of ["Bot", dir]) if (!app.vault.getAbstractFileByPath(d)) await app.vault.createFolder(d);
  const path = normalizePath(`${dir}/${deckName}.md`);
  const body = renderDiagnosis(deckName, cards, moment().format("YYYY-MM-DD HH:mm"));
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, body);
    return existing;
  }
  return app.vault.create(path, body);
}

export { VOCAB_VERSION };
