import assert from "node:assert";
import { readFileSync } from "node:fs";
import { characteristics } from "../src/battle/continuous";
import { RuleError, activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// ルールは、実際の Rules/ のノートをそのまま読む (Bant Hatebears D: Time Walk・Oko・Food・Endurance・Sylvan Library)
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const REAL = ["Mox Emerald", "Time Walk", "Oko, Thief of Crowns", "Food", "Endurance", "Sylvan Library"];
const rules: RuleBook = { get: (c) => (REAL.includes(c) ? parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")) : undefined) };
const card = (id: string, name: string, typeLine: string, mv: number, owner = "you", extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv, owner, ...extra });
const perm = (c: GameCard, extra: Partial<Perm> = {}): Perm => ({ id: c.id, card: c, controller: c.owner, enteredTurn: 0, ...extra });
const make = (): Game => {
  const g = createGame(["you", "opp"]);
  g.turn = 4;
  g.step = "main1";
  g.libraries["you"] = Array.from({ length: 8 }, (_, i) => card(`L${i}`, `L${i}`, "Land", 0));
  g.libraries["opp"] = Array.from({ length: 8 }, (_, i) => card(`O${i}`, `O${i}`, "Land", 0, "opp"));
  return g;
};
const resolveAll = (g: Game) => {
  for (let i = 0; g.stack.length && i < 20; i++) passPriority(g, g.priority!, rules);
};
const endTurn = (g: Game) => {
  g.step = "end";
  g.stack = [];
  g.priority = g.active;
  passPriority(g, g.active, rules);
  passPriority(g, g.priority!, rules);
};

// ---- Time Walk: このターンの次に、追加のターン
{
  const g = make();
  g.active = "you";
  g.hands["you"] = [card("TW", "Time Walk", "Sorcery", 2)];
  castSpell(g, "you", "TW", {}, rules);
  resolveAll(g);
  assert.deepEqual(g.extraTurns, ["you"]);
  const t = g.turn;
  endTurn(g);
  assert.equal(g.active, "you", "もう一度、自分のターン");
  assert.equal(g.turn, t + 1);
  assert.deepEqual(g.extraTurns, []);
  endTurn(g);
  assert.equal(g.active, "opp", "そのあとは、相手のターン");
}

// ---- Oko: +2 Food、+1 Elk、−5 交換
const oko = (g: Game, loyalty: number) => g.battlefield.push(perm(card("OK", "Oko, Thief of Crowns", "Legendary Planeswalker — Oko", 3, "you", { loyalty: 4 }), { counters: { loyalty } }));
{
  const g = make();
  g.active = "you";
  oko(g, 4);
  activateAbility(g, "you", "OK", 0, {}, rules);
  resolveAll(g);
  const food = g.battlefield.find((p) => p.card.name === "Food");
  assert.ok(food, "Food が出た");
  assert.equal(g.battlefield.find((p) => p.id === "OK")!.counters!.loyalty, 6);
  // Food: {2}, {T}, 生け贄: 3 点のライフ (Food のルールノートを読む)
  g.mana["you"] = 2;
  activateAbility(g, "you", food!.id, 0, {}, rules);
  resolveAll(g);
  assert.equal(g.life["you"], 23, "3 点のライフを得た");
  assert.ok(!g.battlefield.some((p) => p.id === food!.id), "Food は、生け贄に捧げられた");
}
{
  // +1: アーティファクトやクリーチャーが、緑の 3/3 の Elk になり、すべての能力を失う
  const g = make();
  g.active = "you";
  oko(g, 4);
  g.battlefield.push(perm(card("FD", "Food", "Artifact — Food", 0, "opp", { token: true })), perm(card("Bear", "Bear", "Creature — Bear", 2, "opp", { power: 2, toughness: 2, colors: ["W"], keywords: ["flying"] })));
  activateAbility(g, "you", "OK", 1, { t: "Bear" }, rules);
  resolveAll(g);
  const now = characteristics(g, g.battlefield.find((p) => p.id === "Bear")!, rules);
  assert.deepEqual([now.typeLine, now.colors, now.power, now.toughness, now.keywords, now.lostAbilities], ["Creature — Elk", ["G"], 3, 3, [], true]);
  // ターンが替わっても、そのまま (forever)
  endTurn(g);
  assert.equal(characteristics(g, g.battlefield.find((p) => p.id === "Bear")!, rules).typeLine, "Creature — Elk");
  // アーティファクトも、クリーチャーになる
  g.active = "you";
  g.step = "main1";
  g.priority = "you";
  g.battlefield.find((p) => p.id === "OK")!.loyaltyUsed = false;
  activateAbility(g, "you", "OK", 1, { t: "FD" }, rules);
  resolveAll(g);
  assert.equal(characteristics(g, g.battlefield.find((p) => p.id === "FD")!, rules).typeLine, "Creature — Elk");
}
{
  // −5: 自分のクリーチャー (またはアーティファクト) と、相手のパワー 3 以下のクリーチャーを、交換
  const g = make();
  g.active = "you";
  oko(g, 6);
  g.battlefield.push(perm(card("Mine", "Mine", "Creature — Bear", 1, "you", { power: 1, toughness: 1 })), perm(card("Big", "Big", "Creature — Giant", 5, "opp", { power: 4, toughness: 4 })), perm(card("Small", "Small", "Creature — Giant", 3, "opp", { power: 3, toughness: 3 })));
  assert.throws(() => activateAbility(g, "you", "OK", 2, { a: "Mine", b: "Big" }, rules), (e) => e instanceof RuleError, "パワー 4 は、対象にできない");
  activateAbility(g, "you", "OK", 2, { a: "Mine", b: "Small" }, rules);
  resolveAll(g);
  const c = (id: string) => g.battlefield.find((p) => p.id === id)!.controller;
  assert.deepEqual([c("Mine"), c("Small"), c("Big")], ["opp", "you", "opp"], "交換された");
  assert.equal(g.battlefield.find((p) => p.id === "OK")!.counters!.loyalty, 1);
}

{
  // +1 で大鹿になった Mox Emerald は、すべての能力を失うので、マナを出せない
  const g = make();
  g.active = "you";
  oko(g, 4);
  g.battlefield.push(perm(card("MX", "Mox Emerald", "Artifact", 0)));
  g.priority = "you";
  activateAbility(g, "you", "MX", 0, {}, rules);
  assert.equal(g.mana["you"], 1, "大鹿にする前は、マナを出せる");
  g.battlefield.find((p) => p.id === "MX")!.tapped = false;
  g.mana["you"] = 0;
  g.pool["you"] = {};
  activateAbility(g, "you", "OK", 1, { t: "MX" }, rules);
  resolveAll(g);
  g.priority = "you";
  assert.throws(() => activateAbility(g, "you", "MX", 0, {}, rules), (e) => e instanceof RuleError && /すべての能力を失っている/.test(e.message), "能力を失ったので、起動できない");
  assert.equal(g.mana["you"], 0);
}

// ---- Endurance: 出たとき、対象のプレイヤーの墓地を、ランダムな順でライブラリーの一番下へ
const cast = (g: Game) => {
  g.active = "you";
  g.priority = "you";
  g.hands["you"] = [card("EN", "Endurance", "Creature — Elemental Incarnation", 3, "you", { power: 3, toughness: 4 })];
  castSpell(g, "you", "EN", {}, rules);
  resolveAll(g);
};
{
  const g = make();
  g.graveyards["opp"] = [card("G1", "G1", "Instant", 1, "opp"), card("G2", "G2", "Instant", 1, "opp"), card("G3", "G3", "Instant", 1, "opp")];
  g.decide = { target: () => ["opp"] };
  cast(g);
  assert.deepEqual(g.graveyards["opp"], [], "墓地は、空になった");
  assert.deepEqual(g.libraries["opp"].slice(-3).map((x) => x.id).sort(), ["G1", "G2", "G3"], "ライブラリーの一番下に、3 枚");
  assert.equal(g.libraries["opp"].length, 11);
  assert.ok(g.battlefield.some((p) => p.id === "EN"), "通常のコストで唱えたので、残る");
}
{
  // 対象を選ばなくてもよい (「最大 1 人」)
  const g = make();
  g.graveyards["opp"] = [card("G1", "G1", "Instant", 1, "opp")];
  g.decide = { target: () => [] };
  cast(g);
  assert.equal(g.graveyards["opp"].length, 1, "対象が無ければ、何も起きない");
}

// ---- Sylvan Library: ドロー・ステップに、2 枚追加で引き、そのうち 2 枚について、4 点のライフを払うか、一番上に置く
const toDraw = (g: Game) => {
  g.strictTurns = true;
  g.active = "you";
  g.step = "upkeep";
  g.stack = [];
  g.priority = "you";
  g.battlefield.push(perm(card("SL", "Sylvan Library", "Enchantment", 2)));
  passPriority(g, "you", rules);
  passPriority(g, "opp", rules);
  assert.equal(g.step, "draw");
  assert.equal(g.stack.length, 1, "Sylvan Library が誘発した");
};
{
  const g = make();
  g.hands["you"] = [];
  g.decide = { may: (_g, _p, what) => (what.includes("追加で引きますか") ? true : what.startsWith("L0") ? true : false) };
  toDraw(g);
  resolveAll(g);
  assert.equal(g.life["you"], 16, "L0 のために、4 点のライフを払った");
  assert.deepEqual(g.hands["you"].map((x) => x.id).sort(), ["L0", "L2"], "L0 は残り、L1 は、一番上に戻った");
  assert.equal(g.libraries["you"][0].id, "L1", "ライブラリーの一番上");
}
{
  // 引かないことも選べる
  const g = make();
  g.hands["you"] = [];
  g.decide = { may: () => false };
  toDraw(g);
  resolveAll(g);
  assert.deepEqual(g.hands["you"].map((x) => x.id), ["L0"], "ふつうのドローだけ");
  assert.equal(g.life["you"], 20);
}
{
  // ライフが足りないと、払えず、戻る。払うと答えても
  const g = make();
  g.hands["you"] = [];
  g.life["you"] = 3;
  g.decide = { may: () => true };
  toDraw(g);
  resolveAll(g);
  assert.equal(g.life["you"], 3);
  assert.deepEqual(g.hands["you"].map((x) => x.id), ["L2"], "2 枚とも戻る");
  assert.deepEqual(g.libraries["you"].slice(0, 2).map((x) => x.id).sort(), ["L0", "L1"]);
}
console.log("d ok");
