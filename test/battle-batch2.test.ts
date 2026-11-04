import assert from "node:assert";
import { RuleError, castSpell, passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, checkCondition, resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability[] => [{ kind: "spell", body }];
const ids = (cs: GameCard[]) => cs.map((c) => c.id);
const creature = (id: string, owner: string, extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power: 1, toughness: 1 }), controller: owner, ...extra });
const resolveAll = (g: Game, book: RuleBook) => {
  passPriority(g, g.priority!, book);
  passPriority(g, g.priority!, book);
};

// ---- 条件: モード (mode1..) と、数の条件 (zone:型:N / N+ / N-)
assert.equal(checkCondition("mode1"), null);
assert.equal(checkCondition("!mode2"), null);
assert.equal(checkCondition("mode9"), "未知の条件: mode9");
for (const ok of ["graveyard:lesson:3+", "!graveyard:lesson:3+", "hand:any:0", "library:any:5-", "battlefield:creature:2"]) assert.equal(checkCondition(ok), null, ok);
for (const bad of ["graveyard:lesson", "stack:any:1", "graveyard:lesson:x", "graveyard::3+"]) assert.equal(checkCondition(bad), `未知の条件: ${bad}`, bad);

// ---- 対象に if を付けられる (選ばれなかったモードの対象は求めない)。cost などの宣言のノードには付けられない
assert.equal(checkCall(call("target", { zone: "stack", kind: "spell" }, { if: "mode1" })), null);
assert.ok(checkCall(call("cost", { tap: true }, { if: "kicked" }))?.includes("条件を付けられない"));
assert.ok(checkCall(call("modes", { count: 2, min: 1, max: 1 }, { if: "mode1" }))?.includes("条件を付けられない"));
assert.ok(checkCall(call("target", { zone: "stack", kind: "spell", min: -1 }))?.includes("小さすぎる"));

