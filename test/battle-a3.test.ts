import assert from "node:assert";
import { readFileSync } from "node:fs";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// ルールは、実際の Rules/ のノートをそのまま読む (Bant Hatebears A-3: Swords to Plowshares)
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const rules: RuleBook = { get: (c) => (c === "Swords to Plowshares" ? parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")) : undefined) };
const card = (id: string, name: string, typeLine: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 2, owner, ...extra });
const perm = (c: GameCard, extra: Partial<Perm> = {}): Perm => ({ id: c.id, card: c, controller: c.owner, enteredTurn: 0, ...extra });
const make = (): { g: Game; c: BattleController } => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = false;
  g.turn = 3;
  g.step = "main1";
  g.mana["you"] = 1;
  g.libraries["you"] = [card("L", "L", "Land", "you")];
  g.libraries["opp"] = [card("O", "O", "Land", "opp")];
  g.hands["you"] = [card("StP", "Swords to Plowshares", "Instant", "you", { manaCost: "{W}" })];
  return { g, c: new BattleController(g, rules) };
};

// 検査: exile は、target か (zone と count) の、どちらかが要る
assert.equal(checkCall({ node: "exile", args: { target: { ref: "t" } } }), null);
assert.equal(checkCall({ node: "exile", args: { zone: "graveyard", count: 1 } }), null);
assert.ok(checkCall({ node: "exile", args: {} }), "どちらも無いのは、エラー");

// 相手の 3/3 を追放 → 相手 (コントローラー) が、そのパワー (3) のライフを得る。追放領域へ
{
  const { g, c } = make();
  g.battlefield.push(perm(card("Bear", "Bear", "Creature — Bear", "opp", { power: 3, toughness: 3 })));
  assert.equal(c.use("StP", { t: "Bear" }), undefined);
  c.next();
  assert.ok(!g.battlefield.some((p) => p.id === "Bear"), "戦場から消えた");
  assert.deepEqual(g.exile["opp"].map((x) => x.id), ["Bear"], "追放領域へ (墓地ではない)");
  assert.equal(g.graveyards["opp"].length, 0);
  assert.equal(g.life["opp"], 23, "相手が、3 点のライフを得た");
  assert.equal(g.life["you"], 20);
  assert.ok(g.graveyards["you"].some((x) => x.id === "StP"), "呪文は、墓地へ");
}
// 修整を受けたパワーを使う (+2/+2 の修整 → パワー 5)。追放の前に読む
{
  const { g, c } = make();
  g.battlefield.push(perm(card("Big", "Big", "Creature — Giant", "opp", { power: 3, toughness: 3 }), { mods: [{ power: 2, toughness: 2, until: "endOfTurn" }] }));
  c.use("StP", { t: "Big" });
  c.next();
  assert.equal(g.life["opp"], 25, "いまのパワー (5) のぶん");
}
// 自分のクリーチャーにも使える: 自分が、ライフを得る
{
  const { g, c } = make();
  g.battlefield.push(perm(card("Mine", "Mine", "Creature — Elf", "you", { power: 1, toughness: 1 })));
  c.use("StP", { t: "Mine" });
  c.next();
  assert.equal(g.life["you"], 21);
}
// トークンは、追放されると消える (追放領域に残らない)
{
  const { g, c } = make();
  g.battlefield.push(perm(card("Tok", "Elemental", "Creature — Elemental", "opp", { power: 2, toughness: 2, token: true })));
  c.use("StP", { t: "Tok" });
  c.next();
  assert.deepEqual(g.exile["opp"], []);
  assert.equal(g.life["opp"], 22);
}
// 対象は、クリーチャーだけ (土地・アーティファクトは、選べない)
{
  const { g, c } = make();
  g.battlefield.push(perm(card("Relic", "Relic", "Artifact", "opp")), perm(card("Bear", "Bear", "Creature — Bear", "opp", { power: 1, toughness: 1 })));
  assert.deepEqual(c.needsForCard("StP")[0].legal, ["Bear"]);
}
// 呪禁のクリーチャーは、相手の対象にならない (ルール通り)。対象が無くなった (解決前に消えた) ときは、何も起きない
{
  const { g, c } = make();
  g.battlefield.push(perm(card("Bear", "Bear", "Creature — Bear", "opp", { power: 3, toughness: 3 })));
  c.use("StP", { t: "Bear" });
  g.battlefield = g.battlefield.filter((p) => p.id !== "Bear"); // 解決の前に、いなくなった
  c.next();
  assert.equal(g.life["opp"], 20, "ライフは、変わらない");
}
// 墓地の追放 (これまでの使い方) は、そのまま動く
{
  const { g } = make();
  g.graveyards["you"] = [card("G1", "G1", "Instant", "you"), card("G2", "G2", "Instant", "you")];
  const rule = parseRule(`---\nmtg: rule\ncard: "[[Cost]]"\n---\n\n## 呪文能力\n\n- exile zone=graveyard count=2 as=x\n- draw player=you count=1 if=$x\n`);
  const book: RuleBook = { get: (c) => (c === "Cost" ? rule : undefined) };
  g.hands["you"] = [card("Cost", "Cost", "Instant", "you")];
  const c = new BattleController(g, book);
  c.use("Cost");
  c.next();
  assert.deepEqual(g.exile["you"].map((x) => x.id), ["G1", "G2"]);
}
console.log("a3 ok");
