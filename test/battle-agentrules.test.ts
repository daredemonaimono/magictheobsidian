import assert from "node:assert";
import { AGENT_NOTE, DEFAULT_AGENT_NOTE, parseAgentRules, sharedFor, withShared } from "../src/battle/agentRules";
import { AI_SYSTEM, withMemo } from "../src/battle/ai";
import { buildPrompt, selectSystem } from "../src/battle/prompt";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";

resetRegistry();
registerBuiltinNodes();

// 共通ルールのノート (Rules/_agent.md): 見出しで、場面ごとに分ける。AI には、「共通 + その場面の節」だけが渡る (見出しの前の説明は、渡らない)
assert.equal(AGENT_NOTE, "_agent.md");
const md = `---
mtg: agent
---

# 説明 (AI には渡らない)

## 共通
- 日本語で答える。

## ノード作成
- 目印ノード作成XYZ。

## 対戦
- ライフが 5 以下なら、ライフを払わない。

## メモの下書き
- 短い箇条書きで。

## 知らない見出し
- 無視される。
`;
const a = parseAgentRules(md);
assert.equal(a.common, "- 日本語で答える。");
assert.equal(a.nodes, "- 目印ノード作成XYZ。");
assert.equal(a.battle, "- ライフが 5 以下なら、ライフを払わない。");
assert.equal(a.memo, "- 短い箇条書きで。");
assert.ok(!JSON.stringify(a).includes("AI には渡らない") && !JSON.stringify(a).includes("無視される"));
// 英語の見出しも、読む
const en = parseAgentRules("## common\nA\n\n## nodes\nB\n\n## battle\nC\n\n## memo\nD\n");
assert.deepEqual([en.common, en.nodes, en.battle, en.memo], ["A", "B", "C", "D"]);
// 場面ごと: 共通 + その場面
assert.equal(sharedFor(a, "nodes"), "- 日本語で答える。\n\n- 目印ノード作成XYZ。");
assert.equal(sharedFor(a, "battle"), "- 日本語で答える。\n\n- ライフが 5 以下なら、ライフを払わない。");
assert.equal(sharedFor(undefined, "nodes"), "");
assert.equal(sharedFor(parseAgentRules(""), "battle"), "");
assert.equal(withShared("BASE", ""), "BASE");
assert.ok(withShared("BASE", "X").startsWith("BASE") && withShared("BASE", "X").includes("X"));

// ルールを書かせる指示 (buildPrompt)・ノードを選ぶ指示 (selectSystem)・対戦の AI (withMemo) に入る。メモは、そのあと
const shared = sharedFor(a, "nodes");
assert.ok(buildPrompt("X", "Draw a card.", undefined, undefined, undefined, shared).system.includes("目印ノード作成XYZ"));
assert.ok(!buildPrompt("X", "Draw a card.").system.includes("目印ノード作成XYZ"), "共通ルールが無ければ、入らない");
assert.ok(selectSystem(shared).includes("目印ノード作成XYZ"));
const battle = withMemo(AI_SYSTEM, "メモ: 序盤は土地を優先", undefined, sharedFor(a, "battle"));
assert.ok(battle.includes("ライフを払わない") && battle.includes("序盤は土地を優先"));
assert.ok(battle.indexOf("ライフを払わない") < battle.indexOf("序盤は土地を優先"), "共通のあとに、デッキのメモ (具体的なほうが、あと)");
assert.ok(withMemo(AI_SYSTEM, "", undefined, "共通だけ").includes("共通だけ"), "メモが無くても、共通は入る");
assert.equal(withMemo(AI_SYSTEM), AI_SYSTEM, "どちらも無ければ、そのまま");

// 初期のノート (コマンドで作る): 読める。見出しが全部ある
const d = parseAgentRules(DEFAULT_AGENT_NOTE);
assert.ok(d.common && d.nodes && d.battle && d.memo, "初期のノートは、全部の節がある");
assert.ok(/または/.test(d.nodes) && /castFrom/.test(d.nodes), "「または」の誘発の書き方 (Prized Amalgam) が、例として入っている");

// 「A または B」の書き方は、組み込みの指示にもある (用語集を自分で書いた人にも、届くように)
assert.ok(/または/.test(buildPrompt("X", "t").system) && /誘発型能力を.*2/.test(buildPrompt("X", "t").system));
console.log("battle-agentrules ok");