// ---- Amazing Acrobatics: 以下から1つまたは両方を選ぶ。呪文を打ち消す / クリーチャー1〜2体をタップ
const acro = spell(
  call("modes", { count: 2, min: 1, max: 2 }),
  call("target", { zone: "stack", kind: "spell" }, { as: "s", if: "mode1" }),
  call("counter", { target: { ref: "s" } }, { if: "mode1" }),
  call("target", { zone: "battlefield", kind: "permanent", type: "creature", min: 1, max: 2 }, { as: "c", if: "mode2" }),
  call("tap", { target: { ref: "c" } }, { if: "mode2" }),
);
const acroGame = () => {
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("bolt"));
  g.hands["B"].push(card("acro", "Instant", "B"));
  g.battlefield.push(creature("x1", "A"), creature("x2", "A"), creature("x3", "A"), creature("hex", "A", { mods: [{ power: 0, toughness: 0, keyword: "hexproof", until: "forever" }] }));
  const book = rulesOf({ bolt: spell(), acro });
  castSpell(g, "A", "bolt", {}, book);
  passPriority(g, "A", book);
  return { g, book };
};
const tapped = (g: Game) => g.battlefield.filter((p) => p.tapped).map((p) => p.id).sort();
{
  // モード1だけ: 呪文を打ち消す。モード2の対象は求めない
  const m1 = acroGame();
  castSpell(m1.g, "B", "acro", { s: "bolt" }, m1.book, { modes: [1] });
  resolveAll(m1.g, m1.book);
  assert.deepEqual(ids(m1.g.graveyards["A"]), ["bolt"]);
  assert.deepEqual(tapped(m1.g), []);
  // モード2だけ: 2体をタップ。モード1の対象は求めない
  const m2 = acroGame();
  castSpell(m2.g, "B", "acro", { c: "x1,x2" }, m2.book, { modes: [2] });
  resolveAll(m2.g, m2.book);
  assert.deepEqual(tapped(m2.g), ["x1", "x2"]);
  assert.deepEqual(m2.g.stack.map((x) => x.id), ["bolt"], "モード1は選んでいないので、bolt は打ち消されずスタックに残る");
  assert.deepEqual(ids(m2.g.graveyards["A"]), []);
  // 両方
  const both = acroGame();
  castSpell(both.g, "B", "acro", { s: "bolt", c: "x1" }, both.book, { modes: [1, 2] });
  resolveAll(both.g, both.book);
  assert.deepEqual(tapped(both.g), ["x1"]);
  assert.deepEqual(ids(both.g.graveyards["A"]), ["bolt"]);

  // モードの選び方: 未選択・範囲外・重複・多すぎ・宣言の無い呪文でモードを選ぶ、は唱えられない (状態は変わらない)
  for (const [why, cast] of [["未選択", {}], ["空", { modes: [] }], ["範囲外", { modes: [3] }], ["0番", { modes: [0] }], ["重複", { modes: [1, 1] }], ["小数", { modes: [1.5] }]] as const) {
    const bad = acroGame();
    assert.throws(() => castSpell(bad.g, "B", "acro", { s: "bolt", c: "x1" }, bad.book, cast), RuleError, why);
    assert.equal(bad.g.stack.length, 1, `${why}: 状態は変わらない`);
  }
  const noDecl = acroGame();
  noDecl.g.hands["B"].push(card("plain", "Instant", "B"));
  assert.throws(() => castSpell(noDecl.g, "B", "plain", {}, rulesOf({ bolt: spell(), plain: spell() }), { modes: [1] }), RuleError, "modes の宣言が無いのにモードを選ぶ");

  // 選んだモードの対象が足りない・多い・重複・呪禁は、唱えられない。選んでいないモードの対象は、あっても無視される
  const t = (targets: Record<string, string>, modes: number[]) => {
    const x = acroGame();
    assert.throws(() => castSpell(x.g, "B", "acro", targets, x.book, { modes }), RuleError, JSON.stringify([targets, modes]));
    assert.equal(x.g.stack.length, 1);
  };
  t({}, [1]); // モード1の対象が無い
  t({ s: "bolt" }, [2]); // モード2の対象が無い
  t({ c: "x1,x2,x3" }, [2]); // 多い (最大 2)
  t({ c: "x1,x1" }, [2]); // 重複
  t({ c: "x1,hex" }, [2]); // 1体が呪禁
  t({ c: "x1,zz" }, [2]); // 存在しない
  const ignored = acroGame();
  assert.doesNotThrow(() => castSpell(ignored.g, "B", "acro", { s: "nothing", c: "x1" }, ignored.book, { modes: [2] }), "選んでいないモード1の対象は見ない");

  // 解決前に対象が消えたとき: 残っている対象のモードだけ効く。全部消えたら解決しない
  const half = acroGame();
  castSpell(half.g, "B", "acro", { s: "bolt", c: "x1,x2" }, half.book, { modes: [1, 2] });
  half.g.battlefield = [];
  resolveAll(half.g, half.book);
  assert.deepEqual(ids(half.g.graveyards["A"]), ["bolt"], "モード1は効いた");
  const none = acroGame();
  castSpell(none.g, "B", "acro", { c: "x1" }, none.book, { modes: [2] });
  none.g.battlefield = [];
  resolveAll(none.g, none.book);
  assert.ok(none.g.log.some((l) => l.includes("対象が無くなった")));
}

// 最大 N 体 (min=0): 対象を取らなくてもよい
{
  const up = spell(call("target", { zone: "battlefield", kind: "permanent", type: "creature", min: 0, max: 1 }, { as: "c" }), call("tap", { target: { ref: "c" } }));
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("up"));
  g.battlefield.push(creature("x1", "B"));
  const book = rulesOf({ up });
  assert.doesNotThrow(() => castSpell(g, "A", "up", {}, book));
  passPriority(g, "A", book);
  assert.doesNotThrow(() => passPriority(g, "B", book));
  assert.deepEqual(tapped(g), []);
}

