import assert from "node:assert";
import { readFileSync } from "node:fs";
import { RuleError, activateAbility, castSpell, passPriority, playLand } from "../src/battle/engine";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// ルールは、実際の Rules/ のノートをそのまま読む (Bant Hatebears C: 制限・置換の枠)。カードの効果を試すための相手役だけ、テスト用に書く
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const REAL = ["Archon of Emeria", "Collector Ouphe", "Lavinia, Azorius Renegade", "Grafdigger's Cage", "Energy Flux", "The Tabernacle at Pendrell Vale"];
const fake = (name: string, body: string) => `---\nmtg: rule\ncard: "[[${name}]]"\n---\n\n${body}\n`;
const FAKE: Record<string, string> = {
  Spell: fake("Spell", "## 呪文能力\n\n- draw player=you count=1"),
  Fetch: fake("Fetch", "## 呪文能力\n\n- search type=Creature to=battlefield"),
  Relic: fake("Relic", "## 起動型能力\n\n- cost tap=true\n- addMana amount=2"),
  Island: fake("Island", "## 起動型能力\n\n- cost tap=true\n- addMana amount=1 color=U"),
  Bear: fake("Bear", "## 常在型能力\n\n- keyword name=vigilance"),
  Trinket: fake("Trinket", "## 常在型能力\n\n- keyword name=flash"),
  Flash: fake("Flash", "## 常在型能力\n\n- keyword name=flash"),
};
const rules: RuleBook = { get: (c) => (REAL.includes(c) ? parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")) : FAKE[c] ? parseRule(FAKE[c]) : undefined) };
const card = (id: string, name: string, typeLine: string, mv: number, owner = "you", extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv, owner, ...extra });
const perm = (c: GameCard, extra: Partial<Perm> = {}): Perm => ({ id: c.id, card: c, controller: c.owner, enteredTurn: 0, ...extra });
const make = (): Game => {
  const g = createGame(["you", "opp"]);
  g.turn = 4;
  g.step = "main1";
  g.libraries["you"] = [card("L", "L", "Land", 0)];
  g.libraries["opp"] = [card("O", "O", "Land", 0, "opp")];
  return g;
};
const fails = (f: () => void, re: RegExp) => assert.throws(f, (e) => e instanceof RuleError && re.test(e.message));

// ---- Archon of Emeria: 1ターンに、1つだけ (全員)
{
  const g = make();
  g.battlefield.push(perm(card("AE", "Archon of Emeria", "Creature — Archon", 3, "opp")));
  g.hands["you"] = [card("S1", "Spell", "Instant", 1), card("S2", "Spell", "Instant", 1)];
  castSpell(g, "you", "S1", {}, rules);
  fails(() => castSpell(g, "you", "S2", {}, rules), /1ターンに唱えられる呪文は 1 つまで/);
  assert.deepEqual(g.hands["you"].map((x) => x.id), ["S2"], "失敗したら、状態は変わらない");
  g.priority = "opp";
  g.hands["opp"] = [card("S3", "Spell", "Instant", 1, "opp")];
  castSpell(g, "opp", "S3", {}, rules); // 相手 (Archon の持ち主) は、まだ 1 つも唱えていない
  // 次のターンは、また唱えられる
  g.spellsBy = {};
  g.stack = [];
  g.priority = "you";
  castSpell(g, "you", "S2", {}, rules);
}
// Archon がいなければ、2つ唱えられる
{
  const g = make();
  g.hands["you"] = [card("S1", "Spell", "Instant", 1), card("S2", "Spell", "Instant", 1)];
  castSpell(g, "you", "S1", {}, rules);
  castSpell(g, "you", "S2", {}, rules);
}
// Archon: 対戦相手の基本でない土地は、タップ状態で出る。基本土地と、自分の土地は、そのまま
{
  const g = make();
  g.battlefield.push(perm(card("AE", "Archon of Emeria", "Creature — Archon", 3, "opp")));
  g.hands["you"] = [card("N", "Fetch Land", "Land", 0), card("B", "Forest", "Basic Land — Forest", 0)];
  playLand(g, "you", "N", rules);
  assert.equal(g.battlefield.find((p) => p.id === "N")!.tapped, true, "基本でない土地は、タップ状態");
  g.landsPlayed = 0;
  playLand(g, "you", "B", rules);
  assert.equal(g.battlefield.find((p) => p.id === "B")!.tapped, undefined, "基本土地は、そのまま");
  g.active = "opp";
  g.landsPlayed = 0;
  g.priority = "opp";
  g.hands["opp"] = [card("M", "Mine", "Land", 0, "opp")];
  playLand(g, "opp", "M", rules);
  assert.equal(g.battlefield.find((p) => p.id === "M")!.tapped, undefined, "Archon の持ち主の土地は、そのまま");
}

// ---- Collector Ouphe: アーティファクトの起動型能力 (マナ能力も) は、起動できない
{
  const g = make();
  g.battlefield.push(perm(card("R1", "Relic", "Artifact", 1)), perm(card("I1", "Island", "Land", 0)));
  activateAbility(g, "you", "R1", 0, {}, rules);
  assert.equal(g.mana["you"], 2, "Ouphe がいなければ、起動できる");
  g.battlefield.push(perm(card("CO", "Collector Ouphe", "Creature — Ouphe", 2, "opp")));
  g.battlefield.find((p) => p.id === "R1")!.tapped = false;
  fails(() => activateAbility(g, "you", "R1", 0, {}, rules), /Collector Ouphe.*起動できない/);
  activateAbility(g, "you", "I1", 0, {}, rules); // アーティファクトでなければ、起動できる
  assert.equal(g.mana["you"], 3);
}

// ---- Lavinia: 対戦相手は、土地の数より大きいマナ総量の、クリーチャーでない呪文を唱えられない
{
  const g = make();
  g.battlefield.push(perm(card("LA", "Lavinia, Azorius Renegade", "Creature — Human Soldier", 2, "opp")), perm(card("I1", "Island", "Land", 0)), perm(card("I2", "Island", "Land", 0)));
  g.hands["you"] = [card("Big", "Spell", "Instant", 3), card("Small", "Spell", "Instant", 2), card("Bear", "Flash", "Creature — Bear", 5)];
  fails(() => castSpell(g, "you", "Big", {}, rules), /Lavinia.*マナ総量 \(3\).*土地の数 \(2\)/);
  castSpell(g, "you", "Small", {}, rules);
  castSpell(g, "you", "Bear", {}, rules); // クリーチャーは、制限されない
  // Lavinia の持ち主は、制限されない
  g.priority = "opp";
  g.hands["opp"] = [card("OB", "Spell", "Instant", 4, "opp")];
  castSpell(g, "opp", "OB", {}, rules);
}
// Lavinia: マナを使わずに唱えられた呪文は、打ち消される
{
  const g = make();
  g.payManaCosts = true;
  g.battlefield.push(perm(card("LA", "Lavinia, Azorius Renegade", "Creature — Human Soldier", 2, "opp")), perm(card("W1", "Plains", "Basic Land — Plains", 0)));
  g.hands["you"] = [card("Free", "Spell", "Instant", 0, "you", { manaCost: "" }), card("Paid", "Spell", "Instant", 1, "you", { manaCost: "{1}" })];
  g.mana["you"] = 1;
  castSpell(g, "you", "Paid", {}, rules);
  assert.equal(g.stack.length, 2, "唱えるたびに、Lavinia の誘発型能力が積まれる");
  for (let i = 0; g.stack.length && i < 10; i++) passPriority(g, g.priority!, rules);
  assert.equal(g.hands["you"].length, 2, "マナを払ったので、打ち消されず、1 枚引いた (手札: Free と、引いた 1 枚)");
  g.priority = "you";
  castSpell(g, "you", "Free", {}, rules);
  for (let i = 0; g.stack.length && i < 10; i++) passPriority(g, g.priority!, rules);
  assert.ok(g.graveyards["you"].some((x) => x.id === "Free"), "マナを使わなかったので、打ち消されて、墓地へ");
  assert.equal(g.hands["you"].length, 1, "効果は起きない (引かない)");
}

// ---- Grafdigger's Cage: ライブラリーのクリーチャーは、探して戦場に出せない
{
  const g = make();
  g.libraries["you"] = [card("Cr", "Bear", "Creature — Bear", 2)];
  g.hands["you"] = [card("F", "Fetch", "Sorcery", 1)];
  castSpell(g, "you", "F", {}, rules);
  for (let i = 0; g.stack.length && i < 10; i++) passPriority(g, g.priority!, rules);
  assert.ok(g.battlefield.some((p) => p.id === "Cr"), "Cage が無ければ、出る");
}
{
  const g = make();
  g.battlefield.push(perm(card("GC", "Grafdigger's Cage", "Artifact", 1, "opp")));
  g.libraries["you"] = [card("Cr", "Bear", "Creature — Bear", 2)];
  g.hands["you"] = [card("F", "Fetch", "Sorcery", 1)];
  castSpell(g, "you", "F", {}, rules);
  for (let i = 0; g.stack.length && i < 10; i++) passPriority(g, g.priority!, rules);
  assert.ok(!g.battlefield.some((p) => p.id === "Cr"), "Cage があれば、出られない");
  assert.deepEqual(g.libraries["you"].map((x) => x.id), ["Cr"], "ライブラリーに残る");
}

// ---- 維持コスト: Energy Flux (アーティファクト・{2}・生け贄) と The Tabernacle (クリーチャー・{1}・破壊)
// 相手のターンの、アップキープの開始時 (相手のパーマネントだけ)
const toOppUpkeep = (g: Game) => {
  g.active = "you";
  g.step = "end";
  g.stack = [];
  g.priority = "you";
  passPriority(g, "you", rules);
  passPriority(g, "opp", rules);
  assert.equal(g.active, "opp");
  assert.equal(g.step, "upkeep");
};
{
  const g = make();
  g.battlefield.push(perm(card("EF", "Energy Flux", "Enchantment", 3)), perm(card("RA", "Trinket", "Artifact", 1, "opp")), perm(card("RB", "Trinket", "Artifact", 1)));
  toOppUpkeep(g);
  assert.ok(!g.battlefield.some((p) => p.id === "RA"), "{2} を払えないので、生け贄に捧げた");
  assert.ok(g.graveyards["opp"].some((x) => x.id === "RA"));
  assert.ok(g.battlefield.some((p) => p.id === "RB"), "自分 (アクティブでない) のアーティファクトは、まだ");
}
{
  // マナを出すアーティファクト自身をタップして、自分の維持コストを払える (ルール通り)
  const g = make();
  g.battlefield.push(perm(card("EF", "Energy Flux", "Enchantment", 3)), perm(card("RA", "Relic", "Artifact", 1, "opp")));
  toOppUpkeep(g);
  assert.ok(g.battlefield.some((p) => p.id === "RA") && g.battlefield.find((p) => p.id === "RA")!.tapped, "Relic を、タップして払った");
}
{
  // 払える: 島2つをタップして払う
  const g = make();
  g.battlefield.push(perm(card("EF", "Energy Flux", "Enchantment", 3)), perm(card("RA", "Trinket", "Artifact", 1, "opp")), perm(card("I1", "Island", "Land", 0, "opp")), perm(card("I2", "Island", "Land", 0, "opp")));
  toOppUpkeep(g);
  assert.ok(g.battlefield.some((p) => p.id === "RA"), "払ったので、残る");
  assert.ok(g.battlefield.filter((p) => p.id.startsWith("I")).every((p) => p.tapped), "島 2 つをタップした");
}
{
  // 断る (Decider の pay が偽): 払えても、生け贄
  const g = make();
  g.decide = { pay: () => false };
  g.battlefield.push(perm(card("EF", "Energy Flux", "Enchantment", 3)), perm(card("RA", "Trinket", "Artifact", 1, "opp")), perm(card("I1", "Island", "Land", 0, "opp")), perm(card("I2", "Island", "Land", 0, "opp")));
  toOppUpkeep(g);
  assert.ok(!g.battlefield.some((p) => p.id === "RA"), "払わないと選べば、生け贄");
  assert.ok(g.battlefield.filter((p) => p.id.startsWith("I")).every((p) => !p.tapped), "島は、タップされない");
}
{
  // The Tabernacle: クリーチャーを、{1} ずつ。破壊不能は、破壊されない
  const g = make();
  g.battlefield.push(perm(card("TB", "The Tabernacle at Pendrell Vale", "Legendary Land", 0)), perm(card("C1", "Bear", "Creature — Bear", 2, "opp")), perm(card("C2", "Bear", "Creature — Bear", 2, "opp", { keywords: ["indestructible"] })), perm(card("C3", "Bear", "Creature — Bear", 2, "opp")), perm(card("I1", "Island", "Land", 0, "opp")));
  toOppUpkeep(g);
  assert.ok(g.battlefield.some((p) => p.id === "C1"), "{1} を払った 1 体目は、残る");
  assert.ok(g.battlefield.some((p) => p.id === "C2"), "破壊不能は、破壊されない");
  assert.ok(!g.battlefield.some((p) => p.id === "C3"), "払えなかった 3 体目は、破壊された");
}
console.log("c ok");
