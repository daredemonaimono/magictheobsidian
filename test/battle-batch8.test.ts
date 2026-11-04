import assert from "node:assert";
import { RuleError, activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { parseManaCost } from "../src/battle/mana";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { parseRule, writeRule } from "../src/battle/ruleMd";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability[] => [{ kind: "spell", body }];
const act = (...body: NodeCall[]): Ability => ({ kind: "activated", body });
const perm = (id: string, typeLine = "Artifact", owner = "A"): Perm => ({ id, card: card(id, typeLine, owner), controller: owner });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 60; i++) passPriority(g, g.priority!, book);
};
const pool = (g: Game, p = "A") => g.pool[p] ?? {};

// ---- マナコストの読み取り
assert.deepEqual(parseManaCost("{2}{U}{U}"), { generic: 2, colors: { U: 2 }, hybrid: [], text: "{2}{U}{U}" });
assert.deepEqual(parseManaCost("{3}").generic, 3);
assert.deepEqual(parseManaCost("").generic, 0);
assert.deepEqual(parseManaCost("{C}{W}").colors, { C: 1, W: 1 });
assert.deepEqual(parseManaCost("{X}{R}").colors, { R: 1 }, "X は 0 として読む");
assert.deepEqual(parseManaCost("{W/U}{U/B}").hybrid, [[{ color: "W" }, { color: "U" }], [{ color: "U" }, { color: "B" }]]);
assert.deepEqual(parseManaCost("{2/W}").hybrid, [[{ generic: 2 }, { color: "W" }]]);
assert.deepEqual(parseManaCost("{S}").generic, 1, "氷雪マナ {S} は、色の無いマナ1点として読む (氷雪の区別はしない)");
assert.throws(() => parseManaCost("UU"), /マナコスト/);
assert.throws(() => parseManaCost("{Z}"), /マナコスト/);

// ---- 検査: cost / additionalCost に manaCost、addMana に color
assert.equal(checkCall(call("cost", { manaCost: "{1}{U}", tap: true })), null);
assert.ok(checkCall(call("cost", { manaCost: "UU" }))?.includes("マナコスト"));
assert.equal(checkCall(call("additionalCost", { flag: "kicked", manaCost: "{1}{U}" })), null);
for (const color of ["W", "U", "B", "R", "G", "C", "any"]) assert.equal(checkCall(call("addMana", { amount: 1, color })), null, color);
assert.ok(checkCall(call("addMana", { amount: 1, color: "X" })));