// ---- Confusticate and Bebother: 以下から1つを選ぶ
const conf = spell(
  call("modes", { count: 2, min: 1, max: 1 }),
  call("target", { zone: "stack", kind: "spell" }, { as: "s", if: "mode1" }),
  call("counter", { target: { ref: "s" }, unlessPay: 4 }, { if: "mode1" }),
  call("draw", { player: "you", count: 2 }, { if: "mode2" }),
  call("discard", { player: "you", count: 1 }, { if: "mode2" }),
);
{
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("conf"));
  g.libraries["A"] = [card("c1"), card("c2"), card("c3")];
  const book = rulesOf({ conf });
  assert.throws(() => castSpell(g, "A", "conf", {}, book, { modes: [1, 2] }), RuleError, "1つだけ");
  castSpell(g, "A", "conf", {}, book, { modes: [2] });
  resolveAll(g, book);
  assert.deepEqual(ids(g.hands["A"]), ["c1"], "2枚引いて1枚捨てる");
  assert.deepEqual(ids(g.graveyards["A"]), ["c2", "conf"]);

  const h = createGame(["A", "B"]);
  h.hands["A"].push(card("bolt"));
  h.hands["B"].push(card("conf", "Instant", "B"));
  const book2 = rulesOf({ bolt: spell(), conf });
  castSpell(h, "A", "bolt", {}, book2);
  passPriority(h, "A", book2);
  castSpell(h, "B", "conf", { s: "bolt" }, book2, { modes: [1] });
  resolveAll(h, book2);
  assert.deepEqual(ids(h.graveyards["A"]), ["bolt"], "4 払えないので打ち消される");
}

// ---- Aetherize: すべての攻撃クリーチャーを持ち主の手札に戻す (対象を取らない)。呪禁でも戻る
{
  const aeth = spell(call("select", { zone: "battlefield", kind: "permanent", type: "creature", attacking: true }, { as: "s" }), call("bounce", { target: { ref: "s" } }));
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("aeth"));
  g.battlefield.push(
    creature("a1", "A", { attacking: true }),
    creature("b1", "B", { attacking: true, mods: [{ power: 0, toughness: 0, keyword: "hexproof", until: "forever" }] }),
    creature("b2", "B"),
    { id: "art", card: card("art", "Artifact", "B"), controller: "B", attacking: true },
  );
  const book = rulesOf({ aeth });
  castSpell(g, "A", "aeth", {}, book);
  resolveAll(g, book);
  assert.deepEqual(g.battlefield.map((p) => p.id).sort(), ["art", "b2"], "攻撃クリーチャーだけが戻った");
  assert.deepEqual(ids(g.hands["A"]), ["a1"]);
  assert.deepEqual(ids(g.hands["B"]), ["b1"], "呪禁でも戻る (対象を取らない)");
  // 該当が無くても落ちない
  const h = createGame(["A", "B"]);
  h.hands["A"].push(card("aeth"));
  castSpell(h, "A", "aeth", {}, book);
  assert.doesNotThrow(() => resolveAll(h, book));
  // target の tapped / attacking の絞り込み
  const tg = createGame(["A", "B"]);
  tg.hands["A"].push(card("pick"));
  tg.battlefield.push(creature("up", "B"), creature("dn", "B", { tapped: true }));
  const pick = rulesOf({ pick: spell(call("target", { zone: "battlefield", kind: "permanent", type: "creature", tapped: true }, { as: "t" })) });
  assert.throws(() => castSpell(tg, "A", "pick", { t: "up" }, pick), RuleError, "タップされていない");
  assert.doesNotThrow(() => castSpell(tg, "A", "pick", { t: "dn" }, pick));
}

