import assert from "node:assert";
import { readFileSync } from "node:fs";
import { castSpell, passPriority } from "../src/battle/engine";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// ルールは、実際の Rules/ のノートをそのまま読む (Bant Hatebears B-1: 別のコスト)。相手の呪文だけ、テスト用に書く
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const REAL = ["Force of Will", "Force of Negation", "Force of Vigor", "Endurance"];
const FAKE: Record<string, string> = {
  "Opp Instant": "---\nmtg: rule\ncard: \"[[Opp Instant]]\"\n---\n\n## 呪文能力\n\n- draw player=you count=1\n",
  "Opp Creature": "---\nmtg: rule\ncard: \"[[Opp Creature]]\"\n---\n\n## 常在型能力\n\n- keyword name=flash\n",
};
const rules: RuleBook = { get: (c) => (REAL.includes(c) ? parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")) : FAKE[c] ? parseRule(FAKE[c]) : undefined) };
const card = (id: string, name: string, typeLine: string, manaCost: string, mv: number, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, manaCost, mv, owner: "you", ...extra });
const FOW = () => card("FOW", "Force of Will", "Instant", "{3}{U}{U}", 5);
const FON = () => card("FON", "Force of Negation", "Instant", "{1}{U}{U}", 3);
const BLUE = (id = "BS") => card(id, "Brainstorm", "Instant", "{U}", 1);
const GREEN = (id = "GR") => card(id, "Giant Growth", "Instant", "{G}", 1);
const RED = () => card("RD", "Bolt", "Instant", "{R}", 1);
const make = (): { g: Game; c: BattleController } => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = true; // 別のコストの意味は、マナコストを払うときにある
  g.turn = 4;
  g.libraries["you"] = [card("L", "L", "Land", "", 0)];
  g.libraries["opp"] = [card("O", "O", "Land", "", 0, { owner: "opp" })];
  return { g, c: new BattleController(g, rules) };
};
// 相手が呪文を唱えて、こちらに優先権が来る
const oppCasts = (g: Game, name: string, typeLine: string) => {
  g.active = "opp";
  g.step = "main1";
  g.priority = "opp";
  g.hands["opp"] = [card("OS", name, typeLine, "{2}", 2, { owner: "opp" })];
  g.payManaCosts = false;
  castSpell(g, "opp", "OS", {}, rules);
  g.payManaCosts = true;
  passPriority(g, "opp", rules);
  assert.equal(g.priority, "you");
};
const resolveAll = (g: Game) => {
  for (let i = 0; g.stack.length && i < 20; i++) passPriority(g, g.priority!, rules);
};

