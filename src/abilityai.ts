import { App } from "obsidian";
import { LibAbility, PLACEHOLDER, checkAbility, instantiate, statusOf, validateLib } from "./abilities";
import { deleteAbility, ensureKeywordEntries, getLibrary, saveAbility, seedKeywords } from "./abilitystore";
import { applyProposal, loadRule, proposeUpdate, specFor } from "./cardrules";
import { askClaude } from "./claude";
import { COMPILE_MODEL } from "./cardrules";
import { smokeTest } from "./diagnose";
import { Ability, normalizeAbility } from "./effects";
import { makeDef } from "./engine";
import { getMacros } from "./macros";
import { oracleTokens, similarity } from "./similar";
import { ruleKeys } from "./rulestore";

// 能力ライブラリの AI まわり: 未処理の能力の補完、一括の補完、補完のあとの割り振り直し、既存の記録の移行

const COMPLETE = `
# この作業の出力 (上の「出力」の代わり。JSON だけ)
{"ability": 能力 (引数は "$n" のように書く) , "params": {"n": 1}, "examples": ["英語の原文 (引数の所は {n})"], "needs": [関数の仕様 (needs と同じ形)]}
- 「能力のid / 効果 / 引数 / 照合の例」を読んで、この能力の処理を、既にある関数・マクロで書く。書けるときは ability に書き、needs は省く。
- 書けないときは、ability を省いて、needs に、足りない関数の仕様を書く。
- 引数の名前は、いまの params を使う (増やしてよい)。`;

export interface Completion {
  lib: LibAbility; // 補完した案 (保存はしていない)
  cost: number;
  smoke?: string;
  error?: string;
}

// 未処理の能力の、処理の案を作る (保存はしない)
export async function completeAbility(app: App, apiKey: string, id: string, instruction = ""): Promise<Completion> {
  const lib = await getLibrary(app);
  const cur = lib.get(id);
  if (!cur) throw new Error("能力が見つからない");
  const r = await askClaude(
    apiKey,
    COMPILE_MODEL,
    specFor(await getMacros(app), lib, `${cur.effect} ${cur.examples.join(" ")}`) + COMPLETE,
    `能力のid: ${cur.id}\\n名前: ${cur.title}\\n効果: ${cur.effect}\\n引数: ${JSON.stringify(cur.params)}\\n照合の例:\\n${cur.examples.map((e) => `- ${e}`).join("\\n") || "- なし"}\\n${cur.ability ? `今の処理: ${JSON.stringify(cur.ability)}\\n` : ""}${instruction ? `\\nあなたの指示:\\n${instruction}` : ""}`,
    true,
  );
  const parsed = JSON.parse(r.text.match(/\\{[\\s\\S]*\\}/)?.[0] ?? "");
  const v = validateLib({ ...cur, ability: parsed.ability, params: parsed.params ?? cur.params, examples: [...new Set([...cur.examples, ...(Array.isArray(parsed.examples) ? parsed.examples : [])])], needs: parsed.ability ? undefined : parsed.needs });
  if (!v.lib) return { lib: cur, cost: r.cost, error: v.error };
  const chk = v.lib.ability ? checkAbility(v.lib) : { ok: false, error: "処理が無い (関数が足りない)" };
  return { lib: v.lib, cost: r.cost, error: chk.ok ? undefined : chk.error };
}

// 仮の盤面で動くか (動作テスト)。能力を持つ仮のカードを作って調べる
export async function smokeAbility(l: LibAbility): Promise<string> {
  const ab = l.ability ? normalizeAbility(instantiate(l)) : undefined;
  if (!ab) return "failed";
  const kind = ab.kind;
  const def = makeDef({ key: l.id, name: l.title, typeLine: kind === "spell" || kind === "altCost" || kind === "suspend" ? "Sorcery" : "Artifact", manaCost: "{0}", cmc: 0, oracle: "", abilities: [ab as Ability] });
  return (await smokeTest(def)).status;
}

