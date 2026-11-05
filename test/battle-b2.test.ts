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
// ルールは、実際の Rules/ のノートをそのまま読む (Bant Hatebears B-2: Delve・Phyrexian マナ・Storm・収束・X)。相手の呪文だけ、テスト用に書く
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const REAL = ["Treasure Cruise", "Dig Through Time", "Gitaxian Probe", "Flusterstorm", "Prismatic Ending"];
const FAKE: Record<string, string> = { "Opp Instant": "---\nmtg: rule\ncard: \"[[Opp Instant]]\"\n---\n\n## 呪文能力\n\n- draw player=you count=1\n" };
const rules: RuleBook = { get: (c) => (REAL.includes(c) ? parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")) : FAKE[c] ? parseRule(FAKE[c]) : undefined) };
const card = (id: string, name: string, typeLine: string, manaCost: string, mv: number, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, manaCost, mv, owner: "you", ...extra });
const junk = (n: number): GameCard[] => Array.from({ length: n }, (_, i) => card(`J${i}`, "Junk", "Instant", "{R}", 1));
const make = (): { g: Game; c: BattleController } => {
  const g = createGame(["you", "opp"]);
  g.payManaCosts = true;
  g.turn = 4;
  g.step = "main1";
  g.libraries["you"] = Array.from({ length: 8 }, (_, i) => card(`D${i}`, "Card", "Land", "", 0));
  g.libraries["opp"] = [card("O", "O", "Land", "", 0, { owner: "opp" })];
  return { g, c: new BattleController(g, rules) };
};
const resolveAll = (g: Game) => {
  for (let i = 0; g.stack.length && i < 40; i++) passPriority(g, g.priority!, rules);
};

// ---- Phyrexian マナ: Gitaxian Probe {U/P}
{
  const { g, c } = make();
  g.hands["you"] = [card("GP", "Gitaxian Probe", "Sorcery", "{U/P}", 1)];
  g.hands["opp"] = [card("OH", "Hand", "Instant", "{R}", 1, { owner: "opp" })];
  assert.equal(c.whyNot("GP"), undefined, "マナが無くても、2 ライフで払える");
  assert.equal(c.phyChoice("GP"), false, "マナが無いので、選ぶ余地は無い");
  assert.equal(c.use("GP", { t: "opp" }), undefined);
  assert.equal(g.life["you"], 18, "2 ライフを払った");
  resolveAll(g);
  assert.equal(g.hands["you"].length, 1, "1 枚引いた");
}
{
  const { g, c } = make();
  g.hands["you"] = [card("GP", "Gitaxian Probe", "Sorcery", "{U/P}", 1)];
  g.mana["you"] = 1;
  g.pool["you"] = { U: 1 };
  assert.equal(c.phyChoice("GP"), true, "マナでもライフでも払えるので、選ばせる");
  assert.equal(c.use("GP", { t: "opp" }), undefined);
  assert.equal(g.life["you"], 20, "マナがあれば、マナで払う");
  assert.equal(g.mana["you"], 0);
}
{
  const { g, c } = make();
  g.hands["you"] = [card("GP", "Gitaxian Probe", "Sorcery", "{U/P}", 1)];
  g.mana["you"] = 1;
  g.pool["you"] = { U: 1 };
  assert.equal(c.use("GP", { t: "opp" }, { phyLife: true }), undefined);
  assert.equal(g.life["you"], 18, "ライフを選べば、マナは残る");
  assert.equal(g.mana["you"], 1);
}
{
  const { g, c } = make();
  g.life["you"] = 1;
  g.hands["you"] = [card("GP", "Gitaxian Probe", "Sorcery", "{U/P}", 1)];
  assert.ok(c.whyNot("GP"), "ライフが 2 点に足りない → 唱えられない");
}

// ---- Delve: Treasure Cruise {7}{U}
{
  const { g, c } = make();
  g.hands["you"] = [card("TC", "Treasure Cruise", "Sorcery", "{7}{U}", 8)];
  g.graveyards["you"] = junk(6);
  g.mana["you"] = 2;
  g.pool["you"] = { U: 1 };
  assert.equal(c.whyNot("TC"), undefined, "墓地 6 枚 + マナ 2 で、唱えられる");
  assert.deepEqual([c.delveChoices("TC")!.max, c.delveChoices("TC")!.cards.length], [6, 6]);
  assert.ok(c.use("TC", {}, { delve: J(3) }), "3 枚だけでは、足りない");
  assert.equal(c.use("TC", {}, { delve: true }), undefined);
  assert.equal(g.graveyards["you"].length, 0, "墓地は、空になった (Treasure Cruise は、スタックにある)");
  assert.equal(g.exile["you"].length, 6, "6 枚を追放した");
  resolveAll(g);
  assert.equal(g.hands["you"].length, 3, "3 枚引いた");
}
function J(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `J${i}`);
}
{
  // Delve しないと、マナが足りない。汎用の数より多くは、追放できない
  const { g, c } = make();
  g.hands["you"] = [card("DT", "Dig Through Time", "Instant", "{6}{U}{U}", 8)];
  g.graveyards["you"] = junk(9);
  g.mana["you"] = 2;
  g.pool["you"] = { U: 2 };
  assert.ok(c.use("DT", {}), "Delve しないと、足りない");
  assert.ok(c.use("DT", {}, { delve: J(7) }), "汎用は 6。7 枚は、追放できない");
  assert.equal(c.use("DT", {}, { delve: J(6) }), undefined);
  assert.equal(g.exile["you"].length, 6);
}
{
  // 墓地が足りなければ、唱えられない
  const { g, c } = make();
  g.hands["you"] = [card("TC", "Treasure Cruise", "Sorcery", "{7}{U}", 8)];
  g.graveyards["you"] = junk(3);
  g.mana["you"] = 2;
  g.pool["you"] = { U: 1 };
  assert.ok(c.whyNot("TC"));
}

