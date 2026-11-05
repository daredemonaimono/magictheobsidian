import assert from "node:assert";
import { readFileSync } from "node:fs";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// ルールは、実際の Rules/ のノートをそのまま読む (Bant Hatebears A-2: フェッチランド・Wasteland・Strip Mine・Force of Vigor)
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const NAMES = ["Misty Rainforest", "Windswept Heath", "Wasteland", "Strip Mine", "Force of Vigor"];
const rules: RuleBook = { get: (c) => (NAMES.includes(c) ? parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")) : undefined) };
const card = (id: string, name: string, typeLine: string, owner = "you", extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 0, owner, ...extra });
const perm = (c: GameCard, extra: Partial<Perm> = {}): Perm => ({ id: c.id, card: c, controller: c.owner, enteredTurn: 0, ...extra });
const make = (): { g: Game; c: BattleController } => {
  const g = createGame(["you", "opp"]);
  g.turn = 3;
  g.step = "main1";
  g.libraries["you"] = [card("F1", "Forest", "Basic Land — Forest"), card("I1", "Island", "Basic Land — Island"), card("P1", "Plains", "Basic Land — Plains"), card("B1", "Bear", "Creature — Bear")];
  g.libraries["opp"] = [card("O", "X", "Land", "opp")];
  return { g, c: new BattleController(g, rules) };
};

// フェッチランド: タップして生け贄、ライフ 1 点を払う → ライブラリーから Forest か Island を探して、戦場に → 切る
{
  const { g, c } = make();
  const fetch = card("Misty", "Misty Rainforest", "Land");
  g.battlefield.push(perm(fetch));
  assert.equal(c.activate("Misty", 0), undefined);
  assert.equal(g.life["you"], 19, "ライフ 1 点を払った");
  assert.ok(!g.battlefield.some((p) => p.id === "Misty"), "生け贄に捧げた");
  assert.deepEqual(g.graveyards["you"].map((x) => x.id), ["Misty"]);
  assert.equal(g.stack.length, 1, "能力がスタックに");
  c.next();
  const req = c.pending!.request;
  assert.ok(req.kind === "choose" && req.min === 0 && req.max === 1, "探すカードを選ぶ (見つけなくてもよい)");
  assert.deepEqual(req.cards.map((x) => x.id).sort(), ["F1", "I1"], "Forest か Island だけ (Plains・Bear は、探せない)");
  c.answer(["I1"]);
  assert.ok(g.battlefield.some((p) => p.id === "I1" && !p.tapped), "Island が、アンタップで、戦場に");
  assert.ok(!g.libraries["you"].some((x) => x.id === "I1"));
  assert.ok(g.log.some((l) => l.includes("Island を戦場に置いた")));
  assert.ok(g.log.includes("自分のライブラリーを切った") === false, "探した結果の行のあと、切る (切るのは、search の中)");
}
// ライフが 0 のとき、ライフを払うコストは、払えない (状態は変わらない)
{
  const { g, c } = make();
  g.battlefield.push(perm(card("Misty", "Misty Rainforest", "Land")));
  g.life["you"] = 0;
  assert.ok(c.activate("Misty", 0)?.includes("ライフが足りない"));
  assert.ok(g.battlefield.some((p) => p.id === "Misty"), "生け贄に捧げていない");
}
// 探さない (0 枚)・見つからない (条件に合うカードが無い): それでも、切る・落ちない
{
  const { g, c } = make();
  g.libraries["you"] = [card("B1", "Bear", "Creature — Bear")];
  g.battlefield.push(perm(card("Heath", "Windswept Heath", "Land")));
  assert.equal(c.activate("Heath", 0), undefined);
  c.next();
  assert.equal(c.pending, undefined, "選べるカードが無ければ、聞かない (見つからなかった)");
  assert.ok(g.log.some((l) => l.includes("何も戦場に置かなかった")));
}
// Windswept Heath は、Forest か Plains
{
  const { g, c } = make();
  g.battlefield.push(perm(card("Heath", "Windswept Heath", "Land")));
  c.activate("Heath", 0);
  c.next();
  assert.deepEqual((c.pending!.request as { cards: { id: string }[] }).cards.map((x) => x.id).sort(), ["F1", "P1"]);
}
// Wasteland: 土地を生け贄 → 基本でない土地を破壊。基本土地は、対象にできない
{
  const { g, c } = make();
  g.battlefield.push(perm(card("W", "Wasteland", "Land")), perm(card("Basic", "Island", "Basic Land — Island", "opp")), perm(card("Dual", "Tundra", "Land — Plains Island", "opp")));
  const slots = c.needsForAbility("W", 1);
  assert.deepEqual([...slots[0].legal].sort(), ["Dual", "W"], "基本土地は、対象にできない (Wasteland 自身は、基本でないので、対象にできる: ルール通り。生け贄に捧げると、対象が無くなる)");
  assert.equal(c.activate("W", 1, { t: "Dual" }), undefined);
  assert.ok(!g.battlefield.some((p) => p.id === "W"), "Wasteland は、生け贄に捧げられた");
  c.next();
  assert.ok(!g.battlefield.some((p) => p.id === "Dual"), "Tundra が、破壊された");
  assert.deepEqual(g.graveyards["opp"].map((x) => x.id), ["Dual"]);
  assert.ok(g.battlefield.some((p) => p.id === "Basic"));
}
// Strip Mine: どの土地でも、対象にできる
{
  const { g, c } = make();
  g.battlefield.push(perm(card("S", "Strip Mine", "Land")), perm(card("Basic", "Island", "Basic Land — Island", "opp")));
  assert.deepEqual([...c.needsForAbility("S", 1)[0].legal].sort(), ["Basic", "S"], "どの土地でも、対象にできる");
  c.activate("S", 1, { t: "Basic" });
  c.next();
  assert.ok(!g.battlefield.some((p) => p.id === "Basic"));
}
// Force of Vigor: アーティファクトかエンチャントを、最大 2 つ破壊 (破壊不能は、破壊されない)
{
  const { g, c } = make();
  g.payManaCosts = false;
  g.mana["you"] = 4;
  g.hands["you"] = [card("FV", "Force of Vigor", "Instant", "you", { manaCost: "{2}{G}{G}" })];
  g.battlefield.push(perm(card("A1", "Relic", "Artifact", "opp")), perm(card("A2", "Aura", "Enchantment — Aura", "opp")), perm(card("A3", "Bear", "Creature — Bear", "opp")), perm(card("A4", "Hard", "Artifact", "opp", { keywords: ["indestructible"] })));
  const slot = c.needsForCard("FV")[0];
  assert.deepEqual(slot.legal.sort(), ["A1", "A2", "A4"], "クリーチャーは、対象にできない");
  assert.equal(slot.max, 2);
  assert.equal(c.use("FV", { t: "A1,A4" }), undefined);
  c.next();
  assert.ok(!g.battlefield.some((p) => p.id === "A1"), "Relic は、破壊された");
  assert.ok(g.battlefield.some((p) => p.id === "A4"), "破壊不能は、残る");
}
console.log("a2 ok");
