import assert from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { nodeDocs } from "../src/battle/nodeDocs";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { allNodes, resetRegistry } from "../src/battle/registry";

resetRegistry();
registerBuiltinNodes();

// ---- ノードが増えても、散らからないための見張り
const nodes = allNodes();
const CATEGORIES = ["宣言・コスト・条件", "対象・数える・絞り込む", "カードの移動・ライブラリー・手札", "パーマネント・トークン・カウンター", "ダメージ・ライフ・マナ・打ち消し", "継続効果"];
for (const n of nodes) {
  assert.ok(CATEGORIES.includes(n.category), `${n.id}: カテゴリーが、決まった一覧に無い (${n.category})。新しいカテゴリーは、このテストの一覧と src/battle/nodes/ に足す`);
  assert.ok(n.title.trim() && n.summary.trim(), `${n.id}: 名前と説明が要る`);
}
// 同じ id は、登録のとき、エラーになる (registry)。名前 (title) の重複も、ここで見つける (似たノードを、別々に作らないため)
const titles = new Map<string, string>();
for (const n of nodes) {
  assert.ok(!titles.has(n.title), `${n.id} と ${titles.get(n.title)} が、同じ名前 (${n.title})。同じ働きなら、既存のノードを使う`);
  titles.set(n.title, n.id);
}
// 説明の長さ: AI への指示は、ノードの説明を、毎回、全部含む。1つあたりの上限 (長いと、ノードの数に比例して、費用が増える)
for (const n of nodes) assert.ok(n.summary.length <= 520, `${n.id}: 説明が長すぎる (${n.summary.length} 字)。520 字まで。詳しい使い方は、README へ`);

// ---- 一覧 (docs/nodes.md) は、レジストリから自動で作る。違っていたら、npm run docs:nodes
const path = "docs/nodes.md";
const docs = nodeDocs();
if (process.env.UPDATE_DOCS === "1") {
  writeFileSync(path, docs);
  console.log(`${path} を更新した (${nodes.length} 個)`);
} else {
  assert.ok(existsSync(path), `${path} が無い。npm run docs:nodes で作る`);
  assert.equal(readFileSync(path, "utf-8"), docs, `${path} が古い。npm run docs:nodes で更新する`);
}
assert.ok(docs.includes("### `search`") && docs.includes("## カードの移動・ライブラリー・手札"));
console.log("nodedocs ok");