// ---- Storm: Flusterstorm {U}
const oppCast = (g: Game, id: string) => {
  g.active = "opp";
  g.priority = "opp";
  g.hands["opp"].push(card(id, "Opp Instant", "Instant", "{1}", 1, { owner: "opp" }));
  const saved = g.payManaCosts;
  g.payManaCosts = false;
  castSpell(g, "opp", id, {}, rules);
  g.payManaCosts = saved;
};
{
  const { g, c } = make();
  oppCast(g, "A");
  oppCast(g, "B");
  assert.equal(g.spellsCast, 2, "このターンに、2 つ唱えられた");
  g.priority = "you";
  g.hands["you"] = [card("FS", "Flusterstorm", "Instant", "{U}", 1)];
  g.mana["you"] = 1;
  g.pool["you"] = { U: 1 };
  assert.equal(c.use("FS", { t: "B" }), undefined);
  assert.equal(g.stack.length, 4, "A・B・Flusterstorm・Storm の誘発");
  passPriority(g, "you", rules);
  passPriority(g, "opp", rules); // Storm の誘発が解決する
  assert.equal(g.stack.filter((s) => s.copy).length, 2, "それまでに唱えられた 2 つぶん、コピーされた");
  assert.ok(g.stack.filter((s) => s.copy).every((s) => s.targets["t"] === "B"), "対象は、元と同じ");
  resolveAll(g);
  assert.deepEqual(g.graveyards["you"].map((x) => x.id), ["FS"], "コピーは、墓地に行かず消える");
  assert.ok(g.graveyards["opp"].some((x) => x.id === "B"), "B は、打ち消された");
}
{
  // 最初の呪文なら、コピーされない
  const { g, c } = make();
  oppCast(g, "A");
  g.priority = "you";
  g.hands["you"] = [card("FS", "Flusterstorm", "Instant", "{U}", 1)];
  g.mana["you"] = 1;
  g.pool["you"] = { U: 1 };
  assert.equal(c.use("FS", { t: "A" }), undefined);
  passPriority(g, "you", rules);
  passPriority(g, "opp", rules);
  assert.equal(g.stack.filter((s) => s.copy).length, 1, "1 つ唱えられたあとなので、コピーは 1 つ");
}
{
  // ターンが替わると、数え直す
  const { g } = make();
  oppCast(g, "A");
  g.step = "end";
  g.stack = [];
  g.priority = g.active;
  passPriority(g, g.active, rules);
  passPriority(g, g.priority!, rules);
  assert.equal(g.spellsCast ?? 0, 0, "次のターンは、0");
}

