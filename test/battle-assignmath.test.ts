import assert from "node:assert";
import { bump, focus } from "../src/battle/assignMath";

const s = { power: 5, trample: false, blockers: [{ id: "a", lethal: 2 }, { id: "b", lethal: 2 }, { id: "c", lethal: 3 }] };
// +1: ほかのいちばん多いブロッカーから 1 つ取る (合計は、パワーのまま)
assert.deepEqual(bump(s, { a: 2, b: 2, c: 1 }, "c", 1), { a: 2, b: 1, c: 2 }, "同じなら、あとのほうから");
assert.deepEqual(bump(s, { a: 5, b: 0, c: 0 }, "b", 1), { a: 4, b: 1, c: 0 });
assert.deepEqual(bump(s, { a: 0, b: 0, c: 5 }, "c", 1), { a: 0, b: 0, c: 5 }, "ほかが 0 なら、変わらない");
// −1: ほかの先頭のブロッカーに渡す
assert.deepEqual(bump(s, { a: 1, b: 2, c: 2 }, "a", -1), { a: 0, b: 3, c: 2 });
assert.deepEqual(bump(s, { a: 0, b: 2, c: 3 }, "a", -1), { a: 0, b: 2, c: 3 }, "0 なら、変わらない");
// 合計は、いつも保たれる
let v = { a: 2, b: 2, c: 1 };
for (const [id, d] of [["a", 1], ["b", -1], ["c", 1], ["c", 1], ["a", -1]] as const) {
  v = bump(s, v, id, d);
  assert.equal(v.a + v.b + v.c, 5);
  assert.ok(Object.values(v).every((n) => n >= 0));
}
// トランプル: 合計が、パワー以下。+1 は、残りから。−1 は、残りへ
const t = { ...s, trample: true };
assert.deepEqual(bump(t, { a: 2, b: 2, c: 0 }, "c", 1), { a: 2, b: 2, c: 1 }, "残り 1 から");
assert.deepEqual(bump(t, { a: 2, b: 2, c: 1 }, "c", 1), { a: 2, b: 1, c: 2 }, "残りが 0 なら、ほかから");
assert.deepEqual(bump(t, { a: 2, b: 2, c: 1 }, "a", -1), { a: 1, b: 2, c: 1 }, "残りへ (合計が減る)");
// 集中: 選んだブロッカーに致死を先に、残りは宣言の順
assert.deepEqual(focus(s, "c"), { a: 2, b: 0, c: 3 });
assert.deepEqual(focus(s, "b"), { a: 2, b: 2, c: 1 }, "b に致死 2、残り 3 は、宣言の順に (a に 2、c に 1)");
assert.deepEqual(focus({ ...s, power: 9 }, "a"), { a: 2, b: 2, c: 5 }, "余りは、最後のブロッカー (トランプルなし)");
assert.deepEqual(focus({ ...t, power: 9 }, "a"), { a: 2, b: 2, c: 3 }, "トランプルは、余りを相手へ");
console.log("assignmath ok");
