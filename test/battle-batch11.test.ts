import assert from "node:assert";
import { RuleError, castPrepared, castSpell, declareAttackers, passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, checkCondition, placementProblem, refProblems, resetRegistry, structureProblem } from "../src/battle/registry";
import { parseRule, writeRule } from "../src/battle/ruleMd";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 60; i++) passPriority(g, g.priority!, book);
  assert.equal(g.stack.length, 0, "スタックが空にならない");
};
const next = (g: Game, book: RuleBook) => {
  for (let i = 0; i < g.players.length; i++) passPriority(g, g.priority!, book);
};

// Emeritus of Ideation: 準備済で戦場に出る / 準備呪文 Ancestral Recall / 攻撃するたび、墓地から 8 枚追放してもよい。そうしたなら準備済になる
const prepareAb = (): Ability => ({ kind: "prepare", body: [call("prepareSpell", { name: "Ancestral Recall", type: "Instant", manaCost: "{U}" }), call("target", { zone: "player", kind: "player" }, { as: "t" }), call("draw", { player: "target", target: { ref: "t" }, count: 3 })] });
const emeritus = (): Ability[] => [
  { kind: "static", body: [call("entersPrepared", {})] },
  prepareAb(),
  { kind: "triggered", body: [call("when", { event: "attacks", self: true }), call("exile", { zone: "graveyard", count: 8, optional: true }, { as: "e" }), call("prepare", {}, { if: "$e" })] },
];
const emeritusCard = (owner = "A") => card("Emeritus", "Creature — Human Wizard", owner, { power: 5, toughness: 5, mv: 5 });
const onField = (g: Game, owner = "A", extra: Partial<Perm> = {}): Perm => {
  const p: Perm = { id: "Emeritus", card: emeritusCard(owner), controller: owner, ...extra };
  g.battlefield.push(p);
  return p;
};
const book = rulesOf({ Emeritus: emeritus() });

// ---- 検査・構造・md
assert.equal(checkCall(call("prepareSpell", { name: "Ancestral Recall", type: "Instant", manaCost: "{U}" })), null);
assert.ok(checkCall(call("prepareSpell", { name: "X", type: "Instant", manaCost: "UU" }))?.includes("マナコスト"));
assert.equal(checkCall(call("entersPrepared", {})), null);
assert.equal(checkCall(call("prepare", {})), null);
assert.equal(checkCall(call("exile", { zone: "graveyard", count: 8, optional: true })), null);
assert.ok(placementProblem("spell", call("prepareSpell", { name: "X", type: "Instant" })), "prepareSpell は準備呪文にだけ書ける");
assert.equal(placementProblem("prepare", call("prepareSpell", { name: "X", type: "Instant" })), null);
assert.equal(placementProblem("prepare", call("modes", { count: 2, min: 1, max: 1 })), null, "呪文能力のノードは、準備呪文にも書ける");
assert.equal(structureProblem(prepareAb()), null);
assert.ok(structureProblem({ kind: "prepare", body: [call("draw", { player: "you", count: 1 })] }), "準備呪文は prepareSpell で始める");
assert.ok(structureProblem({ kind: "prepare", body: [call("prepareSpell", { name: "A", type: "Instant" }), call("prepareSpell", { name: "B", type: "Instant" })] }), "prepareSpell は最初の1つだけ");
assert.equal(checkCondition("$e"), null, "if=$名前: 前のノードの出力が 0 / 偽でないとき");
assert.equal(checkCondition("!$e"), null);
{
  const ab = emeritus()[2];
  assert.deepEqual(refProblems(ab), []);
  const bad = { ...ab, body: [ab.body[0], call("prepare", {}, { if: "$nothing" })] };
  assert.ok(refProblems(bad)[0].message.includes("見つからない"), "if=$ の参照も検査する");
}
{
  const rule = { card: "Emeritus of Ideation // Ancestral Recall", abilities: emeritus() };
  const md = writeRule(rule);
  assert.ok(md.includes("## 準備呪文"));
  const again = parseRule(md);
  assert.deepEqual(again.abilities.map((a) => a.kind), ["static", "prepare", "triggered"]);
  assert.deepEqual(again.abilities[1].body[0].args, { name: "Ancestral Recall", type: "Instant", manaCost: "{U}" });
  assert.equal(again.abilities[2].body[2].if, "$e");
}