// 未処理の能力を、原文 (効果の文と照合の例) から、まとめて補完する。既にある関数だけで書けて、動作テストに通ったものだけ、そのまま処理済みにする
export async function completeAll(app: App, apiKey: string, progress?: (done: number, total: number, id: string) => void): Promise<{ done: string[]; left: string[]; cost: number }> {
  const lib = await getLibrary(app);
  const todo = [...lib.values()].filter((l) => statusOf(l) === "todo" && !l.keyword);
  const out = { done: [] as string[], left: [] as string[], cost: 0 };
  let n = 0;
  for (const l of todo) {
    progress?.(++n, todo.length, l.id);
    try {
      const c = await completeAbility(app, apiKey, l.id);
      out.cost += c.cost;
      if (!c.error && (await smokeAbility(c.lib)) !== "failed") {
        await saveAbility(app, c.lib);
        out.done.push(l.id);
      } else if (c.lib.needs?.length) {
        await saveAbility(app, c.lib); // 新しい関数が要る: 実装待ちにする
        out.left.push(l.id);
      } else out.left.push(l.id);
    } catch {
      out.left.push(l.id);
    }
  }
  return out;
}

// 補完のあと: カード固有の未対応が残っているカードのうち、登録済みの能力に似た文があるものだけ、AI に、割り振り直させる (記録は、直す前の版を残して、更新する)
export async function reassignCards(app: App, apiKey: string, progress?: (done: number, total: number, key: string) => void): Promise<{ changed: string[]; cost: number }> {
  const lib = await getLibrary(app);
  const done = [...lib.values()].filter((l) => l.ability && statusOf(l) === "done");
  const out = { changed: [] as string[], cost: 0 };
  const todo: string[] = [];
  for (const key of await ruleKeys(app)) {
    const rule = await loadRule(app, key);
    const lines = (rule?.unsupported ?? []).filter((u) => !u.startsWith(PLACEHOLDER));
    const near = lines.some((line) => done.some((l) => similarity(oracleTokens(line, ""), oracleTokens(`${l.examples.join(" ")} ${l.effect}`, "")) >= 0.2));
    if (near) todo.push(key);
  }
  let n = 0;
  for (const key of todo) {
    progress?.(++n, todo.length, key);
    try {
      const pr = await proposeUpdate(app, apiKey, key, "能力ライブラリが増えた。いまの未対応の部分を、登録済みの能力 (ref) で書き直せるなら、書き直す。ref で書けないものと、既に動いている部分は、いまのまま残す。");
      out.cost += pr.cost;
      if (pr.data.unsupported.length < (pr.before?.unsupported.length ?? 99)) {
        await applyProposal(app, key, pr.data, "", { status: pr.before?.status === "manual" ? "manual" : undefined, backup: true });
        out.changed.push(key);
      }
    } catch {
      /* 失敗したカードは、そのまま */
    }
  }
  return out;
}

// 既存のカードの記録 (ref を使っていないもの) を、能力ライブラリの形に直す。ライブラリは、1枚ごとに育つ
export async function migrateRecords(app: App, apiKey: string, progress?: (done: number, total: number, key: string) => void): Promise<{ migrated: string[]; failed: string[]; cost: number }> {
  await seedKeywords(app);
  const out = { migrated: [] as string[], failed: [] as string[], cost: 0 };
  const keys: string[] = [];
  for (const key of await ruleKeys(app)) {
    const rule = await loadRule(app, key);
    if (rule && !rule.refs?.length) keys.push(key);
  }
  await ensureKeywordEntries(app, keys);
  let n = 0;
  for (const key of keys) {
    progress?.(++n, keys.length, key);
    try {
      const pr = await proposeUpdate(app, apiKey, key, "いまの記録を、能力ライブラリの形に直す。登録済みの能力で書けるものは ref で書く。他のカードにも出そうな能力 (数や色だけが違うもの) は、newAbilities に登録して ref で使う。このカードだけの能力は、いまのまま (カード固有) 残す。動きは、変えない。");
      out.cost += pr.cost;
      await applyProposal(app, key, pr.data, "", { status: pr.before?.status === "manual" ? "manual" : undefined, backup: true });
      out.migrated.push(key);
    } catch {
      out.failed.push(key);
    }
  }
  return out;
}

export { deleteAbility };
