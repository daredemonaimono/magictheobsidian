import { App } from "obsidian";
import { cardInfo, localCards, oracleEnglish } from "./cards";
import { Rule, loadRule, needsRule } from "./cardrules";
import { loadCollection } from "./collection";
import { DECK_DIR, parseDeck } from "./deck";
import { collectUsage } from "./typecatalog";
import { Macro, macrosUsedIn } from "./effects";
import { getMacros } from "./macros";
import { readRuleText, ruleKeys } from "./rulestore";

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
  macros: Map<string, Macro>; // 登録されているマクロ
  macroUsage: Map<string, Set<string>>; // マクロの名前 → カードの key
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
  const macros = await getMacros(app);
  const macroUsage = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, id: string, key: string) => (m.get(id) ?? m.set(id, new Set()).get(id)!).add(key);
  for (const key of keys) {
    const info = cardInfo(app, key);
    if (!info) continue;
    const oracle = await oracleEnglish(app, key);
    const rule = await loadRule(app, key);
    cards.push({ key, name: info.name, typeLine: info.typeLine, oracle, decks: decksOf.get(key) ?? [], inCollection: coll.has(key), rule, needs: needsRule(info.typeLine, oracle) });
    if (rule) {
      const m = (await readRuleText(app, key))?.match(/```json\n([\s\S]*?)\n```/)?.[1];
      if (m) {
        try {
          for (const name of macrosUsedIn(JSON.parse(m).abilities)) add(macroUsage, name, key);
        } catch {
          /* 壊れた記録は、マクロの数えから外す */
        }
      }
      for (const id of collectUsage(rule.abilities)) add(usage, id, key);
      for (const u of rule.unsupported) add(unsupported, u, key);
    }
    for (const k of info.keywords ?? []) add(usage, `kw.${k.toLowerCase()}`, key);
  }
  for (const w of ["islandwalk", "swampwalk", "mountainwalk", "forestwalk", "plainswalk"]) for (const k of usage.get(`kw.${w}`) ?? []) add(usage, "kw.landwalk", k);
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return { cards, usage, unsupported, macros, macroUsage };
}

// 全カード (Cards/ のノート) から、名前で探す。ルールブックの検索用
export function allCardNames(app: App): { key: string; name: string }[] {
  return localCards(app).map((c) => ({ key: c.file.basename, name: c.name }));
}

// デッキ・コレクション・記録に無いカードも、名前で探して、ルールブックの行にする (Cards/ のノートから。20枚まで)
export async function findCards(app: App, query: string, exclude: Set<string>): Promise<RbCard[]> {
  const out: RbCard[] = [];
  for (const c of localCards(app)) {
    if (exclude.has(c.file.basename) || !(c.name.toLowerCase().includes(query) || (c.nameLocal ?? "").toLowerCase().includes(query))) continue;
    const oracle = await oracleEnglish(app, c.file.basename);
    out.push({ key: c.file.basename, name: c.name, typeLine: c.typeLine, oracle, decks: [], inCollection: false, rule: await loadRule(app, c.file.basename), needs: needsRule(c.typeLine, oracle) });
    if (out.length >= 20) break;
  }
  return out;
}
