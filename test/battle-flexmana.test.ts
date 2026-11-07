import assert from "node:assert";
import { readFileSync } from "node:fs";
import { tryWithMana } from "../src/battle/actions";
import { tapFor } from "../src/battle/cpu";
import { castSpell, passPriority } from "../src/battle/engine";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// デュアルランド (マナ能力が 2 つ: {T}: G / {T}: U): 払うとき、必要な色を出せる。以前は、最初の能力 (G) だけが使われて、{U} の呪文を唱えられなかった
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const rules: RuleBook = { get: (c) => { try { return parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")); } catch { return undefined; } } };
const card = (id: string, name: string, typeLine: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 0, owner: "you", ...extra });
const make = (...lands: string[]) => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = true;
  g.skipUnruled = true; // ルールの無い呪文 (Spell) も、唱えられる
  g.step = "main1";
  g.active = "you";
  g.priority = "you";
  g.libraries["you"] = Array.from({ length: 6 }, (_, i) => card(`L${i}`, "Island", "Basic Land — Island"));
  lands.forEach((n, i) => g.battlefield.push({ id: `${n}${i}`, card: card(`${n}${i}`, n, "Land — Forest Island"), controller: "you", enteredTurn: 0 }));
  return g;
};
const ancestral = () => card("Ancestral Recall", "Ancestral Recall", "Instant", { mv: 1, manaCost: "{U}" });

// Tropical Island 1 枚で、Ancestral Recall ({U})
{
  const g = make("Tropical Island");
  g.hands["you"] = [ancestral()];
  g.libraries["opp"] = [];
  assert.equal(tryWithMana(g, rules, "you", { kind: "cast", card: "Ancestral Recall" }), undefined, "マナを全部出せば、唱えられる");
  tapFor(g, rules, "you", { kind: "cast", card: "Ancestral Recall" }, { t: "you" });
  castSpell(g, "you", "Ancestral Recall", { t: "you" }, rules);
  for (let i = 0; g.stack.length && i < 10; i++) passPriority(g, g.priority!, rules);
  assert.equal(g.hands["you"].length, 3, "3 枚引いた");
  assert.equal(g.battlefield[0].tapped, true, "土地がタップされた");
}
// 画面のコントローラーも、「使えない理由」を出さない
{
  const g = make("Tropical Island", "Tropical Island", "Tropical Island");
  g.hands["you"] = [ancestral()];
  const c = new BattleController(g, rules, "you");
  assert.equal(c.whyNot("Ancestral Recall"), undefined);
}
// 色を使い分ける: {G}{U} を、Tropical Island 2 枚で払える。{U}{U} も、{G}{G} も
{
  for (const cost of ["{G}{U}", "{U}{U}", "{G}{G}"]) {
    const g = make("Tropical Island", "Tropical Island");
    g.hands["you"] = [card("Spell", "Spell", "Instant", { mv: 2, manaCost: cost })];
    assert.equal(tryWithMana(g, rules, "you", { kind: "cast", card: "Spell" }), undefined, cost);
  }
  // 3 つ目の色が要る呪文は、2 枚では払えない
  const g = make("Tropical Island", "Tropical Island");
  g.hands["you"] = [card("Spell", "Spell", "Instant", { mv: 2, manaCost: "{W}{U}" })];
  assert.notEqual(tryWithMana(g, rules, "you", { kind: "cast", card: "Spell" }), undefined, "W は出せない");
}
// Tundra (W / U) と Tropical Island (G / U): 混ぜて、{W}{G}{U}
{
  const g = make("Tundra", "Tropical Island", "Tropical Island");
  g.hands["you"] = [card("Spell", "Spell", "Instant", { mv: 3, manaCost: "{W}{G}{U}" })];
  assert.equal(tryWithMana(g, rules, "you", { kind: "cast", card: "Spell" }), undefined);
}
console.log("battle-flexmana ok");
