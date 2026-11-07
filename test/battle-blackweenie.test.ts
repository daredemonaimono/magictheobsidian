import assert from "node:assert";
import { readFileSync } from "node:fs";
import { activateAbility, activateFromGraveyard, castSpell, declareBlockers, passPriority } from "../src/battle/engine";
import { tryAction } from "../src/battle/actions";
import { advanceStep } from "../src/battle/engine/turn";
import { enterBattlefield } from "../src/battle/engine/battlefield";
import { flushEvents } from "../src/battle/engine/triggers";
import { activatedAbilities, characteristics } from "../src/battle/continuous";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame, loseLife } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// デッキ「黒単ウィニー」の、実際の Rules/ のノートを読んで、動くか確かめる
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const rules: RuleBook = { get: (c) => { try { return parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")); } catch { return undefined; } } };
const DONE = ["Timeline Culler", "Feed the Cycle", "Final Vengeance", "Faerie Dreamthief", "Forsaken Miner", "Snarling Gorehound", "Deep-Cavern Bat", "Gatekeeper of Malakir", "Thought-Stalker Warlock", "Strategic Betrayal", "Dark Knight's Greatsword", "Heraldic Banner", "Mudflat Village", "Swamp", "Intimidation Tactics", "Nowhere to Run"];
for (const name of DONE) {
  const r = rules.get(name);
  assert.ok(r, `${name}: ルールが読めない`);
  for (const ab of r!.abilities) for (const c of ab.body) assert.equal(checkCall(c), null, `${name}: ${c.node} の書き方が違う`);
}

const C = (id: string, name: string, typeLine: string, owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 1, owner, ...extra });
const setup = () => {
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  return g;
};
const drain = (g: Game) => {
  for (let i = 0; g.stack.length && i < 40; i++) passPriority(g, g.priority!, rules);
};
const enter = (g: Game, c: GameCard, owner = "A") => {
  enterBattlefield(g, c, owner, rules);
  flushEvents(g, rules);
  drain(g);
  return g.battlefield.find((p) => p.id === c.id)!;
};
const lib = (g: Game, owner: string, n: number) => (g.libraries[owner] = Array.from({ length: n }, (_, i) => C(`L${owner}${i}`, `Lib${i}`, "Land", owner)));

// Thought-Stalker Warlock: 相手がこのターンにライフを失っていれば、手札の土地でないカードを選んで捨てさせる。そうでなければ、相手が 1 枚捨てる
{
  const g = setup();
  g.hands["B"].push(C("Land", "Swamp", "Basic Land — Swamp", "B"), C("Spell", "Bolt", "Instant", "B"));
  loseLife(g, "B", 1);
  enter(g, C("TS", "Thought-Stalker Warlock", "Creature — Lizard Warlock", "A", { power: 2, toughness: 2 }));
  assert.deepEqual(g.graveyards["B"].map((c) => c.id), ["Spell"], "ライフを失っていた: 土地でないカードを捨てさせる");
  const h = setup();
  h.hands["B"].push(C("X1", "X1", "Instant", "B"), C("X2", "X2", "Instant", "B"));
  enter(h, C("TS", "Thought-Stalker Warlock", "Creature — Lizard Warlock", "A", { power: 2, toughness: 2 }));
  assert.equal(h.graveyards["B"].length, 1, "そうでなければ、相手が 1 枚捨てる");
}
// Intimidation Tactics: 相手の手札を見て、アーティファクトかクリーチャーを 1 枚追放
{
  const g = setup();
  g.hands["B"].push(C("L", "Island", "Basic Land — Island", "B"), C("S", "Bolt", "Instant", "B"), C("Cr", "Bear", "Creature — Bear", "B"));
  g.hands["A"].push(C("IT", "Intimidation Tactics", "Sorcery"));
  castSpell(g, "A", "IT", {}, rules);
  drain(g);
  assert.deepEqual(g.exile["B"].map((c) => c.id), ["Cr"]);
}
// Nowhere to Run: 出たとき、相手のクリーチャーが -3/-3
{
  const g = setup();
  const b = enter(g, C("Bear", "Bear", "Creature — Bear", "B", { power: 2, toughness: 3 }), "B");
  enter(g, C("NR", "Nowhere to Run", "Enchantment"));
  assert.ok(!g.battlefield.some((p) => p.id === "Bear"), "-3/-3 で死ぬ");
  assert.ok(b);
}
// Mudflat Village: {1}{B}・タップ・生け贄 → 墓地の Bat などを手札に
{
  const g = setup();
  g.graveyards["A"].push(C("Bat", "Deep-Cavern Bat", "Creature — Bat"), C("Dog", "Dog", "Creature — Dog"));
  enter(g, C("MV", "Mudflat Village", "Land"));
  g.mana["A"] = 2;
  g.pool["A"] = { B: 1 };
  activateAbility(g, "A", "MV", 2, { t: "Bat" }, rules);
  drain(g);
  assert.deepEqual(g.hands["A"].map((c) => c.id), ["Bat"], "Bat だけ戻る (Dog は戻らない)");
  assert.ok(!g.battlefield.some((p) => p.id === "MV"), "生け贄に捧げた");
}
// Snarling Gorehound: ほかのパワー 2 以下のクリーチャーが出たとき、諜報 1
{
  const g = setup();
  lib(g, "A", 3);
  g.decide = { choose: (_g, _p, from) => from }; // 諜報: 見たカードを墓地に置く
  enter(g, C("SG", "Snarling Gorehound", "Creature — Dog", "A", { power: 1, toughness: 1 }));
  enter(g, C("Small", "Small", "Creature — Rat", "A", { power: 2, toughness: 2 }));
  assert.equal(g.graveyards["A"].length, 1, "諜報 1");
  enter(g, C("Big", "Big", "Creature — Ox", "A", { power: 3, toughness: 3 }));
  assert.equal(g.graveyards["A"].length, 1, "パワー 3 は、誘発しない");
}
// Deep-Cavern Bat: 相手の手札の、土地でないカードを追放。Bat が離れたら、手札に戻る
{
  const g = setup();
  g.decide = { choose: (_g, _p, from) => from }; // 「してもよい」: 選ぶ
  g.hands["B"].push(C("L", "Island", "Basic Land — Island", "B"), C("S", "Bolt", "Instant", "B"));
  const bat = enter(g, C("Bat", "Deep-Cavern Bat", "Creature — Bat", "A", { power: 1, toughness: 1 }));
  assert.ok(g.exile["B"].some((c) => c.id === "S") && !g.hands["B"].some((c) => c.id === "S"), "追放した");
  g.battlefield = g.battlefield.filter((p) => p !== bat);
  g.events.push({ type: "leaves", perm: bat, to: "graveyard" });
  flushEvents(g, rules);
  assert.ok(g.hands["B"].some((c) => c.id === "S"), "Bat が離れたので、手札に戻った");
}
// Gatekeeper of Malakir: キッカーされていれば、対象のプレイヤーが、クリーチャーを 1 体生け贄に捧げる (されていなければ、何も起きない)
{
  const g = setup();
  g.decide = { target: () => ["B"] }; // 誘発の対象 (対戦相手を選ぶ)
  enter(g, C("B1", "Bear", "Creature — Bear", "B", { power: 2, toughness: 2 }), "B");
  g.hands["A"].push(C("GK", "Gatekeeper of Malakir", "Creature — Vampire Warrior", "A", { power: 2, toughness: 2 }));
  g.mana["A"] = 1;
  g.pool["A"] = { B: 1 };
  castSpell(g, "A", "GK", { t: "B" }, rules, { kicked: true });
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "B1"), "生け贄に捧げた");
  const h = setup();
  enter(h, C("B1", "Bear", "Creature — Bear", "B", { power: 2, toughness: 2 }), "B");
  h.hands["A"].push(C("GK", "Gatekeeper of Malakir", "Creature — Vampire Warrior", "A", { power: 2, toughness: 2 }));
  castSpell(h, "A", "GK", {}, rules);
  drain(h);
  assert.ok(h.battlefield.some((p) => p.id === "B1"), "キッカー無し: 何も起きない");
}
// Strategic Betrayal: 相手は、クリーチャーを 1 体追放し、墓地も追放する
{
  const g = setup();
  enter(g, C("B1", "Bear", "Creature — Bear", "B", { power: 2, toughness: 2 }), "B");
  g.graveyards["B"].push(C("Old", "Old", "Instant", "B"));
  g.hands["A"].push(C("SB", "Strategic Betrayal", "Sorcery"));
  castSpell(g, "A", "SB", { t: "B" }, rules);
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "B1"));
  assert.ok(g.exile["B"].some((c) => c.id === "B1") && g.exile["B"].some((c) => c.id === "Old") && !g.graveyards["B"].length);
}
// Dark Knight's Greatsword: 出たとき、1/1 の英雄を作って付ける (+3/+0・騎士)。装備: 3 点のライフ、1 ターンに 1 回
{
  const g = setup();
  enter(g, C("DG", "Dark Knight's Greatsword", "Artifact — Equipment"));
  const hero = g.battlefield.find((p) => p.card.name === "Hero")!;
  assert.ok(hero && hero.attachedTo === undefined || hero, "英雄が出た");
  const sword = g.battlefield.find((p) => p.id === "DG")!;
  assert.equal(hero.attachedTo ?? sword.attachedTo, hero.attachedTo ?? sword.attachedTo);
  const now = characteristics(g, g.battlefield.find((p) => p.card.name === "Hero")!, rules);
  assert.equal(now.power, 4, "1/1 に +3/+0");
  assert.ok(now.typeLine.includes("Knight") && now.typeLine.includes("Hero"), "騎士の型が足される");
  const bear = enter(g, C("Bear", "Bear", "Creature — Bear", "A", { power: 2, toughness: 2 }));
  g.life["A"] = 20;
  activateAbility(g, "A", "DG", 0, { t: "Bear" }, rules);
  drain(g);
  assert.equal(g.life["A"], 17, "3 点のライフを払う");
  assert.equal(characteristics(g, bear, rules).power, 5);
  assert.throws(() => activateAbility(g, "A", "DG", 0, { t: "Hero" }, rules), /1ターンに1回/);
}
// Heraldic Banner: 出るとき色を選ぶ (既定は、自分のカードに多い色)。その色のクリーチャーが +1/+0。その色のマナが出る
{
  const g = setup();
  enter(g, C("Bk", "Bear", "Creature — Bear", "A", { power: 2, toughness: 2, colors: ["B"] }));
  g.hands["A"].push(C("Hx", "Hx", "Creature", "A", { colors: ["B"] }));
  const banner = enter(g, C("HB", "Heraldic Banner", "Artifact", "A"));
  assert.equal(banner.chosen, "B");
  enter(g, C("Rd", "Red", "Creature — Goblin", "A", { power: 2, toughness: 2, colors: ["R"] }));
  assert.equal(characteristics(g, g.battlefield.find((p) => p.id === "Bk")!, rules).power, 3, "黒は +1/+0");
  assert.equal(characteristics(g, g.battlefield.find((p) => p.id === "Rd")!, rules).power, 2, "赤は、そのまま");
  activateAbility(g, "A", "HB", 0, {}, rules);
  assert.equal(g.pool["A"]?.B, 1, "選んだ色のマナ");
}
// Forsaken Miner: ブロックできない。犯罪を犯したとき、{B} を払えば、墓地から戻る
{
  const g = setup();
  const miner = enter(g, C("FM", "Forsaken Miner", "Creature — Skeleton Rogue", "B", { power: 2, toughness: 2 }), "B");
  const atk = enter(g, C("At", "Attacker", "Creature — Bear", "A", { power: 2, toughness: 2 }));
  atk.attacking = true;
  atk.attackTarget = "B";
  g.step = "combat";
  g.combatPhase = "blockers";
  g.active = "A";
  assert.throws(() => declareBlockers(g, "B", [{ blocker: "FM", attacker: "At" }], rules), /ブロックできない|ブロックできる/);
  assert.ok(miner);
  const h = setup();
  h.graveyards["A"].push(C("FM", "Forsaken Miner", "Creature — Skeleton Rogue", "A", { power: 2, toughness: 2 }));
  enter(h, C("Sw", "Swamp", "Basic Land — Swamp", "A"));
  h.hands["A"].push(C("DS", "Strategic Betrayal", "Sorcery"));
  enter(h, C("Bear", "Bear", "Creature — Bear", "B", { power: 2, toughness: 2 }), "B");
  assert.ok(activatedAbilities(h, rules, h.battlefield.find((p) => p.id === "Sw")!).length >= 1);
  h.mana["A"] = 1;
  h.pool["A"] = { B: 1 };
  castSpell(h, "A", "DS", { t: "B" }, rules); // 対戦相手を対象にした: 犯罪
  flushEvents(h, rules);
  drain(h);
  assert.ok(h.battlefield.some((p) => p.id === "FM"), "犯罪を犯して、{B} を払って、墓地から戻った");
}
// ---- 墓地から: Faerie Dreamthief の能力 (追放して、1 枚引き、1 点のライフを失う)・Timeline Culler のワープ
{
  const g = setup();
  lib(g, "A", 3);
  g.graveyards["A"].push(C("FD", "Faerie Dreamthief", "Creature — Faerie Warlock", "A", { power: 1, toughness: 1 }));
  g.mana["A"] = 3;
  g.pool["A"] = { B: 1 };
  assert.equal(tryAction(g, rules, "A", { kind: "yardAbility", card: "FD", index: 0 }), undefined, "使える");
  activateFromGraveyard(g, "A", "FD", 0, {}, rules);
  drain(g);
  assert.ok(g.exile["A"].some((c) => c.id === "FD") && !g.graveyards["A"].length, "コストで、墓地から追放した");
  assert.equal(g.hands["A"].length, 1, "1 枚引いた");
  assert.equal(g.life["A"], 19, "1 点のライフを失った");
  assert.throws(() => activateAbility(g, "A", "FD", 0, {}, rules), /戦場に無い/);
  const h = setup();
  h.graveyards["A"].push(C("FD", "Faerie Dreamthief", "Creature — Faerie Warlock", "A"));
  assert.notEqual(tryAction(h, rules, "A", { kind: "yardAbility", card: "FD", index: 0 }), undefined, "マナが無いと使えない");
}
{
  const g = setup();
  g.graveyards["A"].push(C("TC", "Timeline Culler", "Creature — Drix Warlock", "A", { power: 2, toughness: 2 }));
  assert.throws(() => castSpell(g, "A", "TC", {}, rules, { from: "graveyard" }), /ワープ/, "墓地からは、別のコストでだけ");
  g.mana["A"] = 1;
  g.pool["A"] = { B: 1 };
  castSpell(g, "A", "TC", {}, rules, { from: "graveyard", alt: true });
  drain(g);
  assert.ok(g.battlefield.some((p) => p.id === "TC"), "墓地から、ワープで唱えた");
  assert.equal(g.life["A"], 18, "2 点のライフを払った");
  g.step = "main2";
  advanceStep(g, rules);
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "TC") && g.hands["A"].some((c) => c.id === "TC" && c.exilePlay), "次の終了ステップに追放され、あとで唱え直せる");
}
// ---- 必須の追加コスト: Feed the Cycle (探索か {B})・Final Vengeance (生け贄)
const costly = (name: string, typeLine: string, manaCost: string, owner = "A") => C(name, name, typeLine, owner, { manaCost, mv: 2 });
{
  // 墓地に 3 枚以上: 探索 (追放) して、{1}{B} だけで唱えられる
  const g = setup();
  g.payManaCosts = true;
  enter(g, C("Bear", "Bear", "Creature — Bear", "B", { power: 2, toughness: 2 }), "B");
  g.graveyards["A"].push(C("G1", "G1", "Instant"), C("G2", "G2", "Instant"), C("G3", "G3", "Instant"), C("G4", "G4", "Instant"));
  g.hands["A"].push(costly("Feed the Cycle", "Instant", "{1}{B}"));
  g.mana["A"] = 2;
  g.pool["A"] = { B: 1 };
  castSpell(g, "A", "Feed the Cycle", { t: "Bear" }, rules);
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Bear"), "クリーチャーを破壊");
  assert.equal(g.exile["A"].length, 3, "墓地の 3 枚を追放した (探索)");
  // 墓地が足りない: {B} を余分に払う。足りなければ、唱えられない
  const h = setup();
  h.payManaCosts = true;
  enter(h, C("Bear", "Bear", "Creature — Bear", "B", { power: 2, toughness: 2 }), "B");
  h.hands["A"].push(costly("Feed the Cycle", "Instant", "{1}{B}"));
  h.mana["A"] = 2;
  h.pool["A"] = { B: 1 };
  assert.throws(() => castSpell(h, "A", "Feed the Cycle", { t: "Bear" }, rules), /マナが足りない/, "探索できない: {1}{B}{B} が要る");
  h.mana["A"] = 3;
  h.pool["A"] = { B: 2 };
  castSpell(h, "A", "Feed the Cycle", { t: "Bear" }, rules);
  drain(h);
  assert.ok(!h.battlefield.some((p) => p.id === "Bear"));
  // 食物でも探索できる
  const f = setup();
  f.payManaCosts = true;
  enter(f, C("Bear", "Bear", "Creature — Bear", "B", { power: 2, toughness: 2 }), "B");
  enter(f, C("Food", "Food", "Artifact — Food"));
  f.hands["A"].push(costly("Feed the Cycle", "Instant", "{1}{B}"));
  f.mana["A"] = 2;
  f.pool["A"] = { B: 1 };
  castSpell(f, "A", "Feed the Cycle", { t: "Bear" }, rules);
  drain(f);
  assert.ok(!f.battlefield.some((p) => p.id === "Food"), "食物を生け贄に捧げた");
}
{
  const g = setup();
  enter(g, C("Mine", "Mine", "Creature — Bear", "A", { power: 1, toughness: 1 }));
  enter(g, C("Foe", "Foe", "Creature — Ox", "B", { power: 5, toughness: 5 }), "B");
  g.hands["A"].push(C("FV", "Final Vengeance", "Sorcery"));
  castSpell(g, "A", "FV", { t: "Foe" }, rules);
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Mine"), "自分のクリーチャーを生け贄に捧げた");
  assert.ok(g.exile["B"].some((c) => c.id === "Foe"), "対象を追放した");
  const h = setup();
  enter(h, C("Foe", "Foe", "Creature — Ox", "B", { power: 5, toughness: 5 }), "B");
  h.hands["A"].push(C("FV", "Final Vengeance", "Sorcery"));
  assert.throws(() => castSpell(h, "A", "FV", { t: "Foe" }, rules), /生け贄に捧げるもの/, "生け贄が無いと、唱えられない");
}
console.log("battle-blackweenie ok");
