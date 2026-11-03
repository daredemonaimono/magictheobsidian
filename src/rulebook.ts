import { App } from "obsidian";
import { cardInfo, localCards, oracleEnglish } from "./cards";
import { Rule, loadRule, needsRule } from "./cardrules";
import { loadCollection } from "./collection";
import { DECK_DIR, parseDeck } from "./deck";
import { collectUsage } from "./typecatalog";
import { ruleKeys } from "./rulestore";

// ルールブック画面のデータ集め。「どのカードが、どの型を使っているか」「どのデッキ・コレクションにあるか」を調べる
export interface RbCard {
  key: string;
  name: string;
  typeLine: string;
  oracle: string;
  decks: string[]; // 入っているデッキ
  inCollection: boolean;
  rule?: Rule;
  needs: boolean; // 記録が要るカードか
}

export interface Rulebook {
  cards: RbCard[];
  usage: Map<string, Set<string>>; // 型の id → カードの key
  unsupported: Map<string, Set<string>>; // 未対応の文 → カードの key
}

export async function collectRulebook(app: App): Promise<Rulebook> {
  const decksOf = new Map<string, string[]>();
  for (const f of app.vault.getFiles().filter((x) => x.path.startsWith(`${DECK_DIR}/`) && x.extension === "md")) {
    const d = parseDeck(await app.vault.cachedRead(f));
    for (const m of [d.main, d.side, d.commander, d.token]) for (const k of m.keys()) if (!(decksOf.get(k) ?? decksOf.set(k, []).get(k)!).includes(f.basename)) decksOf.get(k)!.push(f.basename);
  }
  const coll = new Set([...(await loadCollection(app)).values()].map((r) => r.card));
  const keys = new Set<string>([...decksOf.keys(), ...coll, ...(await ruleKeys(app))]);
  const cards: RbCard[] = [];
  const usage = new Map<string, Set<string>>();
  const unsupported = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, id: string, key: string) => (m.get(id) ?? m.set(id, new Set()).get(id)!).add(key);
  for (const key of keys) {
    const info = cardInfo(app, key);
    if (!info) continue;
    const oracle = await oracleEnglish(app, key);
    const rule = await loadRule(app, key);
    cards.push({ key, name: info.name, typeLine: info.typeLine, oracle, decks: decksOf.get(key) ?? [], inCollection: coll.has(key), rule, needs: needsRule(info.typeLine, oracle) });
    if (rule) {
      for (const id of collectUsage(rule.abilities)) add(usage, id, key);
      for (const u of rule.unsupported) add(unsupported, u, key);
    }
    for (const k of info.keywords ?? []) add(usage, `kw.${k.toLowerCase()}`, key);
  }
  for (const w of ["islandwalk", "swampwalk", "mountainwalk", "forestwalk", "plainswalk"]) for (const k of usage.get(`kw.${w}`) ?? []) add(usage, "kw.landwalk", k);
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return { cards, usage, unsupported };
}

// 全カード (Cards/ のノート) から、名前で探す。ルールブックの検索用
export function allCardNames(app: App): { key: string; name: string }[] {
  return localCards(app).map((c) => ({ key: c.file.basename, name: c.name }));
}
