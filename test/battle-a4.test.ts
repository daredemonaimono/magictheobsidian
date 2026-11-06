import assert from "node:assert";
import { readFileSync } from "node:fs";
import { activateAbility, declareAttackers } from "../src/battle/engine";
import { parseManaCost, trySpend } from "../src/battle/mana";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// ルールは、実際の Rules/ のノートをそのまま読む (Bant Hatebears A-4: Noble Hierarch)
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const rules: RuleBook = { get: (c) => (c === "Noble Hierarch" ? parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")) : undefined) };
const card = (id: string, name: string, typeLine: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 1, owner: "you", ...extra });
const perm = (c: GameCard, extra: Partial<Perm> = {}): Perm => ({ id: c.id, card: c, controller: c.owner, enteredTurn: 0, ...extra });
const hierarch = () => perm(card("NH", "Noble Hierarch", "Creature — Human Druid", { power: 0, toughness: 1 }));
const bear = () => perm(card("Bear", "Bear", "Creature — Bear", { power: 2, toughness: 2 }));
const make = (): { g: Game; c: BattleController } => {
  const g = createGame(["you", "opp"]);
  g.turn = 3;
  g.step = "main1";
  g.libraries["you"] = [card("L", "L", "Land")];
  g.libraries["opp"] = [card("O", "O", "Land", { owner: "opp" })];
  return { g, c: new BattleController(g, rules) };
};
const pays = (g: Game, cost: string, commit = false) => trySpend(g, "you", parseManaCost(cost), undefined, commit);

// {T}: {G}・{W}・{U} のどれか1色。{B}・{R} には、使えない
{
  const { g } = make();
  g.battlefield.push(hierarch());
  activateAbility(g, "you", "NH", 0, {}, rules); // 使い道の確認は画面の仕事。ここは、エンジンを直接
  assert.equal(g.mana["you"], 1);
  assert.equal(g.stack.length, 0, "マナ能力は、スタックを使わない");
  assert.ok(pays(g, "{G}") && pays(g, "{W}") && pays(g, "{U}") && pays(g, "{1}"), "G・W・U・汎用 に使える");
  assert.ok(!pays(g, "{B}") && !pays(g, "{R}"), "B・R には使えない");
  assert.ok(pays(g, "{W}", true));
  assert.equal(g.mana["you"], 0, "払うとマナが減る");
}
// 召喚酔いで、タップ能力は使えない (クリーチャーだから): ここでは出たばかりの扱いを、エンジンに任せる

// Exalted: 1体だけで攻撃 → そのクリーチャーが +1/+1 (Noble Hierarch が攻撃しなくても、自分のどのクリーチャーでも)
const attack = (g: Game, ids: string[]) => {
  g.step = "combat";
  g.combatPhase = "attackers";
  declareAttackers(g, "you", ids.map((id) => ({ id })), rules);
};
{
  const { g, c } = make();
  g.battlefield.push(hierarch(), bear());
  attack(g, ["Bear"]);
  assert.equal(g.stack.length, 1, "Exalted が誘発した");
  c.next();
  const b = g.battlefield.find((p) => p.id === "Bear")!;
  assert.deepEqual(b.mods?.map((m) => [m.power, m.toughness]), [[1, 1]], "攻撃したクリーチャーが +1/+1");
  assert.equal(g.battlefield.find((p) => p.id === "NH")!.mods, undefined, "Hierarch 自身は、そのまま");
}
// 2体以上で攻撃したら、誘発しない
{
  const { g } = make();
  const b2 = { ...bear(), id: "Bear2", card: { ...bear().card, id: "Bear2" } };
  g.battlefield.push(hierarch(), bear(), b2);
  attack(g, ["Bear", "Bear2"]);
  assert.equal(g.stack.length, 0, "2体で攻撃 → 誘発しない");
}
// 相手のクリーチャーが攻撃しても、誘発しない (who=you)
{
  const { g } = make();
  g.battlefield.push(hierarch(), { ...bear(), controller: "opp", card: { ...bear().card, owner: "opp" } });
  g.active = "opp";
  g.step = "combat";
  g.combatPhase = "attackers";
  declareAttackers(g, "opp", [{ id: "Bear" }], rules);
  assert.equal(g.stack.length, 0);
}
// Hierarch が 2 体 (Exalted は、重なる): +2/+2
{
  const { g, c } = make();
  const h2 = { ...hierarch(), id: "NH2", card: { ...hierarch().card, id: "NH2" } };
  g.battlefield.push(hierarch(), h2, bear());
  attack(g, ["Bear"]);
  assert.equal(g.stack.length, 2);
  c.next();
  c.next();
  assert.equal(g.battlefield.find((p) => p.id === "Bear")!.mods?.length, 2);
}
console.log("a4 ok");

// 伝説のクリーチャー: 名前に「, 」(カンマと空白) が入る id でも、Exalted の +1/+1 が付く (id をカンマでつなぐので、割れないこと)
{
  const { g, c } = make();
  const legend = perm(card("you:Lavinia, Azorius Renegade#5", "Lavinia, Azorius Renegade", "Legendary Creature — Human Soldier", { power: 2, toughness: 2 }));
  g.battlefield.push(hierarch(), legend);
  attack(g, [legend.id]);
  assert.equal(g.stack.length, 1, "Exalted が誘発した");
  c.next();
  assert.deepEqual(g.battlefield.find((p) => p.id === legend.id)!.mods?.map((m) => [m.power, m.toughness]), [[1, 1]], "カンマの入った id でも、攻撃したクリーチャーが +1/+1");
}
{
  const { splitIds } = await import("../src/battle/state");
  assert.deepEqual(splitIds("you:Oko, Thief of Crowns#3,you:Bear#4"), ["you:Oko, Thief of Crowns#3", "you:Bear#4"], "名前のカンマでは割らず、id の区切りだけで割る");
  assert.deepEqual(splitIds("A1,A4"), ["A1", "A4"]);
  assert.deepEqual(splitIds(""), []);
}
console.log("a4 legend ok");