// Force of Will: マナ無しで、青いカード1枚を追放し、1 ライフを払って、打ち消す
{
  const { g, c } = make();
  g.hands["you"] = [FOW(), BLUE(), RED()];
  oppCasts(g, "Opp Instant", "Instant");
  assert.equal(c.whyNot("FOW"), undefined, "マナが無くても、別のコストなら唱えられる");
  assert.deepEqual(c.kickChoices("FOW").map((x) => x.flag), ["alt"]);
  assert.equal(c.canCastNormally("FOW"), false);
  assert.deepEqual(c.pitchChoices("FOW")!.cards.map((x) => x.id), ["BS"], "追放できるのは、青いカードだけ (赤は不可)");
  assert.equal(c.use("FOW", { t: "OS" }, { alt: true }), undefined);
  assert.equal(g.life["you"], 19, "1 ライフを払った");
  assert.deepEqual(g.exile["you"].map((x) => x.id), ["BS"], "青いカードを追放した");
  assert.deepEqual(g.hands["you"].map((x) => x.id).sort(), ["RD"], "手札に、赤のカードだけ残る");
  resolveAll(g);
  assert.deepEqual(g.graveyards["opp"].map((x) => x.id), ["OS"], "相手の呪文は、打ち消されて、墓地へ");
  assert.ok(g.graveyards["you"].some((x) => x.id === "FOW"));
}
// 追放するカードを選べる (青が2枚)
{
  const { g, c } = make();
  g.hands["you"] = [FOW(), BLUE("B1"), BLUE("B2")];
  oppCasts(g, "Opp Instant", "Instant");
  assert.equal(c.pitchChoices("FOW")!.cards.length, 2);
  assert.equal(c.use("FOW", { t: "OS" }, { alt: true, exile: ["B2"] }), undefined);
  assert.deepEqual(g.exile["you"].map((x) => x.id), ["B2"], "選んだほうを追放");
}
// 青いカードが無いと、別のコストでは唱えられない。唱える呪文自身は、数えない (Force of Will 2枚で、1枚をもう1枚の代わりには、できる)
{
  const { g, c } = make();
  g.hands["you"] = [FOW(), RED()];
  oppCasts(g, "Opp Instant", "Instant");
  assert.ok(c.whyNot("FOW"), "青いカードが無い → 唱えられない");
  assert.deepEqual(c.kickChoices("FOW"), []);
  assert.ok(c.use("FOW", { t: "OS" }, { alt: true }), "強行しても、失敗する");
  assert.equal(g.life["you"], 20);
}
{
  const { g, c } = make();
  g.hands["you"] = [FOW(), { ...FOW(), id: "FOW2" }];
  oppCasts(g, "Opp Instant", "Instant");
  assert.deepEqual(c.pitchChoices("FOW")!.cards.map((x) => x.id), ["FOW2"], "自分自身は、追放できない");
}
// 通常のマナを払える (別のコストを選ばない) ときは、マナを払う。ライフは減らない
{
  const { g, c } = make();
  g.hands["you"] = [FOW(), BLUE()];
  g.mana["you"] = 5;
  g.pool["you"] = { U: 2 };
  oppCasts(g, "Opp Instant", "Instant");
  assert.deepEqual(c.kickChoices("FOW").map((x) => x.flag), ["alt"]);
  assert.equal(c.canCastNormally("FOW"), true);
  assert.equal(c.use("FOW", { t: "OS" }), undefined);
  assert.equal(g.life["you"], 20);
  assert.equal(g.exile["you"].length, 0);
  assert.equal(g.mana["you"], 0);
}
// Force of Negation: 自分のターンには使えない。相手のターンに、クリーチャーでない呪文を打ち消して、追放
{
  const { g, c } = make();
  g.hands["you"] = [FON(), BLUE()];
  oppCasts(g, "Opp Instant", "Instant");
  assert.equal(g.active, "opp");
  assert.equal(c.use("FON", { t: "OS" }, { alt: true }), undefined);
  assert.equal(g.life["you"], 20, "ライフは払わない");
  assert.deepEqual(g.exile["you"].map((x) => x.id), ["BS"]);
  resolveAll(g);
  assert.deepEqual(g.exile["opp"].map((x) => x.id), ["OS"], "打ち消された呪文は、墓地でなく、追放");
  assert.equal(g.graveyards["opp"].length, 0);
}
{
  // 自分のターン (自分が唱えた呪文にも、使えない)
  const { g, c } = make();
  g.hands["you"] = [FON(), BLUE()];
  oppCasts(g, "Opp Instant", "Instant");
  g.active = "you";
  assert.ok(c.whyNot("FON"), "自分のターンは、別のコストでは唱えられない");
  assert.deepEqual(c.kickChoices("FON"), []);
}
{
  // クリーチャー呪文は、対象にできない
  const { g, c } = make();
  g.hands["you"] = [FON(), BLUE()];
  oppCasts(g, "Opp Creature", "Creature — Bear");
  assert.ok(c.whyNot("FON"), "対象にできる呪文が無い");
}
// Force of Vigor: 緑のカード・相手のターン
{
  const { g, c } = make();
  g.hands["you"] = [card("FV", "Force of Vigor", "Instant", "{2}{G}{G}", 4), GREEN(), BLUE()];
  g.active = "opp";
  g.battlefield.push({ id: "Art", card: card("Art", "Relic", "Artifact", "{1}", 1, { owner: "opp" }), controller: "opp", enteredTurn: 0 });
  g.priority = "you";
  assert.deepEqual(c.pitchChoices("FV")!.cards.map((x) => x.id), ["GR"], "緑のカードだけ");
  assert.equal(c.use("FV", { t: "Art" }, { alt: true }), undefined);
  resolveAll(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Art"), "アーティファクトを破壊した");
  assert.deepEqual(g.exile["you"].map((x) => x.id), ["GR"]);
}
// Endurance: 緑のカードを追放して唱える (召喚者)。出たら、生け贄に捧げる。通常のコストで唱えたら、残る
{
  const { g, c } = make();
  g.active = "you";
  g.step = "main1";
  g.priority = "you";
  g.hands["you"] = [card("End", "Endurance", "Creature — Elemental Incarnation", "{1}{G}{G}", 3, { power: 3, toughness: 4 }), GREEN()];
  assert.equal(c.whyNot("End"), undefined);
  assert.equal(c.use("End", {}, { alt: true }), undefined);
  assert.deepEqual(g.exile["you"].map((x) => x.id), ["GR"]);
  g.decide = { target: () => ["opp"] }; // Endurance の「墓地を底へ」は、相手を選ぶ (自分を選ぶと、生け贄の Endurance 自身も、底に行く)
  resolveAll(g);
  assert.ok(!g.battlefield.some((p) => p.id === "End"), "召喚で出たら、生け贄に捧げられる");
  assert.ok(g.graveyards["you"].some((x) => x.id === "End"));
}
{
  const { g, c } = make();
  g.payManaCosts = false; // マナの代わりに、通常の唱え方を確かめる
  g.active = "you";
  g.step = "main1";
  g.priority = "you";
  g.hands["you"] = [card("End", "Endurance", "Creature — Elemental Incarnation", "{1}{G}{G}", 3, { power: 3, toughness: 4 })];
  assert.equal(c.use("End"), undefined);
  resolveAll(g);
  assert.ok(g.battlefield.some((p) => p.id === "End"), "通常のコストなら、残る");
}
console.log("b1 ok");