// ---- 収束と X: Prismatic Ending {X}{W}
const target = (g: Game, id: string, mv: number, typeLine = "Creature — Bear") => g.battlefield.push({ id, card: card(id, id, typeLine, "", mv, { owner: "opp" }), controller: "opp", enteredTurn: 0 });
{
  const { g, c } = make();
  target(g, "Two", 2);
  target(g, "Three", 3);
  g.hands["you"] = [card("PE", "Prismatic Ending", "Sorcery", "{X}{W}", 1), { ...card("PE2", "Prismatic Ending", "Sorcery", "{X}{W}", 1) }];
  g.mana["you"] = 2;
  g.pool["you"] = { W: 1, U: 1 };
  assert.equal(c.xMax("PE"), 1, "マナ 2 で、X は 1 まで");
  assert.equal(c.use("PE", { t: "Three" }, { x: 1 }), undefined);
  resolveAll(g);
  assert.ok(g.battlefield.some((p) => p.id === "Three"), "2 色で払った → マナ総量 3 は、追放されない");
  assert.equal(g.exile["opp"].length, 0);
  g.mana["you"] = 2;
  g.pool["you"] = { W: 1, U: 1 };
  assert.equal(c.use("PE2", { t: "Two" }, { x: 1 }), undefined);
  resolveAll(g);
  assert.ok(!g.battlefield.some((p) => p.id === "Two"), "2 色で払った → マナ総量 2 は、追放される");
  assert.deepEqual(g.exile["opp"].map((x) => x.id), ["Two"]);
}
{
  // X=0 は、白 1 色だけ: マナ総量 1 まで
  const { g, c } = make();
  target(g, "One", 1);
  target(g, "Two", 2);
  g.hands["you"] = [card("PE", "Prismatic Ending", "Sorcery", "{X}{W}", 1)];
  g.mana["you"] = 1;
  g.pool["you"] = { W: 1 };
  assert.equal(c.xMax("PE"), 0);
  assert.equal(c.use("PE", { t: "Two" }, { x: 0 }), undefined);
  resolveAll(g);
  assert.ok(g.battlefield.some((p) => p.id === "Two"), "1 色 → マナ総量 2 は、追放されない");
  g.hands["you"] = [card("PE3", "Prismatic Ending", "Sorcery", "{X}{W}", 1)];
  g.mana["you"] = 1;
  g.pool["you"] = { W: 1 };
  assert.equal(c.use("PE3", { t: "One" }, { x: 0 }), undefined);
  resolveAll(g);
  assert.ok(!g.battlefield.some((p) => p.id === "One"), "1 色 → マナ総量 1 は、追放される");
}
{
  // 土地は対象にできない。{X} の無いカードは、xMax が無い
  const { g, c } = make();
  target(g, "Land", 0, "Land");
  g.hands["you"] = [card("PE", "Prismatic Ending", "Sorcery", "{X}{W}", 1), card("TC", "Treasure Cruise", "Sorcery", "{7}{U}", 8)];
  g.mana["you"] = 1;
  g.pool["you"] = { W: 1 };
  assert.ok(c.whyNot("PE"), "対象にできるパーマネントが無い");
  assert.equal(c.xMax("TC"), undefined);
}
console.log("b2 ok");