// ---- Accumulate Wisdom: 上から3枚を見て、1枚を手札に、残りを底に。墓地に講義が3枚以上なら、代わりにすべて手札に
const noLessons = "!graveyard:lesson:3+";
const aw = spell(
  call("look", { player: "you", count: 3 }, { as: "l" }),
  call("choose", { from: { ref: "l" }, count: 1 }, { as: "c", if: noLessons }),
  call("move", { cards: { ref: "c" }, to: "hand" }, { if: noLessons }),
  call("move", { cards: { ref: "l" }, except: { ref: "c" }, to: "bottom" }, { if: noLessons }),
  call("move", { cards: { ref: "l" }, to: "hand" }, { if: "graveyard:lesson:3+" }),
);
const awGame = (lessons: number, decide?: Game["decide"]) => {
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("aw", "Instant — Lesson"));
  g.libraries["A"] = [card("x1"), card("x2"), card("x3"), card("x4")];
  for (let i = 0; i < lessons; i++) g.graveyards["A"].push(card(`les${i}`, "Instant — Lesson"));
  g.graveyards["A"].push(card("other", "Sorcery"));
  g.decide = decide;
  const book = rulesOf({ aw });
  castSpell(g, "A", "aw", {}, book);
  resolveAll(g, book);
  return g;
};
{
  const plain = awGame(2);
  assert.deepEqual(ids(plain.hands["A"]), ["x1"], "既定では先頭を選ぶ");
  assert.deepEqual(ids(plain.libraries["A"]), ["x4", "x2", "x3"], "残りは底に (順番は見た順)");
  const picked = awGame(0, { choose: (_g, _p, from) => [from[1]] });
  assert.deepEqual(ids(picked.hands["A"]), ["x2"], "選んだカードが手札に");
  assert.deepEqual(ids(picked.libraries["A"]), ["x4", "x1", "x3"]);
  const lessons = awGame(3);
  assert.deepEqual(ids(lessons.hands["A"]), ["x1", "x2", "x3"], "講義が3枚以上なら、すべて手札に");
  assert.deepEqual(ids(lessons.libraries["A"]), ["x4"]);
  // ライブラリーが足りないときは、ある分だけ見る
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("aw", "Instant — Lesson"));
  g.libraries["A"] = [card("x1")];
  const book = rulesOf({ aw });
  castSpell(g, "A", "aw", {}, book);
  assert.doesNotThrow(() => resolveAll(g, book));
  assert.deepEqual(ids(g.hands["A"]), ["x1"]);
}

// 複数の対象: 解決時は、残っている合法な対象にだけ効く (全部が不正なら解決しない)。唱えるときは、全部が合法でなければならない
{
  const half = acroGame();
  castSpell(half.g, "B", "acro", { c: "x1,x2" }, half.book, { modes: [2] });
  half.g.battlefield = half.g.battlefield.filter((p) => p.id !== "x1"); // x1 だけが戦場を離れる
  resolveAll(half.g, half.book);
  assert.deepEqual(tapped(half.g), ["x2"], "残った x2 にはタップが効く");
  assert.ok(!half.g.log.some((l) => l.includes("対象が無くなった")));

  const both = acroGame();
  castSpell(both.g, "B", "acro", { s: "bolt", c: "x1,x2" }, both.book, { modes: [1, 2] });
  both.g.battlefield = both.g.battlefield.filter((p) => p.id !== "x1");
  resolveAll(both.g, both.book);
  assert.deepEqual(ids(both.g.graveyards["A"]), ["bolt"], "打ち消しも効く");
  assert.deepEqual(tapped(both.g), ["x2"], "残った x2 もタップされる");
}

// 数の条件の型 any は、大文字で書かれても any (黙って偽にならない)。場所と型の大文字は、型の部分一致では区別しない
{
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("probe"));
  g.libraries["A"] = [card("x1")];
  const book = rulesOf({ probe: spell(call("draw", { player: "you", count: 1 }, { if: "library:Any:1" })) });
  castSpell(g, "A", "probe", {}, book);
  resolveAll(g, book);
  assert.deepEqual(ids(g.hands["A"]), ["x1"], "library:Any:1 = ライブラリーが1枚");
}
