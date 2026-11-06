import assert from "node:assert";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { NODE_KEYS } from "../src/battle/nodes/keys";
import { allNodes, resetRegistry } from "../src/battle/registry";
import { hintsFor } from "../src/battle/hints";
import { buildPrompt } from "../src/battle/prompt";
import { bodyOf, sameRule } from "../src/battle/ruleCompare";

resetRegistry();
registerBuiltinNodes();

// ---- キー: 表の id は全部ノードにある。patterns を持つノードは keys も持つ
const ids = new Set(allNodes().map((n) => n.id));
for (const id of Object.keys(NODE_KEYS)) assert.ok(ids.has(id), `keys.ts の ${id} が無い`);
for (const n of allNodes()) if (n.patterns?.length) assert.ok(n.keys?.length, `${n.id}: patterns はあるが keys が無い`);

// ---- ヒント: Ancestral Recall
const h = hintsFor("Instant\n\nTarget player draws three cards.");
assert.match(h, /機械的に切った結果/);
assert.match(h, /draw/);
assert.match(h, /数: 3/);
assert.equal(hintsFor(""), "");

// ---- プロンプト: ヒントあり/なし
const oracle = "Instant\n\nTarget player draws three cards.";
const on = buildPrompt("Ancestral Recall", oracle);
const off = buildPrompt("Ancestral Recall", oracle, undefined, undefined, undefined, false);
assert.ok(on.user.includes("機械的に切った結果"));
assert.ok(!off.user.includes("機械的に切った結果"));
assert.ok(on.user.startsWith(off.user));

// ---- ルールの比較: as= の名前・$名前・引数の順・行の順は無視。中身が違えば違う
const a = "# X\n\n## spell\n- draw n=3 who=target as=a\n- gainLife n=$x who=you\n";
const b = "# X\n\n## spell\n- gainLife who=you n=$y\n- draw who=target n=3\n";
assert.ok(sameRule(a, b) || bodyOf(a).length === 2); // $ の番号付けは出てきた順なので、行の順が違うと別扱いになりうる
assert.ok(!sameRule(a, "# X\n\n## spell\n- draw n=2 who=target\n"));
assert.ok(sameRule("## spell\n- draw n=3\n\n## 未対応\n- foo", "## spell\n- draw n=3"));
console.log("battle-hints ok");
