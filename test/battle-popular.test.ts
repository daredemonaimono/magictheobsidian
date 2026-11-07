import assert from "node:assert";
import { withBuiltinRules } from "../src/battle/builtinRules";
import { characteristics } from "../src/battle/continuous";
import { activateAbility, castSpell, declareAttackers, declareBlockers, passPriority } from "../src/battle/engine";
import { enterBattlefield } from "../src/battle/engine/battlefield";
import { flushEvents } from "../src/battle/engine/triggers";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";
import { canBlock } from "../src/battle/engine/combat";

resetRegistry();
registerBuiltinNodes();

// 人気カードの効果のための、新しいノード (docs/node-gap-analysis.md の上位): 数で変わる修整・能力つきトークン・生け贄のコスト・置換効果 (量を変える)・探検・集結・暗躍・増強・このターンの出来事・回避・バウンス・コピー
const md = (name: string, body: string) => parseRule(`---\nmtg: rule\ncard: "[[${name}]]"\n---\n\n${body}`);
const book = (m: Record<string, string>): RuleBook => {
  const rs = new Map(Object.entries(m).map(([k, v]) => [k, md(k, v)]));
  for (const r of rs.values()) for (const ab of r.abilities) for (const c of ab.body) assert.equal(checkCall(c), null, `${r.card}: ${c.node} の書き方が違う`);
  return withBuiltinRules({ get: (c) => rs.get(c) });
};
const C = (id: string, name: string, typeLine: string, owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 1, owner, ...extra });
const setup = () => {
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  return g;
};
const drain = (g: Game, rules: RuleBook) => {
  for (let i = 0; g.stack.length && i < 40; i++) passPriority(g, g.priority!, rules);
};
const enter = (g: Game, rules: RuleBook, c: GameCard, owner = "A") => {
  enterBattlefield(g, c, owner, rules);
  flushEvents(g, rules);
  drain(g, rules);
  return g.battlefield.find((p) => p.id === c.id)!;
};
const spell = (g: Game, rules: RuleBook, name: string, targets: Record<string, string> = {}, owner = "A") => {
  g.hands[owner].push(C(`sp-${name}-${g.serial++}`, name, "Sorcery", owner));
  const id = g.hands[owner][g.hands[owner].length - 1].id;
  castSpell(g, owner, id, targets, rules);
  drain(g, rules);
};
const lib = (g: Game, owner: string, cards: GameCard[]) => (g.libraries[owner] = cards);