// ---- 準備済で戦場に出る (準備呪文を持つクリーチャーだけ)
{
  const g = createGame(["A", "B"]);
  g.hands["A"].push(emeritusCard());
  g.step = "main1";
  castSpell(g, "A", "Emeritus", {}, book);
  drain(g, book);
  assert.equal(g.battlefield.find((p) => p.id === "Emeritus")!.prepared, true);
}
{
  const g = createGame(["A", "B"]);
  const plain = rulesOf({ Bear: [{ kind: "static", body: [call("entersPrepared", {})] }] }); // 準備呪文が無いクリーチャーは、準備済になれない
  g.hands["A"].push(card("Bear", "Creature — Bear", "A", { power: 2, toughness: 2 }));
  g.step = "main1";
  castSpell(g, "A", "Bear", {}, plain);
  drain(g, plain);
  assert.equal(g.battlefield.find((p) => p.id === "Bear")!.prepared, undefined);
}

// ---- 準備呪文を唱える: コントローラーだけ。唱えると準備済でなくなり、コピーは解決後に消える (墓地へ行かない)
{
  const g = createGame(["A", "B"]);
  g.libraries["B"] = [card("b1", "Instant", "B"), card("b2", "Instant", "B"), card("b3", "Instant", "B")];
  g.step = "main1";
  const p = onField(g, "A", { prepared: true });
  assert.throws(() => castPrepared(g, "B", "Emeritus", { t: "B" }, book), RuleError, "コントローラーだけ");
  castPrepared(g, "A", "Emeritus", { t: "B" }, book);
  assert.equal(p.prepared, false, "唱えると、準備済でなくなる");
  assert.equal(g.stack.length, 1);
  assert.equal(g.stack[0].card.name, "Ancestral Recall");
  assert.throws(() => castPrepared(g, "A", "Emeritus", { t: "B" }, book), RuleError, "準備済でなければ唱えられない");
  drain(g, book);
  assert.equal(g.hands["B"].length, 3, "Ancestral Recall: 対象が3枚引く");
  assert.equal(g.graveyards["A"].length, 0, "コピーは、解決しても墓地に行かない");
  assert.equal(g.graveyards["B"].length, 0);
}
{
  // 準備済でないクリーチャー・準備呪文が無いルールは、唱えられない
  const g = createGame(["A", "B"]);
  g.step = "main1";
  onField(g, "A");
  assert.throws(() => castPrepared(g, "A", "Emeritus", { t: "B" }, book), RuleError);
  const g2 = createGame(["A", "B"]);
  g2.step = "main1";
  onField(g2, "A", { prepared: true });
  assert.throws(() => castPrepared(g2, "A", "Emeritus", { t: "B" }, rulesOf({})), RuleError);
}
{
  // インスタント: 優先権があれば、相手のターンにも。優先権が無ければ唱えられない
  const g = createGame(["A", "B"]);
  g.step = "main1";
  g.active = "B";
  g.priority = "B";
  onField(g, "A", { prepared: true });
  assert.throws(() => castPrepared(g, "A", "Emeritus", { t: "A" }, book), RuleError, "優先権が無い");
  g.priority = "A";
  castPrepared(g, "A", "Emeritus", { t: "A" }, book);
}
{
  // マナ: 準備呪文のマナコスト {U} を払う
  const make = (colors: Record<string, number>) => {
    const g = createGame(["A", "B"]);
    g.payManaCosts = true;
    g.step = "main1";
    g.mana["A"] = 1;
    g.pool["A"] = { ...colors };
    onField(g, "A", { prepared: true });
    return g;
  };
  const ok = make({ U: 1 });
  castPrepared(ok, "A", "Emeritus", { t: "A" }, book);
  assert.equal(ok.mana["A"], 0);
  const no = make({});
  assert.throws(() => castPrepared(no, "A", "Emeritus", { t: "A" }, book), RuleError, "青が無い");
  assert.equal(no.battlefield[0].prepared, true, "唱えられなければ、準備済のまま");
}
{
  // 打ち消されたコピーは、消える (墓地に行かない)。準備済には戻らない
  const g = createGame(["A", "B"]);
  g.step = "main1";
  const p = onField(g, "A", { prepared: true });
  const negate = rulesOf({ Emeritus: emeritus(), negate: [{ kind: "spell", body: [call("target", { zone: "stack", kind: "spell" }, { as: "t" }), call("counter", { target: { ref: "t" } })] }] });
  castPrepared(g, "A", "Emeritus", { t: "A" }, negate);
  g.hands["B"].push(card("negate", "Instant", "B"));
  g.priority = "B";
  castSpell(g, "B", "negate", { t: g.stack[0].id }, negate);
  drain(g, negate);
  assert.equal(g.graveyards["A"].length, 0, "コピーは、打ち消されても墓地に行かない");
  assert.equal(p.prepared, false);
}
{
  // 戦場を離れれば、準備済でなくなる (戻ってきたら、もう一度、準備済で出る)
  const g = createGame(["A", "B"]);
  g.step = "main1";
  g.hands["A"].push(emeritusCard());
  castSpell(g, "A", "Emeritus", {}, book);
  drain(g, book);
  const bounce = rulesOf({ Emeritus: emeritus(), bounce: [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" }), call("bounce", { target: { ref: "t" } })] }] });
  g.hands["A"].push(card("bounce"));
  castSpell(g, "A", "bounce", { t: "Emeritus" }, bounce);
  drain(g, bounce);
  assert.ok(!g.battlefield.some((p) => p.id === "Emeritus"));
  castSpell(g, "A", "Emeritus", {}, bounce);
  drain(g, bounce);
  assert.equal(g.battlefield.find((p) => p.id === "Emeritus")!.prepared, true);
}

// ---- 攻撃するたび: 墓地から 8 枚追放してもよい。そうしたなら準備済になる
const attackSetup = (graveyard: number, prepared = false) => {
  const g = createGame(["A", "B"]);
  g.graveyards["A"] = Array.from({ length: graveyard }, (_, i) => card(`g${i}`));
  g.battlefield.push({ id: "Emeritus", card: emeritusCard(), controller: "A", ...(prepared ? { prepared: true } : {}) });
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  next(g, book);
  declareAttackers(g, "A", [{ id: "Emeritus" }], book);
  drain(g, book);
  return g;
};
{
  const g = attackSetup(9);
  assert.equal(g.battlefield[0].prepared, true, "準備済になる");
  assert.equal(g.graveyards["A"].length, 1, "8 枚追放した");
  assert.equal(g.exile["A"].length, 8, "追放領域へ");
}
{
  const g = attackSetup(7);
  assert.equal(g.battlefield[0].prepared, undefined, "7 枚では、追放できない");
  assert.equal(g.graveyards["A"].length, 7);
}
{
  // もう準備済でも、追放はできる。2回目の準備済にはならない (コピーは1つだけ)
  const g = attackSetup(8, true);
  assert.equal(g.battlefield[0].prepared, true);
  assert.equal(g.exile["A"].length, 8);
}
{
  // 「してもよい」を断れる (Decider.may)
  const g = createGame(["A", "B"]);
  g.graveyards["A"] = Array.from({ length: 8 }, (_, i) => card(`g${i}`));
  g.battlefield.push({ id: "Emeritus", card: emeritusCard(), controller: "A" });
  g.decide = { may: () => false };
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  next(g, book);
  declareAttackers(g, "A", [{ id: "Emeritus" }], book);
  drain(g, book);
  assert.equal(g.battlefield[0].prepared, undefined);
  assert.equal(g.graveyards["A"].length, 8, "断ったので、追放しない");
}
console.log("batch11 ok");