// ---- addMana: 色つきは、合計と色別の両方に入る。色なしは、無色
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Island", "Land"), perm("Sol", "Artifact"), perm("Skin", "Artifact"));
  const book = rulesOf({
    Island: [act(call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" }))],
    Sol: [act(call("cost", { tap: true }), call("addMana", { amount: 2 }))],
    Skin: [act(call("cost", { tap: true }), call("addMana", { amount: 1, color: "any" }))],
  });
  activateAbility(g, "A", "Island", 0, {}, book);
  assert.equal(g.mana["A"], 1);
  assert.equal(pool(g).U, 1);
  activateAbility(g, "A", "Sol", 0, {}, book);
  assert.equal(g.mana["A"], 3, "無色は、合計だけに入る");
  assert.equal(pool(g).U, 1);
  activateAbility(g, "A", "Skin", 0, {}, book);
  assert.equal(g.mana["A"], 4);
  assert.equal(pool(g).A, 1, "好きな色のマナ");
}

// ---- 起動型能力: 色つきのコスト
const needU = (): Ability[] => [act(call("cost", { manaCost: "{1}{U}" }), call("draw", { player: "you", count: 1 }))];
const withMana = (mana: number, colors: Record<string, number> = {}) => {
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Relic"));
  g.libraries["A"] = [card("l1"), card("l2")];
  g.mana["A"] = mana;
  g.pool["A"] = { ...colors };
  return { g, book: rulesOf({ Relic: needU() }) };
};
{
  const ok = withMana(2, { U: 1 }); // 青1 + 無色1
  activateAbility(ok.g, "A", "Relic", 0, {}, ok.book);
  assert.equal(ok.g.mana["A"], 0);
  assert.equal(pool(ok.g).U ?? 0, 0, "青を払った");
  const colorless = withMana(2); // 無色2 だけでは、青を払えない
  assert.throws(() => activateAbility(colorless.g, "A", "Relic", 0, {}, colorless.book), RuleError);
  assert.equal(colorless.g.mana["A"], 2, "払えなければ、減らない");
  const wild = withMana(2, { A: 1 }); // 好きな色1 + 無色1: 好きな色で青を払える
  activateAbility(wild.g, "A", "Relic", 0, {}, wild.book);
  assert.equal(wild.g.mana["A"], 0);
  const twoBlue = withMana(2, { U: 2 }); // 汎用の {1} は、色つきのマナでも払える
  activateAbility(twoBlue.g, "A", "Relic", 0, {}, twoBlue.book);
  assert.equal(twoBlue.g.mana["A"], 0);
  assert.equal(pool(twoBlue.g).U, 0);
  const wrong = withMana(2, { R: 1 }); // 赤1 + 無色1: 青が無い
  assert.throws(() => activateAbility(wrong.g, "A", "Relic", 0, {}, wrong.book), RuleError);
  assert.equal(pool(wrong.g).R, 1);
  // 汎用は、色つきでないマナ (無色) から先に払う: 青2 + 無色1 で {1}{U} → 青1 が残る
  const keep = withMana(3, { U: 2 });
  activateAbility(keep.g, "A", "Relic", 0, {}, keep.book);
  assert.equal(keep.g.mana["A"], 1);
  assert.equal(pool(keep.g).U, 1, "無色を先に使い、色つきを残す");
}

// ---- 呪文のマナコスト (payManaCosts): カードの manaCost の色を払う。コスト軽減は汎用の分だけ
{
  const make = (mana: number, colors: Record<string, number>, manaCost = "{1}{U}{U}", reduce = false) => {
    const g = createGame(["A", "B"]);
    g.payManaCosts = true;
    g.mana["A"] = mana;
    g.pool["A"] = { ...colors };
    g.hands["A"].push(card("spellA", "Sorcery", "A", { mv: 3, manaCost }));
    g.step = "main1";
    const m: Record<string, Ability[]> = { spellA: spell(call("draw", { player: "you", count: 0 })) };
    if (reduce) {
      m.Geist = [{ kind: "static", body: [call("reduceCost", { amount: 2, who: "you" })] }];
      g.battlefield.push(perm("Geist", "Creature — Spirit"));
    }
    return { g, book: rulesOf(m) };
  };
  const good = make(3, { U: 2 });
  castSpell(good.g, "A", "spellA", {}, good.book);
  assert.equal(good.g.mana["A"], 0);
  const noBlue = make(3, { U: 1 });
  assert.throws(() => castSpell(noBlue.g, "A", "spellA", {}, noBlue.book), RuleError, "青が1つしかない");
  assert.equal(noBlue.g.hands["A"].length, 1, "唱えられなければ、手札に残る");
  assert.equal(noBlue.g.mana["A"], 3);
  // コスト軽減 2: {1}{U}{U} → {U}{U} (色は減らない)。無色が余っても、青は足りないと唱えられない
  const reduced = make(2, { U: 2 }, "{1}{U}{U}", true);
  castSpell(reduced.g, "A", "spellA", {}, reduced.book);
  assert.equal(reduced.g.mana["A"], 0);
  const reducedNoBlue = make(3, { U: 1 }, "{1}{U}{U}", true);
  assert.throws(() => castSpell(reducedNoBlue.g, "A", "spellA", {}, reducedNoBlue.book), RuleError, "軽減できるのは汎用の分だけ");
  // manaCost が無いカードは、いままでどおり、マナ総量の数だけ (色なし)
  const legacy = createGame(["A", "B"]);
  legacy.payManaCosts = true;
  legacy.mana["A"] = 3;
  legacy.hands["A"].push(card("old", "Sorcery", "A", { mv: 3 }));
  castSpell(legacy, "A", "old", {}, rulesOf({ old: spell(call("draw", { player: "you", count: 0 })) }));
  assert.equal(legacy.mana["A"], 0);
}

// ---- 混成マナ {W/U}・{2/W}
{
  const make = (mana: number, colors: Record<string, number>, manaCost: string) => {
    const g = createGame(["A", "B"]);
    g.payManaCosts = true;
    g.mana["A"] = mana;
    g.pool["A"] = { ...colors };
    g.hands["A"].push(card("h", "Sorcery", "A", { mv: 1, manaCost }));
    return { g, book: rulesOf({ h: spell(call("draw", { player: "you", count: 0 })) }) };
  };
  const u = make(1, { U: 1 }, "{W/U}");
  castSpell(u.g, "A", "h", {}, u.book);
  assert.equal(u.g.mana["A"], 0, "青でも白でも払える");
  const none = make(1, {}, "{W/U}");
  assert.throws(() => castSpell(none.g, "A", "h", {}, none.book), RuleError);
  const two = make(2, {}, "{2/W}");
  castSpell(two.g, "A", "h", {}, two.book);
  assert.equal(two.g.mana["A"], 0, "{2/W} は、白か、汎用2点");
  const white = make(1, { W: 1 }, "{2/W}");
  castSpell(white.g, "A", "h", {}, white.book);
  assert.equal(white.g.mana["A"], 0);
}

// ---- 制限つきの色マナ (Chandra の +1: {U}。クリーチャーでない呪文にしか使えない)
{
  const make = (typeLine: string) => {
    const g = createGame(["A", "B"]);
    g.payManaCosts = true;
    g.restrictedMana["A"] = [{ amount: 1, color: "U", notType: "creature" }];
    g.hands["A"].push(card("s", typeLine, "A", { mv: 1, manaCost: "{U}" }));
    return { g, book: rulesOf({ s: spell(call("draw", { player: "you", count: 0 })) }) };
  };
  const ok = make("Instant");
  castSpell(ok.g, "A", "s", {}, ok.book);
  assert.equal(ok.g.restrictedMana["A"].length, 0, "制限つきの青で、青を払う");
  const no = make("Creature — Bear");
  no.g.step = "main1";
  assert.throws(() => castSpell(no.g, "A", "s", {}, no.book), RuleError, "クリーチャーには使えない");
  // addMana の color と制限を同時に付ける
  const g = createGame(["A", "B"]);
  g.battlefield.push(perm("Chandra", "Legendary Planeswalker — Chandra"));
  g.battlefield[0].counters = { loyalty: 3 };
  g.step = "main1";
  const book = rulesOf({ Chandra: [act(call("cost", { loyalty: 1 }), call("addMana", { amount: 1, color: "U", spellNotType: "creature" }))] });
  activateAbility(g, "A", "Chandra", 0, {}, book);
  drain(g, book);
  assert.deepEqual(g.restrictedMana["A"], [{ amount: 1, color: "U", notType: "creature" }]);
}

// ---- counter の「支払わないかぎり」: 汎用の分を、色つきのマナでも払える
{
  const g = createGame(["A", "B"]);
  g.mana["A"] = 2; // 払うのは、打ち消される呪文のコントローラー
  g.pool["A"] = { U: 2 };
  g.hands["A"].push(card("spellA", "Sorcery", "A"));
  const book = rulesOf({ spellA: spell(call("draw", { player: "you", count: 0 })), snare: spell(call("target", { zone: "stack", kind: "spell" }, { as: "t" }), call("counter", { target: { ref: "t" }, unlessPay: 2 })) });
  castSpell(g, "A", "spellA", {}, book);
  g.hands["B"].push(card("snare", "Instant", "B"));
  g.priority = "B";
  castSpell(g, "B", "snare", { t: "spellA" }, book);
  drain(g, book);
  assert.equal(g.mana["A"], 0, "色つきのマナで払えた");
  assert.equal(pool(g, "A").U, 0);
  assert.ok(g.log.some((l) => l.includes("を支払い")), "払われたので、打ち消されない");
}
// ---- レビュー: 制限つきの「好きな色」より、自分の色つきマナを先に使う / 混成マナは組み合わせを探す
{
  const g = createGame(["A", "B"]);
  g.payManaCosts = true;
  g.mana["A"] = 1;
  g.pool["A"] = { U: 1 };
  g.restrictedMana["A"] = [{ amount: 1, color: "A", type: "creature" }];
  g.hands["A"].push(card("c", "Creature — Bear", "A", { mv: 2, manaCost: "{U}{R}" }));
  castSpell(g, "A", "c", {}, rulesOf({ c: [] }));
  assert.equal(g.mana["A"], 0, "青は自分のマナ、赤は制限つきの好きな色");
  assert.equal(g.restrictedMana["A"].length, 0);
}
{
  const make = (colors: Record<string, number>, manaCost: string, mana = 2) => {
    const g = createGame(["A", "B"]);
    g.payManaCosts = true;
    g.mana["A"] = mana;
    g.pool["A"] = { ...colors };
    g.hands["A"].push(card("h", "Sorcery", "A", { mv: 2, manaCost }));
    return { g, book: rulesOf({ h: spell(call("draw", { player: "you", count: 0 })) }) };
  };
  const two = make({ U: 1, W: 1 }, "{U/W}{U/B}");
  castSpell(two.g, "A", "h", {}, two.book);
  assert.equal(two.g.mana["A"], 0, "白と青で払える (最初の選択肢だけを見ない)");
  const keep = make({ W: 1 }, "{2/W}", 3);
  castSpell(keep.g, "A", "h", {}, keep.book);
  assert.equal(keep.g.mana["A"], 2, "{2/W} は、白があれば白で払う (汎用2点を使わない)");
}

// ---- md の往復: manaCost の波かっこと、color
{
  const rule = { card: "X", abilities: [{ kind: "activated" as const, body: [call("cost", { manaCost: "{1}{U}", tap: true }), call("addMana", { amount: 1, color: "any" })] }] };
  const again = parseRule(writeRule(rule));
  assert.deepEqual(again.abilities[0].body.map((c) => c.args), rule.abilities[0].body.map((c) => c.args));
}
console.log("batch8 ok");
