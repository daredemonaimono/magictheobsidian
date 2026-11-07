import assert from "node:assert";
import { readFileSync } from "node:fs";
import { activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { advanceStep } from "../src/battle/engine/turn";
import { characteristics } from "../src/battle/continuous";
import { enterBattlefield } from "../src/battle/engine/battlefield";
import { flushEvents } from "../src/battle/engine/triggers";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame, drawCards } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// デッキ「赤単アグロ」の、実際の Rules/ のノートを読んで、動くか確かめる
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const rules: RuleBook = { get: (c) => { try { return parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")); } catch { return undefined; } } };
const DECK = ["Hired Claw", "Kellan, Planar Trailblazer", "Burnout Bashtronaut", "Inti, Seneschal of the Sun", "Emberheart Challenger", "Razorkin Needlehead", "Zhao, the Moon Slayer", "Nova Hellkite", "Burst Lightning", "Mountain", "Full Bore", "Lightning Strike", "Rockface Village", "Soul-Guide Lantern", "Magebane Lizard", "Sunspine Lynx", "Abrade", "Cut Propulsion"];

// 全部、読めて、ノードの書き方が合っている
for (const name of DECK) {
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

// Lightning Strike: 3 点 (プレイヤー)
{
  const g = setup();
  g.hands["A"].push(C("LS", "Lightning Strike", "Instant"));
  castSpell(g, "A", "LS", { t: "B" }, rules);
  drain(g);
  assert.equal(g.life["B"], 17);
}
// Burst Lightning: 通常は 2 点、キッカーで 4 点
for (const [kicked, dmg] of [[false, 2], [true, 4]] as const) {
  const g = setup();
  g.hands["A"].push(C("BL", "Burst Lightning", "Instant"));
  g.mana["A"] = 4; // キッカーの {4}
  castSpell(g, "A", "BL", { t: "B" }, rules, kicked ? { kicked: true } : {});
  drain(g);
  assert.equal(g.life["B"], 20 - dmg, `キッカー ${kicked}`);
}
// Abrade: モード1 = クリーチャーに 3 点 / モード2 = アーティファクトを破壊
{
  const g = setup();
  enterBattlefield(g, C("Bear", "Bear", "Creature — Bear", "B", { power: 2, toughness: 3 }), "B", rules);
  enterBattlefield(g, C("Rock", "Rock", "Artifact", "B"), "B", rules);
  g.hands["A"].push(C("AB1", "Abrade", "Instant"), C("AB2", "Abrade", "Instant"));
  castSpell(g, "A", "AB1", { c: "Bear" }, rules, { modes: [1] });
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Bear"), "モード1: 3 点でクリーチャーが死ぬ");
  castSpell(g, "A", "AB2", { a: "Rock" }, rules, { modes: [2] });
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Rock"), "モード2: アーティファクトが壊れる");
}
// Nova Hellkite: 出たとき、対戦相手のクリーチャー 1 体に 1 点
{
  const g = setup();
  enterBattlefield(g, C("Mouse", "Mouse", "Creature — Mouse", "B", { power: 1, toughness: 1 }), "B", rules);
  enterBattlefield(g, C("NH", "Nova Hellkite", "Creature — Dragon", "A", { power: 4, toughness: 5 }), "A", rules);
  flushEvents(g, rules);
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Mouse"), "1 点で死ぬ");
}
// Sunspine Lynx: 出たとき、各プレイヤーに、基本でない土地の数だけダメージ
{
  const g = setup();
  enterBattlefield(g, C("RV", "Rockface Village", "Land", "A"), "A", rules);
  enterBattlefield(g, C("W1", "Wasteland", "Land", "B"), "B", rules);
  enterBattlefield(g, C("W2", "Strip Mine", "Land", "B"), "B", rules);
  enterBattlefield(g, C("M", "Mountain", "Basic Land — Mountain", "B"), "B", rules);
  g.life["A"] = 20;
  enterBattlefield(g, C("SL", "Sunspine Lynx", "Creature — Elemental Cat", "A", { power: 5, toughness: 4 }), "A", rules);
  flushEvents(g, rules);
  drain(g);
  assert.equal(g.life["A"], 19, "自分: 基本でない土地 1 枚");
  assert.equal(g.life["B"], 18, "相手: 基本でない土地 2 枚");
}
// Soul-Guide Lantern: 出たとき、墓地のカード 1 枚を追放
{
  const g = setup();
  g.graveyards["B"].push(C("Old", "Old", "Instant", "B"));
  enterBattlefield(g, C("SG", "Soul-Guide Lantern", "Artifact", "A"), "A", rules);
  flushEvents(g, rules);
  drain(g);
  assert.ok(g.exile["B"].some((c) => c.id === "Old") && !g.graveyards["B"].length);
}

// ---- 新しいノード
const lib = (g: Game, owner: string, n: number) => (g.libraries[owner] = Array.from({ length: n }, (_, i) => C(`L${owner}${i}`, `Lib${i}`, "Land", owner)));
// Hired Claw: 攻撃したとき相手に 1 点。{1}{R} は、相手がライフを失ったあとの、1ターンに1回だけ
{
  const g = setup();
  enterBattlefield(g, C("HC", "Hired Claw", "Creature — Lizard Mercenary", "A", { power: 1, toughness: 2 }), "A", rules);
  const claw = g.battlefield.find((p) => p.id === "HC")!;
  claw.attacking = true;
  g.events.push({ type: "attacks", perm: claw, first: true });
  flushEvents(g, rules);
  drain(g);
  assert.equal(g.life["B"], 19, "攻撃したとき 1 点");
  assert.equal(g.lostLife?.["B"], 1, "ダメージで失ったライフが、数えられる");
  g.mana["A"] = 2;
  g.pool["A"] = { R: 1 };
  activateAbility(g, "A", "HC", 0, {}, rules);
  drain(g);
  assert.equal(claw.counters?.["+1/+1"], 1);
  g.mana["A"] = 2;
  g.pool["A"] = { R: 1 };
  assert.throws(() => activateAbility(g, "A", "HC", 0, {}, rules), /1ターンに1回/, "1 ターンに 1 回");
  const h = setup();
  enterBattlefield(h, C("HC", "Hired Claw", "Creature — Lizard Mercenary", "A", { power: 1, toughness: 2 }), "A", rules);
  h.mana["A"] = 2;
  h.pool["A"] = { R: 1 };
  assert.throws(() => activateAbility(h, "A", "HC", 0, {}, rules), /ライフを失っている/, "相手がライフを失っていない");
}
// Emberheart Challenger: 自分の呪文の対象になった、そのターンで最初だけ、追放して、このターン中プレイしてよい。期限が来ると、追放されたまま
{
  const g = setup();
  g.strictTurns = false;
  lib(g, "A", 3);
  enterBattlefield(g, C("EC", "Emberheart Challenger", "Creature — Mouse Warrior", "A", { power: 2, toughness: 2 }), "A", rules);
  g.hands["A"].push(C("FB1", "Full Bore", "Instant"), C("FB2", "Full Bore", "Instant"));
  castSpell(g, "A", "FB1", { t: "EC" }, rules);
  flushEvents(g, rules);
  drain(g);
  assert.ok(g.hands["A"].some((c) => c.id === "LA0" && c.exilePlay), "一番上のカードを追放して、プレイしてよい (手札に印つきで置く)");
  castSpell(g, "A", "FB2", { t: "EC" }, rules);
  flushEvents(g, rules);
  drain(g);
  assert.equal(g.hands["A"].filter((c) => c.exilePlay).length, 1, "2 回目は、誘発しない");
  g.step = "end";
  advanceStep(g, rules);
  assert.ok(!g.hands["A"].some((c) => c.id === "LA0") && g.exile["A"].some((c) => c.id === "LA0"), "ターン終了で、追放されたままになる");
}
// Razorkin Needlehead: 相手がカードを引くたび 1 点 / 自分のターンだけ先制攻撃
{
  const g = setup();
  lib(g, "B", 2);
  enterBattlefield(g, C("RN", "Razorkin Needlehead", "Creature — Human Assassin", "A", { power: 2, toughness: 2 }), "A", rules);
  const rn = g.battlefield.find((p) => p.id === "RN")!;
  assert.ok(characteristics(g, rn, rules).keywords.includes("firststrike"), "自分のターン: 先制攻撃");
  g.active = "B";
  assert.ok(!characteristics(g, rn, rules).keywords.includes("firststrike"), "相手のターン: 先制攻撃なし");
  g.active = "A";
  drawCards(g, "B", 1, rules);
  flushEvents(g, rules);
  drain(g);
  assert.equal(g.life["B"], 19, "相手が引いたとき 1 点");
  drawCards(g, "A", 0, rules);
}
// Inti: 攻撃するたび、捨てて (任意)、攻撃クリーチャーに +1/+1 とトランプル。捨てたとき、追放して、次の終了ステップまでプレイしてよい
{
  const g = setup();
  lib(g, "A", 3);
  enterBattlefield(g, C("IN", "Inti, Seneschal of the Sun", "Legendary Creature — Human Knight", "A", { power: 2, toughness: 2 }), "A", rules);
  g.hands["A"].push(C("X", "X", "Instant"));
  const inti = g.battlefield.find((p) => p.id === "IN")!;
  inti.attacking = true;
  g.events.push({ type: "attacks", perm: inti, first: true });
  flushEvents(g, rules);
  drain(g);
  assert.equal(inti.counters?.["+1/+1"], 1, "捨てたので、+1/+1 カウンター");
  assert.ok(g.graveyards["A"].some((c) => c.id === "X"));
  assert.ok(g.hands["A"].some((c) => c.exilePlay), "捨てたので、一番上を追放して、プレイしてよい");
  assert.equal(g.mayPlay?.[0].until, "yourNextEnd");
}

// ---- 条件のノード・ワープ・速度・サブタイプ・唱えた呪文の数
// Cut Propulsion: 自分のパワー分のダメージ。飛行なら 2 倍
for (const [kw, dmg] of [[[], 2], [["flying"], 4]] as const) {
  const g = setup();
  enterBattlefield(g, C("T", "T", "Creature — Bird", "B", { power: 2, toughness: 5, keywords: [...kw] }), "B", rules);
  g.hands["A"].push(C("CP", "Cut Propulsion", "Instant"));
  castSpell(g, "A", "CP", { t: "T" }, rules);
  drain(g);
  assert.equal(g.battlefield.find((p) => p.id === "T")!.damage, dmg, `飛行 ${kw.length > 0}`);
}
// ワープ: Nova Hellkite を別のコストで唱えると、次の終了ステップに追放され、あとのターンに唱え直せる。Full Bore は、ワープで唱えたものに、トランプルと速攻
{
  const g = setup();
  g.hands["A"].push(C("NH", "Nova Hellkite", "Creature — Dragon", "A", { power: 4, toughness: 5 }), C("FB", "Full Bore", "Instant"));
  g.mana["A"] = 3;
  g.pool["A"] = { R: 1 };
  castSpell(g, "A", "NH", {}, rules, { alt: true });
  drain(g);
  const nh = g.battlefield.find((p) => p.id === "NH")!;
  assert.ok(nh?.cast?.alt, "別のコストで唱えて出た");
  castSpell(g, "A", "FB", { t: "NH" }, rules);
  drain(g);
  const kw = characteristics(g, nh, rules).keywords;
  assert.ok(kw.includes("trample") && kw.includes("haste"), "ワープで唱えたクリーチャーは、トランプルと速攻");
  g.step = "main2";
  advanceStep(g, rules); // 終了ステップの開始時: 遅延誘発
  drain(g);
  assert.ok(!g.battlefield.some((p) => p.id === "NH") && g.hands["A"].some((c) => c.id === "NH" && c.exilePlay), "追放されて、あとで唱え直せる");
  g.step = "end";
  advanceStep(g, rules);
  assert.ok(g.hands["A"].some((c) => c.id === "NH"), "期限なし: ターンが終わっても、手札に残る");
}
// 通常に唱えると、ワープの追放は起きない
{
  const g = setup();
  g.hands["A"].push(C("NH", "Nova Hellkite", "Creature — Dragon", "A", { power: 4, toughness: 5 }));
  castSpell(g, "A", "NH", {}, rules);
  drain(g);
  g.step = "main2";
  advanceStep(g, rules);
  drain(g);
  assert.ok(g.battlefield.some((p) => p.id === "NH"));
}
// Burnout Bashtronaut: 速度。自分のターンに相手がライフを失うと、1 ターンに 1 回上がる。最高速度 (4) で二段攻撃
{
  const g = setup();
  g.turn = 1;
  enterBattlefield(g, C("BB", "Burnout Bashtronaut", "Creature — Goblin Warrior", "A", { power: 1, toughness: 1 }), "A", rules);
  const bb = g.battlefield.find((p) => p.id === "BB")!;
  assert.equal(g.speed?.["A"], 1);
  const dmg = () => { g.hands["A"].push(C(`LS${g.turn}${g.speed?.["A"]}`, "Lightning Strike", "Instant")); castSpell(g, "A", `LS${g.turn}${g.speed?.["A"]}`, { t: "B" }, rules); drain(g); };
  dmg();
  assert.equal(g.speed?.["A"], 2, "相手がライフを失った");
  dmg();
  assert.equal(g.speed?.["A"], 2, "1 ターンに 1 回だけ");
  assert.ok(!characteristics(g, bb, rules).keywords.includes("doublestrike"));
  for (const t of [2, 3]) { g.turn = t; dmg(); }
  assert.equal(g.speed?.["A"], 4, "最高速度");
  assert.ok(characteristics(g, bb, rules).keywords.includes("doublestrike"), "最高速度で二段攻撃");
  g.turn = 9;
  dmg();
  assert.equal(g.speed?.["A"], 4, "4 を超えない");
}
// Kellan: 斥候 → 探偵 → ならず者 (3/2・二段攻撃)。探偵になってから戦闘ダメージで、追放してプレイ
{
  const g = setup();
  lib(g, "A", 3);
  enterBattlefield(g, C("K", "Kellan, Planar Trailblazer", "Legendary Creature — Human Faerie Scout", "A", { power: 2, toughness: 1 }), "A", rules);
  const k = g.battlefield.find((p) => p.id === "K")!;
  const act = (i: number) => { g.mana["A"] = 3; g.pool["A"] = { R: 1 }; activateAbility(g, "A", "K", i, {}, rules); drain(g); };
  act(1);
  assert.ok(!characteristics(g, k, rules).typeLine.includes("Rogue"), "斥候のままなら、2 つ目は何も起きない");
  act(0);
  assert.ok(characteristics(g, k, rules).typeLine.includes("Detective"));
  act(1);
  const now = characteristics(g, k, rules);
  assert.ok(now.typeLine.includes("Rogue") && now.power === 3 && now.toughness === 2 && now.keywords.includes("doublestrike"));
  g.events.push({ type: "damaged", source: k, target: "B", kind: "player", amount: 3, combat: true });
  flushEvents(g, rules);
  drain(g);
  assert.ok(g.hands["A"].some((c) => c.exilePlay), "戦闘ダメージを与えたとき、追放してプレイできる");
}
// Magebane Lizard: 呪文を唱えたプレイヤーに、そのターンに唱えた、クリーチャーでない呪文の数のダメージ
{
  const g = setup();
  enterBattlefield(g, C("ML", "Magebane Lizard", "Creature — Lizard", "A", { power: 1, toughness: 4 }), "A", rules);
  g.hands["B"].push(C("S1", "Lightning Strike", "Instant", "B"), C("S2", "Lightning Strike", "Instant", "B"));
  g.active = "B";
  g.priority = "B";
  castSpell(g, "B", "S1", { t: "A" }, rules);
  flushEvents(g, rules);
  drain(g);
  assert.equal(g.life["B"], 19, "1 つ目: 1 点");
  castSpell(g, "B", "S2", { t: "A" }, rules);
  flushEvents(g, rules);
  drain(g);
  assert.equal(g.life["B"], 17, "2 つ目: 2 点");
}
console.log("battle-redaggro ok");
