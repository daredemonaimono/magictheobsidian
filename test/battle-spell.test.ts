import assert from "node:assert";
import { RuleError, castSpell, passPriority } from "../src/battle/engine";
import { defineNode, resetRegistry } from "../src/battle/registry";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { CardRule } from "../src/battle/node";
import { parseRule } from "../src/battle/ruleMd";
import { SAMPLE_RULES } from "../src/battle/samples";
import { GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// サンプルの md を読んだルールブック。効果の無い呪文 (Bolt など) は、本文が空の呪文能力で表す
const rules = new Map<string, CardRule>();
for (const md of Object.values(SAMPLE_RULES)) {
  const r = parseRule(md);
  rules.set(r.card, r);
}
for (const n of ["Lightning Bolt", "Grizzly Bears", "Divination"]) rules.set(n, { card: n, abilities: [{ kind: "spell", body: [] }] });
const book: RuleBook = { get: (c) => rules.get(c) };

const card = (name: string, typeLine: string, mv: number, owner: string): GameCard => ({ id: name.toLowerCase().replace(/ /g, "-"), name, typeLine, mv, owner });
const bolt = (o = "A") => card("Lightning Bolt", "Instant", 1, o);
const bears = (o = "A") => card("Grizzly Bears", "Creature — Bear", 2, o);
const scene = (...cs: GameCard[]) => {
  const g = createGame(["A", "B"]);
  for (const c of cs) g.hands[c.owner].push(c);
  return g;
};
const ids = (cs: GameCard[]) => cs.map((c) => c.id);

// Negate: クリーチャーでない呪文を打ち消す。A が Bolt を唱え、B が Negate で打ち消す
{
  const g = scene(bolt(), card("Negate", "Instant", 2, "B"));
  castSpell(g, "A", "lightning-bolt", {}, book);
  assert.deepEqual(ids(g.hands["A"]), [], "唱えた呪文は手札から出る");
  passPriority(g, "A", book);
  castSpell(g, "B", "negate", { t: "lightning-bolt" }, book);
  assert.equal(g.priority, "B", "唱えた人が優先権を持つ");
  assert.equal(g.stack.length, 2);
  passPriority(g, "B", book);
  assert.equal(passPriority(g, "A", book), "resolved");
  assert.equal(g.stack.length, 0);
  assert.deepEqual(ids(g.graveyards["A"]), ["lightning-bolt"], "打ち消された Bolt は持ち主の墓地へ");
  assert.deepEqual(ids(g.graveyards["B"]), ["negate"]);
  assert.ok(g.log.some((l) => l.includes("打ち消した")));
}

// 合法でない対象は唱えられない。状態は変わらない
{
  const g = scene(bears(), card("Negate", "Instant", 2, "B"));
  castSpell(g, "A", "grizzly-bears", {}, book);
  passPriority(g, "A", book);
  assert.throws(() => castSpell(g, "B", "negate", { t: "grizzly-bears" }, book), RuleError, "Negate はクリーチャー呪文を対象にできない");
  assert.equal(g.stack.length, 1);
  assert.deepEqual(ids(g.hands["B"]), ["negate"], "手札に残る");
  assert.equal(g.priority, "B");
}

// Essence Scatter はクリーチャー呪文だけ
{
  const g = scene(bears(), bolt("A"), card("Essence Scatter", "Instant", 2, "B"));
  castSpell(g, "A", "grizzly-bears", {}, book);
  passPriority(g, "A", book);
  assert.throws(() => castSpell(g, "B", "essence-scatter", { t: "lightning-bolt" }, book), RuleError, "スタックに無い対象");
  castSpell(g, "B", "essence-scatter", { t: "grizzly-bears" }, book);
  passPriority(g, "B", book);
  passPriority(g, "A", book);
  assert.deepEqual(ids(g.graveyards["A"]), ["grizzly-bears"]);
}

// Spell Snare はマナ総量2の呪文だけ
{
  const three = card("Divination", "Sorcery", 3, "A");
  const g = scene(three, card("Spell Snare", "Instant", 1, "B"));
  castSpell(g, "A", "divination", {}, book);
  passPriority(g, "A", book);
  assert.throws(() => castSpell(g, "B", "spell-snare", { t: "divination" }, book), RuleError, "マナ総量3は対象にできない");
  const h = scene(bears(), card("Spell Snare", "Instant", 1, "B"));
  castSpell(h, "A", "grizzly-bears", {}, book);
  passPriority(h, "A", book);
  castSpell(h, "B", "spell-snare", { t: "grizzly-bears" }, book);
  assert.equal(h.stack.length, 2, "マナ総量2のクリーチャー呪文は対象にできる");
}

// 対象が無いとき・対象を指定しないときは唱えられない (Review Focus 2)
{
  const g = scene(card("Negate", "Instant", 2, "A"));
  assert.throws(() => castSpell(g, "A", "negate", {}, book), RuleError);
  assert.throws(() => castSpell(g, "A", "negate", { t: "nothing" }, book), RuleError);
  assert.equal(g.stack.length, 0);
  assert.deepEqual(ids(g.hands["A"]), ["negate"]);
}

// 唱えられない: 手札に無い・ソーサリーを相手のターンに・ルールが無いカード
{
  const g = scene(card("Divination", "Sorcery", 3, "B"), card("Unknown Card", "Instant", 1, "A"));
  assert.throws(() => castSpell(g, "A", "nope", {}, book), RuleError, "手札に無い");
  assert.throws(() => castSpell(g, "A", "unknown-card", {}, book), RuleError, "ルールが無い");
  passPriority(g, "A", book);
  assert.throws(() => castSpell(g, "B", "divination", {}, book), RuleError, "相手のターンのソーサリー");
}

// 実装されていないノードは、飛ばして記録を残す。例外は出ない
{
  defineNode({ id: "draw", title: "引く", summary: "未実装のテスト用", params: { count: { type: "number" } }, outputs: {} });
  rules.set("Divination", { card: "Divination", abilities: [{ kind: "spell", body: [{ node: "draw", args: { count: 3 } }] }] });
  const g = scene(card("Divination", "Sorcery", 3, "A"));
  castSpell(g, "A", "divination", {}, book);
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.ok(g.log.some((l) => l.includes("未実装: draw")));
  assert.deepEqual(ids(g.graveyards["A"]), ["divination"]);
}

// ここから Task 5: 応答の連鎖と、対象が消えた解決
const withId = (c: GameCard, id: string): GameCard => ({ ...c, id });

// 打ち消し返し (Review Focus 5): 後から唱えた方が先に解決し、元の呪文は残って最後に解決する
{
  const g = scene(bolt(), withId(card("Negate", "Instant", 2, "B"), "negate-b"), withId(card("Negate", "Instant", 2, "A"), "negate-a"));
  castSpell(g, "A", "lightning-bolt", {}, book);
  passPriority(g, "A", book);
  castSpell(g, "B", "negate-b", { t: "lightning-bolt" }, book);
  passPriority(g, "B", book);
  castSpell(g, "A", "negate-a", { t: "negate-b" }, book);
  assert.deepEqual(g.stack.map((s) => s.id), ["lightning-bolt", "negate-b", "negate-a"]);
  passPriority(g, "A", book);
  assert.equal(passPriority(g, "B", book), "resolved");
  assert.deepEqual(g.stack.map((s) => s.id), ["lightning-bolt"], "B の Negate だけが消え、Bolt は残る");
  assert.deepEqual(ids(g.graveyards["B"]), ["negate-b"]);
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.deepEqual(ids(g.graveyards["A"]), ["negate-a", "lightning-bolt"], "A の Negate、Bolt の順に解決");
  assert.equal(g.log.filter((l) => l.includes("打ち消した")).length, 1);
}

// 同じ対象に2つの打ち消し (Review Focus 1): 先に解決した方が打ち消し、後の方は対象が無く何もしないが、例外は出ない
{
  const g = scene(bolt(), withId(card("Negate", "Instant", 2, "B"), "negate-1"), withId(card("Negate", "Instant", 2, "B"), "negate-2"));
  castSpell(g, "A", "lightning-bolt", {}, book);
  passPriority(g, "A", book);
  castSpell(g, "B", "negate-1", { t: "lightning-bolt" }, book);
  castSpell(g, "B", "negate-2", { t: "lightning-bolt" }, book);
  passPriority(g, "B", book);
  passPriority(g, "A", book);
  assert.deepEqual(ids(g.graveyards["A"]), ["lightning-bolt"], "negate-2 が先に Bolt を打ち消す");
  passPriority(g, "A", book);
  assert.doesNotThrow(() => passPriority(g, "B", book));
  assert.equal(g.stack.length, 0);
  assert.deepEqual(ids(g.graveyards["B"]), ["negate-2", "negate-1"], "negate-1 は何もせず墓地へ");
  assert.ok(g.log.some((l) => l.includes("対象が無くなったので解決しない")));
  assert.equal(g.log.filter((l) => l.includes("打ち消した")).length, 1);
}

// 相手のターン中にも、優先権を得れば唱えられる
{
  const g = scene(bolt("B"), card("Negate", "Instant", 2, "A"));
  g.active = "B";
  g.priority = "B";
  castSpell(g, "B", "lightning-bolt", {}, book);
  passPriority(g, "B", book);
  castSpell(g, "A", "negate", { t: "lightning-bolt" }, book);
  assert.equal(g.stack.length, 2);
}
