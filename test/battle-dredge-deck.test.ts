import assert from "node:assert";
import { readFileSync } from "node:fs";
import { activateFromHand, applyOpening, castSpell, passPriority, serumPowder } from "../src/battle/engine";
import { characteristics } from "../src/battle/continuous";
import { advanceStep } from "../src/battle/engine/turn";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame, drawCards } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// デッキ「Dradge」の、実際の Rules/ のノートを読んで、通しの動きを確かめる (DR-1〜DR-7 のノードが、AI の書いたルールで、組み合わさって動くか)
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const rules: RuleBook = { get: (c) => { try { return parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")); } catch { return undefined; } } };

const C = (name: string, typeLine: string, mv: number, colors: string[] = [], extra: Partial<GameCard> = {}, owner = "you"): GameCard => ({ id: name, name, typeLine, mv, owner, colors, ...extra });
const IMP = () => C("Stinkweed Imp", "Creature — Imp", 3, ["B"], { power: 1, toughness: 2, keywords: ["flying"] });
const THUG = () => C("Golgari Thug", "Creature — Human Warrior", 2, ["B"], { power: 2, toughness: 2 });
const ICHORID = () => C("Ichorid", "Creature — Horror", 4, ["B"], { power: 3, toughness: 1, keywords: ["haste"] });
const AMALGAM = () => C("Prized Amalgam", "Creature — Zombie", 4, ["B"], { power: 3, toughness: 3 });
const NARCO = () => C("Narcomoeba", "Creature — Illusion", 2, ["U"], { power: 1, toughness: 1, keywords: ["flying"] });
const CHILL = () => C("Creeping Chill", "Sorcery", 4, ["B"]);
const filler = (n: number, owner = "you") => Array.from({ length: n }, (_, i) => C(`Filler${i}`, "Land", 0, [], {}, owner));
const names = (cs: GameCard[]) => cs.map((c) => c.name);
const drain = (g: Game) => {
  for (let i = 0; g.stack.length && i < 60; i++) passPriority(g, g.priority!, rules);
};
const base = (): Game => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = true;
  g.skipUnruled = true;
  g.libraries["opp"] = filler(20, "opp");
  return g;
};
const has = (g: Game, name: string) => g.battlefield.some((p) => p.card.name === name);

// ---- 1. ドロー・ステップの Dredge (人への質問): Stinkweed Imp を選ぶと、上から 5 枚が墓地へ。Narcomoeba は戦場に出て、Creeping Chill は追放されて 3 点ダメージ・3 点回復
{
  const g = base();
  g.libraries["you"] = [NARCO(), CHILL(), ...filler(3), ...filler(10)].map((c, i) => ({ ...c, id: `${c.name}${i}` }));
  g.graveyards["you"] = [IMP()];
  g.turn = 2;
  g.active = "you";
  g.step = "upkeep";
  g.priority = "you";
  g.strictTurns = true;
  const ctl = new BattleController(g, rules);
  ctl.next();
  const req = ctl.pending?.request;
  assert.ok(req && req.kind === "choose" && /Dredge 5/.test(req.label ?? "") && req.cards[0].name === "Stinkweed Imp", "引く前に、Dredge の質問が出る");
  const before = g.hands["you"].length;
  ctl.answer(["Stinkweed Imp"]);
  drain(g); // 掘った Narcomoeba・Creeping Chill の誘発を、解決する
  assert.deepEqual(names(g.hands["you"]).filter((n) => n === "Stinkweed Imp"), ["Stinkweed Imp"], "Imp が手札に戻った");
  assert.equal(g.hands["you"].length, before + 1, "引くかわりなので、手札は 1 枚だけ増える");
  assert.ok(has(g, "Narcomoeba"), "掘られた Narcomoeba は、墓地から、戦場に出る");
  assert.ok(g.exile["you"].some((c) => c.name === "Creeping Chill"), "掘られた Creeping Chill は、追放される");
  assert.equal(g.life["opp"], 17, "Creeping Chill: 3 点ダメージ");
  assert.equal(g.life["you"], 23, "Creeping Chill: 3 点回復");
}

// ---- 2. Ichorid の循環: アップキープに、墓地の黒いクリーチャーを追放して戻る → Prized Amalgam が、墓地から出たので、終了ステップに戻る。Ichorid は終了ステップに生け贄
{
  const g = base();
  g.libraries["you"] = filler(10);
  g.graveyards["you"] = [ICHORID(), THUG(), AMALGAM()];
  g.turn = 1;
  g.active = "opp";
  g.step = "end";
  g.priority = "opp";
  advanceStep(g, rules); // → あなたのターン (untap)
  for (let i = 0; g.step !== "upkeep" && i < 5; i++) advanceStep(g, rules);
  drain(g);
  assert.ok(has(g, "Ichorid"), "アップキープに、黒いクリーチャー (Thug か Amalgam) を追放して、Ichorid が戻る");
  assert.equal(g.exile["you"].length, 1, "追放したのは 1 枚");
  const exiled = g.exile["you"][0].name;
  if (exiled !== "Prized Amalgam") {
    assert.equal(g.delayed?.length ?? 0, 1, "Amalgam が墓地にいたので、Ichorid が出たことで、遅延誘発が予約される");
    for (let i = 0; g.step !== "end" && i < 12; i++) {
      advanceStep(g, rules);
      drain(g);
    }
    assert.ok(has(g, "Prized Amalgam"), "終了ステップに、Amalgam が戻る");
    assert.equal(g.battlefield.find((p) => p.card.name === "Prized Amalgam")?.tapped, true, "タップ状態で");
    assert.ok(g.graveyards["you"].some((c) => c.name === "Ichorid") && !has(g, "Ichorid"), "Ichorid は、終了ステップに生け贄 (墓地へ戻る)");
  }
}

// ---- 3. Grief: Evoke (手札の黒いカードを追放) で、相手の手札から、土地でない 1 枚を捨てさせて、自分は生け贄
{
  const g = base();
  g.step = "main1";
  g.active = "you";
  g.priority = "you";
  g.hands["you"] = [C("Grief", "Creature — Elemental Incarnation", 4, ["B"], { power: 3, toughness: 2, manaCost: "{2}{B}{B}" }), AMALGAM()];
  g.hands["opp"] = [C("Island", "Basic Land — Island", 0, [], {}, "opp"), C("Force of Will", "Instant", 5, ["U"], { manaCost: "{3}{U}{U}" }, "opp")];
  g.decide = { target: (_g, _i, _c, legal) => legal.filter((x) => x === "opp") };
  castSpell(g, "you", "Grief", {}, rules, { alt: true, exile: ["Prized Amalgam"] });
  drain(g);
  assert.deepEqual(names(g.graveyards["opp"]), ["Force of Will"], "土地でない Force of Will が捨てられる");
  assert.ok(!has(g, "Grief"), "Evoke なので、生け贄に捧げられた");
  assert.ok(g.exile["you"].some((c) => c.name === "Prized Amalgam"), "Evoke のコスト: 手札の黒いカードを追放");
}

// ---- 4. Hollow One: サイクリング ({2}) → 1 枚引く。そのターンは、Hollow One が {2} 安くなる (捨てた数)
{
  const g = base();
  g.step = "main1";
  g.active = "you";
  g.priority = "you";
  g.libraries["you"] = filler(5);
  const hollow = () => C("Hollow One", "Artifact Creature — Golem", 4, [], { manaCost: "{4}", power: 4, toughness: 4 });
  g.hands["you"] = [hollow(), { ...hollow(), id: "Hollow Two" }];
  g.mana["you"] = 2;
  activateFromHand(g, "you", "Hollow One", 0, {}, rules);
  drain(g);
  assert.equal(g.discarded?.["you"], 1);
  assert.deepEqual(names(g.hands["you"]).filter((n) => n === "Hollow One").length, 1, "2 枚目の Hollow One が手札に残っている");
  g.mana["you"] = 2;
  castSpell(g, "you", "Hollow Two", {}, rules);
  drain(g);
  assert.ok(g.battlefield.some((p) => p.id === "Hollow Two"), "{4} の Hollow One が、{2} で唱えられた");
}

// ---- 5. Chalice of the Void (X=1): Mental Misstep (マナ総量 1) は、唱えると、打ち消される
{
  const g = base();
  g.step = "main1";
  g.active = "you";
  g.priority = "you";
  g.hands["you"] = [C("Chalice of the Void", "Artifact", 0, [], { manaCost: "{X}{X}" })];
  g.mana["you"] = 2;
  castSpell(g, "you", "Chalice of the Void", {}, rules, { x: 1 });
  drain(g);
  assert.equal(g.battlefield.find((p) => p.card.name === "Chalice of the Void")?.counters?.charge, 1);
  g.active = "opp";
  g.priority = "opp";
  g.libraries["opp"] = filler(5, "opp");
  // 相手が、マナ総量 1 のクリーチャー呪文を唱える (ルールが無くても、マナ総量で、Chalice が打ち消す)。マナ総量 2 は、通る
  g.hands["opp"] = [C("Bear One", "Creature — Bear", 1, [], { manaCost: "{1}", power: 1, toughness: 1 }, "opp"), C("Bear Two", "Creature — Bear", 2, [], { manaCost: "{2}", power: 2, toughness: 2 }, "opp")];
  g.mana["opp"] = 3;
  castSpell(g, "opp", "Bear One", {}, rules);
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Bear One") && g.graveyards["opp"].some((c) => c.name === "Bear One"), "マナ総量 1 の呪文は、Chalice に打ち消される");
  g.priority = "opp";
  castSpell(g, "opp", "Bear Two", {}, rules);
  drain(g);
  assert.ok(g.battlefield.some((p) => p.id === "Bear Two"), "マナ総量 2 は、通る");
}

// ---- 6. Leyline of the Void + Narcomoeba: 開始時に戦場に出して、相手の墓地に行くカードは追放。Golgari Grave-Troll は 墓地のクリーチャー 1 枚につき +1/+1 で出て、再生できる
{
  const g = base();
  g.hands["you"] = [C("Leyline of the Void", "Enchantment", 4, ["B"]), C("Island", "Land", 0)];
  applyOpening(g, "you", rules);
  assert.ok(has(g, "Leyline of the Void"), "開始時に戦場に出る");
  g.hands["opp"] = [C("Junk", "Instant", 1, [], {}, "opp")];
  g.libraries["opp"] = filler(3, "opp");
  drawCards(g, "opp", 1, rules);
  g.step = "main1";
  g.active = "you";
  g.priority = "you";
  const troll = C("Golgari Grave-Troll", "Creature — Troll Skeleton", 4, ["B"], { manaCost: "{4}{B}", power: 0, toughness: 0 });
  g.graveyards["you"] = [IMP(), THUG(), AMALGAM()];
  g.hands["you"] = [troll];
  g.mana["you"] = 6;
  g.pool["you"] = { B: 1 };
  castSpell(g, "you", "Golgari Grave-Troll", {}, rules);
  drain(g);
  const t = g.battlefield.find((p) => p.card.name === "Golgari Grave-Troll")!;
  assert.equal(t.counters?.["+1/+1"], 3, "墓地のクリーチャー 3 枚 → カウンター 3 個");
  assert.equal(characteristics(g, t, rules).power, 3);
}

// ---- 7. Serum Powder: マリガンのとき、手札を入れ替える
{
  const g = base();
  g.mulligan = { count: 0 };
  g.libraries["you"] = filler(10);
  g.hands["you"] = [C("Serum Powder", "Artifact", 1), ...filler(6)];
  serumPowder(g, "you", "Serum Powder", rules);
  assert.equal(g.hands["you"].length, 7);
  assert.ok(g.exile["you"].some((c) => c.name === "Serum Powder"));
}

// ---- 8. Sickening Shoal: マナ総量 3 の黒いカードを追放して、X=3。-3/-3
{
  const g = base();
  g.step = "main1";
  g.active = "you";
  g.priority = "you";
  g.battlefield.push({ id: "Target", card: C("Target", "Creature — Bear", 2, ["G"], { power: 3, toughness: 3 }, "opp"), controller: "opp", enteredTurn: 0 });
  g.hands["you"] = [C("Sickening Shoal", "Instant — Arcane", 1, ["B"], { manaCost: "{X}{B}" }), C("Fodder", "Creature", 3, ["B"])];
  castSpell(g, "you", "Sickening Shoal", { t: "Target" }, rules, { alt: true, exile: ["Fodder"] });
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Target"), "3/3 が -3/-3 で、死ぬ");
}
console.log("battle-dredge-deck ok");