// ---- 1. 数で変わる修整
{
  const rules = book({
    Hoof: "## 常在型能力\\n\\n- affect who=self\\n- staticModify power=1 toughness=1 perZone=battlefield perWho=you perType=creature\\n".replace(/\\n/g, "\n"),
    Fire: "## 呪文能力\n\n- countCards zone=graveyard who=you type=creature as=n\n- damage player=opponents amount=$n\n",
    Heal: "## 呪文能力\n\n- lifeTotal player=you as=l\n- gainLife player=you amount=$l\n",
    Tokens: "## 呪文能力\n\n- countCards zone=battlefield who=you color=R token=true as=n\n- damage player=opponents amount=$n\n",
  });
  const g = setup();
  const h = enter(g, rules, C("H", "Hoof", "Creature — Bear", "A", { power: 1, toughness: 1 }));
  enter(g, rules, C("X1", "X", "Creature — Bear", "A", { power: 1, toughness: 1 }));
  enter(g, rules, C("X2", "X", "Creature — Bear", "A", { power: 1, toughness: 1 }));
  enter(g, rules, C("Y", "Y", "Creature — Bear", "B", { power: 1, toughness: 1 }), "B");
  assert.equal(characteristics(g, h, rules).power, 4, "自分のクリーチャー 3 体につき +1/+1 (1 + 3)");
  g.graveyards["A"].push(C("D1", "D", "Creature — Bear"), C("D2", "D", "Creature — Bear"), C("D3", "D", "Instant"));
  spell(g, rules, "Fire");
  assert.equal(g.life["B"], 18, "墓地のクリーチャー 2 枚に等しいダメージ");
  g.life["A"] = 7;
  spell(g, rules, "Heal");
  assert.equal(g.life["A"], 14, "ライフの点数に等しいライフを得る");
  const t = C("T1", "T", "Creature — Goblin", "A", { colors: ["R"], token: true, power: 1, toughness: 1 });
  g.battlefield.push({ id: "T1", card: t, controller: "A" }, { id: "T2", card: { ...t, id: "T2" }, controller: "A" }, { id: "T3", card: { ...t, id: "T3", token: false }, controller: "A" });
  spell(g, rules, "Tokens");
  assert.equal(g.life["B"], 16, "赤のトークンだけを数える (2 体)");
}
// ---- 2. 能力つきのトークン
{
  const rules = book({
    Bird: "## 呪文能力\n\n- createToken name=Bird types=\"Creature — Bird\" power=2 toughness=2 colors=W keywords=\"flying vigilance\" as=t\n",
    Loot: "## 呪文能力\n\n- createToken predefined=treasure\n- createToken predefined=clue\n- createToken predefined=food\n",
  });
  const g = setup();
  spell(g, rules, "Bird");
  const bird = g.battlefield.find((p) => p.card.name === "Bird")!;
  const kw = characteristics(g, bird, rules).keywords;
  assert.ok(kw.includes("flying") && kw.includes("vigilance"), "トークンが、キーワードを持つ");
  spell(g, rules, "Loot");
  const treasure = g.battlefield.find((p) => p.card.name === "Treasure")!;
  assert.equal(treasure.card.typeLine, "Artifact — Treasure");
  g.mana["A"] = 0;
  activateAbility(g, "A", treasure.id, 0, {}, rules);
  assert.equal(g.mana["A"], 1, "Treasure は、組み込みの能力でマナを出す (タップして、生け贄)");
  assert.ok(!g.battlefield.some((p) => p.id === treasure.id), "生け贄に捧げた");
  const clue = g.battlefield.find((p) => p.card.name === "Clue")!;
  lib(g, "A", [C("L1", "L1", "Land")]);
  g.mana["A"] = 2;
  activateAbility(g, "A", clue.id, 0, {}, rules);
  drain(g, rules);
  assert.equal(g.hands["A"].length, 1, "Clue: {2}、生け贄で 1 枚引く");
}
// ---- 3. 生け贄のコスト (ほかのパーマネント)
{
  const rules = book({ Altar: "## 起動型能力\n\n- cost sacrificeOther=creature\n- draw player=you count=1\n" });
  const g = setup();
  lib(g, "A", [C("L1", "L1", "Land")]);
  const altar = enter(g, rules, C("Al", "Altar", "Artifact"));
  assert.throws(() => activateAbility(g, "A", "Al", 0, {}, rules), /生け贄に捧げるもの/, "生け贄にするものが無い");
  enter(g, rules, C("Bear", "Bear", "Creature — Bear", "A", { power: 1, toughness: 1 }));
  activateAbility(g, "A", "Al", 0, {}, rules);
  drain(g, rules);
  assert.ok(!g.battlefield.some((p) => p.id === "Bear") && g.hands["A"].length === 1, "クリーチャーを生け贄に捧げて、引いた");
  assert.ok(g.battlefield.some((p) => p.id === altar.id), "自分自身は、生け贄にならない");
}
// ---- 4. 置換効果 (量を変える)
{
  const rules = book({
    Season: "## 常在型能力\n\n- modifyAmount what=tokens who=you mult=2\n\n## 常在型能力\n\n- modifyAmount what=counters who=you mult=2\n",
    Scales: "## 常在型能力\n\n- modifyAmount what=counters who=you add=1\n",
    Furnace: "## 常在型能力\n\n- modifyAmount what=damage who=all mult=2\n",
    Boon: "## 常在型能力\n\n- modifyAmount what=lifegain who=you mult=2\n\n## 常在型能力\n\n- modifyAmount what=draw who=you add=1\n",
    Goblins: "## 呪文能力\n\n- createToken name=Goblin types=\"Creature — Goblin\" power=1 toughness=1 count=2\n",
    Grow: "## 呪文能力\n\n- target as=t zone=battlefield kind=permanent type=creature\n- addCounter target=$t kind=+1/+1 count=2\n",
    Burn: "## 呪文能力\n\n- damage player=opponents amount=3\n",
    Heal: "## 呪文能力\n\n- gainLife player=you amount=3\n- draw player=you count=1\n",
  });
  const g = setup();
  enter(g, rules, C("Bear", "Bear", "Creature — Bear", "A", { power: 1, toughness: 1 }));
  spell(g, rules, "Goblins");
  assert.equal(g.battlefield.filter((p) => p.card.name === "Goblin").length, 2, "置換効果が無いとき: 2 体");
  enter(g, rules, C("DS", "Season", "Enchantment"));
  spell(g, rules, "Goblins");
  assert.equal(g.battlefield.filter((p) => p.card.name === "Goblin").length, 6, "Doubling Season: トークンが 2 倍 (2 → 4)");
  spell(g, rules, "Grow", { t: "Bear" });
  assert.equal(g.battlefield.find((p) => p.id === "Bear")!.counters?.["+1/+1"], 4, "カウンターも 2 倍");
  enter(g, rules, C("HS", "Scales", "Artifact"));
  spell(g, rules, "Grow", { t: "Bear" });
  assert.equal(g.battlefield.find((p) => p.id === "Bear")!.counters?.["+1/+1"], 4 + 5, "2 倍と 1 つ多くが、重なる (2 × 2 + 1)");
  enter(g, rules, C("FU", "Furnace", "Enchantment"));
  spell(g, rules, "Burn");
  assert.equal(g.life["B"], 14, "ダメージが 2 倍");
  enter(g, rules, C("BO", "Boon", "Enchantment"));
  g.life["A"] = 10;
  lib(g, "A", [C("L1", "L1", "Land"), C("L2", "L2", "Land"), C("L3", "L3", "Land")]);
  spell(g, rules, "Heal");
  assert.equal(g.life["A"], 16, "ライフが 2 倍");
  assert.equal(g.hands["A"].length, 2, "引く枚数が 1 つ多い");
}
// ---- 5. 探検・集結・暗躍・増強・このターンの出来事
{
  const rules = book({
    Scout: "## 誘発型能力\n\n- when event=enters self=true\n- self as=s\n- explore target=$s\n",
    Army: "## 呪文能力\n\n- amass count=2\n",
    Schemer: "## 誘発型能力\n\n- when event=enters self=true\n- self as=s\n- connive target=$s\n",
    Rally: "## 呪文能力\n\n- bolster count=2\n",
    Raid: "## 呪文能力\n\n- turnStat stat=attacked player=you as=n\n- compare a=$n b=1 op=ge as=ok\n- gainLife player=you amount=5 if=$ok\n",
    Morbid: "## 呪文能力\n\n- turnStat stat=creaturesDied player=all as=n\n- compare a=$n b=1 op=ge as=ok\n- gainLife player=you amount=3 if=$ok\n",
    Delirium: "## 呪文能力\n\n- graveyardTypes player=you as=n\n- compare a=$n b=4 op=ge as=ok\n- gainLife player=you amount=4 if=$ok\n",
  });
  const g = setup();
  lib(g, "A", [C("Land1", "Island", "Basic Land — Island"), C("Spell1", "Bolt", "Instant")]);
  const s1 = enter(g, rules, C("S1", "Scout", "Creature — Scout", "A", { power: 1, toughness: 1 }));
  assert.ok(g.hands["A"].some((c) => c.id === "Land1") && !s1.counters, "探検: 土地なら、手札に");
  const s2 = enter(g, rules, C("S2", "Scout", "Creature — Scout", "A", { power: 1, toughness: 1 }));
  assert.equal(s2.counters?.["+1/+1"], 1, "探検: 土地でなければ、+1/+1 カウンター");
  spell(g, rules, "Army");
  const army = g.battlefield.find((p) => p.card.name === "Army")!;
  assert.equal(army.counters?.["+1/+1"], 2, "集結: アーミーを作って、カウンター 2 個");
  spell(g, rules, "Army");
  assert.equal(g.battlefield.filter((p) => p.card.name === "Army").length, 1, "2 回目は、同じアーミーに");
  assert.equal(army.counters?.["+1/+1"], 4);
  spell(g, rules, "Rally");
  assert.equal(g.battlefield.find((p) => p.id === "S1")!.counters?.["+1/+1"], 2, "増強: タフネスの小さいクリーチャーに");
  const h = setup();
  lib(h, "A", [C("Dr", "Draw", "Instant")]);
  h.hands["A"].push(C("Land", "Island", "Basic Land — Island"));
  const sc = enter(h, rules, C("Sc", "Schemer", "Creature — Rogue", "A", { power: 1, toughness: 1 }));
  assert.equal(h.hands["A"].length, 1, "暗躍: 引いて、捨てる");
  assert.equal(sc.counters?.["+1/+1"], 1, "暗躍: 捨てたのが土地でないので、カウンター (手札の後ろから捨てる: 引いた呪文)");
  // このターンの出来事
  const t = setup();
  spell(t, rules, "Raid");
  assert.equal(t.life["A"], 20, "攻撃していない: 何も起きない");
  t.attacked = { A: true };
  spell(t, rules, "Raid");
  assert.equal(t.life["A"], 25, "攻撃した (raid)");
  spell(t, rules, "Morbid");
  assert.equal(t.life["A"], 25, "死んだクリーチャーがいない");
  t.died = { B: 1 };
  spell(t, rules, "Morbid");
  assert.equal(t.life["A"], 28, "クリーチャーが死んだ (morbid)");
  t.graveyards["A"].push(C("a", "a", "Land"), C("b", "b", "Creature"), C("c", "c", "Instant"));
  spell(t, rules, "Delirium");
  const before = t.life["A"];
  t.graveyards["A"].push(C("d", "d", "Artifact"));
  spell(t, rules, "Delirium");
  assert.equal(t.life["A"], before + 4, "墓地のカードタイプが 4 種類 (delirium)");
}
// ---- 6. 回避・制限
{
  const rules = book({
    Shade: "## 常在型能力\n\n- cantBeBlocked\n",
    Dragonish: "## 常在型能力\n\n- cantBeBlocked exceptKeyword=flying\n",
    Wall: "## 常在型能力\n\n- cantBlock\n",
    Sleepy: "## 常在型能力\n\n- cantAttack\n",
    Rage: "## 常在型能力\n\n- mustAttack\n",
  });
  const g = setup();
  g.turn = 3;
  const sh = enter(g, rules, C("Sh", "Shade", "Creature — Shade", "A", { power: 1, toughness: 1 }));
  const dr = enter(g, rules, C("Dr", "Dragonish", "Creature — Bird", "A", { power: 1, toughness: 1 }));
  const sl = enter(g, rules, C("Sl", "Sleepy", "Creature — Bear", "A", { power: 2, toughness: 2 }));
  const rg = enter(g, rules, C("Rg", "Rage", "Creature — Bear", "A", { power: 2, toughness: 2 }));
  const bear = enter(g, rules, C("Bb", "Bear", "Creature — Bear", "B", { power: 2, toughness: 2 }), "B");
  const flyer = enter(g, rules, C("Fl", "Flyer", "Creature — Bird", "B", { power: 1, toughness: 1, keywords: ["flying"] }), "B");
  for (const x of g.battlefield) x.enteredTurn = 0;
  g.step = "combat";
  g.combatPhase = "attackers";
  assert.throws(() => declareAttackers(g, "A", [{ id: "Sl" }], rules), /攻撃できない/, "攻撃できない");
  declareAttackers(g, "A", [{ id: "Sh" }, { id: "Dr" }], rules);
  assert.ok(g.battlefield.find((p) => p.id === "Rg")!.attacking, "攻撃しなければならない: 自動で、攻撃に入る");
  assert.ok(!sl.attacking);
  assert.equal(canBlock(g, bear, sh, rules), false, "ブロックされない");
  assert.equal(canBlock(g, bear, dr, rules), false, "飛行以外には、ブロックされない");
  assert.equal(canBlock(g, flyer, dr, rules), true, "飛行を持つクリーチャーには、ブロックされる");
  g.combatPhase = "blockers";
  assert.throws(() => declareBlockers(g, "B", [{ blocker: "Bb", attacker: "Sh" }], rules), /ブロックされない/);
  assert.ok(sh && dr && rg);
}
// ---- 7. バウンスランド: 自分でコントロールする土地を 1 つ選んで、手札に戻す ----
{
  const rules = book({ Karoo: "## 常在型能力\n\n- entersTapped type=land\n\n## 誘発型能力\n\n- when event=enters self=true\n- playerRemoves player=you type=land how=bounce\n" });
  const g = setup();
  g.decide = { choose: (_g, _p, from) => from.slice(0, 1) };
  enter(g, rules, C("Is", "Island", "Basic Land — Island"));
  enter(g, rules, C("K", "Karoo", "Land"));
  assert.ok(g.hands["A"].some((c) => c.id === "Is") || g.hands["A"].some((c) => c.id === "K"), "土地を 1 つ、手札に戻した");
  assert.equal(g.battlefield.filter((p) => /Land/.test(p.card.typeLine)).length, 1);
}
// ---- 8. パーマネントのコピー ----
{
  const rules = book({
    Metamorph: "## 誘発型能力\n\n- when event=enters self=true\n- target as=t zone=battlefield kind=permanent type=creature controller=opponents\n- copyPermanent target=$t\n",
    Ogre: "## 常在型能力\n\n- keyword name=trample\n",
  });
  const g = setup();
  enter(g, rules, C("Og", "Ogre", "Creature — Ogre", "B", { power: 4, toughness: 4 }), "B");
  g.decide = { target: () => ["Og"] };
  enter(g, rules, C("M", "Metamorph", "Artifact Creature — Shapeshifter", "A", { power: 0, toughness: 0 }));
  const copy = g.battlefield.find((p) => p.card.name === "Ogre" && p.controller === "A")!;
  assert.ok(copy && copy.card.token && copy.card.power === 4, "コピー: 名前・P/T を写したトークン");
  assert.ok(characteristics(g, copy, rules).keywords.includes("trample"), "能力も、同じ名前のルールから得る");
}
console.log("battle-popular ok");
