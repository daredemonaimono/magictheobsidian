import assert from "node:assert";
import { buildRuleTwoStage, unsupportedLines } from "../src/battle/build";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { buildPrompt, catalog, parseSelection, selectPrompt, selectSystem } from "../src/battle/prompt";
import { allNodes, resetRegistry } from "../src/battle/registry";

resetRegistry();
registerBuiltinNodes();

// ---- 中心のノード (core) は、いつも指示に入る。ほかは、選んだものだけ
const core = allNodes().filter((n) => n.core).map((n) => n.id);
assert.ok(["target", "cost", "when", "timing"].every((id) => core.includes(id)), "中心のノード");
const full = buildPrompt("X", "t").system;
const narrow = buildPrompt("X", "t", undefined, undefined, new Set(["draw"])).system;
assert.ok(narrow.length < full.length * 0.75, `選ぶと、指示が、小さくなる (${narrow.length} / ${full.length})。ノードが増えるほど、差は広がる (固定の部分: 書式・用語集・例は、約 1 万字)`);
assert.ok(narrow.includes("- draw (") && narrow.includes("- target (") && !narrow.includes("- lookHand ("), "選んだものと、中心のノードだけ");
assert.ok(narrow.includes("必要なノードが、ここに無いときは"), "絞り込んだ、という注意書き");
assert.ok(!full.includes("必要なノードが、ここに無いときは"));
// 1段目の一覧: 中心のノードを除く全部 (id・名前・説明の最初の部分)
const cat = catalog();
assert.equal(cat.split("\n").length, allNodes().length - core.length);
assert.ok(cat.includes("- search: ライブラリーから探す — ") && !cat.includes("- target:"));
assert.ok(selectSystem().includes(cat.split("\n")[0]) && selectPrompt("Brainstorm", "Draw three cards.", "裁定").includes("裁定"));
// 返事の読み取り: レジストリにある id だけ。読めなければ undefined
const sel = parseSelection('はい {"nodes": ["draw", "nonexistent", "search"], "missing": ["追加ターン", 3]}')!;
assert.deepEqual([...sel.ids].sort(), ["draw", "search"]);
assert.deepEqual(sel.missing, ["追加ターン"]);
assert.equal(parseSelection("JSON なし"), undefined);
assert.equal(parseSelection('{"x": 1}'), undefined);
assert.deepEqual([...parseSelection('{"nodes": []}')!.ids], [], "空の選択は、有効 (中心のノードだけで、書けるカード)");

// ---- 2段階: 検証を通る、最小のルール
const OK = (extra = "") => "```md\n---\nmtg: rule\ncard: \"[[Think]]\"\n---\n\n## 呪文能力\n\n- draw player=you count=1\n" + extra + "```";
const withGap = OK("\n## 未対応\n\n- 追加ターンを得る\n");
const prompts: string[] = [];
const writer = (replies: string[]) => async (system: string) => (prompts.push(system), replies[Math.min(prompts.length - 1, replies.length - 1)]);
const selector = (text: string) => async () => text;

// 1段目が、使えるノードを選ぶ → 絞った指示で書く。「未対応」が無ければ、1回だけ
{
  prompts.length = 0;
  const r = await buildRuleTwoStage({ card: "Think", oracle: "Draw a card.", ask: writer([OK()]), askSelect: selector('{"nodes": ["draw"], "missing": []}') });
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0].length < full.length * 0.75, "絞った指示で書いた");
  assert.deepEqual(r.selected, ["draw"]);
  assert.equal(r.fallback, false);
  assert.ok(r.md.includes("draw player=you"));
}
// 「未対応」が残ったら、全ノードで、やり直す (選び漏れの保険)
{
  prompts.length = 0;
  const r = await buildRuleTwoStage({ card: "Think", oracle: "Draw a card. Take an extra turn.", ask: writer([withGap, OK()]), askSelect: selector('{"nodes": ["draw"], "missing": ["追加ターン"]}') });
  assert.equal(prompts.length, 2);
  assert.ok(prompts[1].length > prompts[0].length, "2回目は、全ノード");
  assert.equal(r.fallback, true);
  assert.deepEqual(r.missing, ["追加ターン"]);
  assert.ok(!r.md.includes("未対応"), "全ノードで、書けた");
}
// やり直しても、本当に書けない効果は、「未対応」のまま (最後の結果を使う)
{
  prompts.length = 0;
  const r = await buildRuleTwoStage({ card: "Think", oracle: "t", ask: writer([withGap]), askSelect: selector('{"nodes": []}') });
  assert.equal(prompts.length, 2);
  assert.equal(r.fallback, true);
  assert.deepEqual(unsupportedLines(r.md), ["追加ターンを得る"]);
}
// 1段目が失敗 (通信・返事が読めない) → 最初から、全ノード。落ちない
for (const bad of [async () => { throw new Error("通信の失敗"); }, selector("選べません")]) {
  prompts.length = 0;
  const r = await buildRuleTwoStage({ card: "Think", oracle: "t", ask: writer([OK()]), askSelect: bad });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].length, full.length, "全ノードの指示");
  assert.equal(r.selected, undefined);
}
// 1段目を使わない (askSelect 無し) → 全ノード
{
  prompts.length = 0;
  const r = await buildRuleTwoStage({ card: "Think", oracle: "t", ask: writer([OK()]) });
  assert.equal(prompts[0].length, full.length);
  assert.equal(r.selected, undefined);
}
// 未対応の行の読み取り
assert.deepEqual(unsupportedLines("---\n---\n\n## 呪文能力\n\n- draw\n\n## 未対応\n\n- A\n- B: c\n\n## 起動型能力\n\n- x"), ["A", "B: c"]);
assert.deepEqual(unsupportedLines("## 呪文能力\n\n- draw\n"), []);
console.log("twostage ok");
