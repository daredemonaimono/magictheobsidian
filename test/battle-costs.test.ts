import assert from "node:assert";
import { RuleError, activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability[] => [{ kind: "spell", body }];
const ids = (cs: GameCard[]) => cs.map((c) => c.id);
const creature = (id: string, owner: string, power: number, tapped = false): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power, toughness: 1 }), controller: owner, tapped });

// 追加コスト (キッカー): 唱えるときにフラグを選ぶと、マナを払う。宣言の無いフラグは選べない。払えなければ唱えられず、状態は変わらない
const roil = spell(call("additionalCost", { flag: "kicked", mana: 2 }), call("target", { zone: "battlefield", kind: "permanent", notType: "land" }, { as: "t" }), call("bounce", { target: { ref: "t" } }), call("draw", { player: "you", count: 1 }, { if: "kicked" }));
const roilGame = (mana: number) => {
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("roil"));
  g.libraries["A"] = [card("top")];
  g.mana["A"] = mana;
  g.battlefield.push(creature("bear", "B", 2));
  return g;
};
{
  const book = rulesOf({ roil });
  const g = roilGame(2);
  castSpell(g, "A", "roil", { t: "bear" }, book, { kicked: true });
  assert.equal(g.mana["A"], 0, "キッカーのマナを払った");
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.deepEqual(ids(g.hands["A"]), ["top"], "キッカーされたので引いた");

  const poor = roilGame(1);
  assert.throws(() => castSpell(poor, "A", "roil", { t: "bear" }, book, { kicked: true }), RuleError);
  assert.equal(poor.mana["A"], 1, "払えなければマナは減らない");
  assert.deepEqual(ids(poor.hands["A"]), ["roil"], "手札に残る");
  assert.equal(poor.stack.length, 0);

  const plain = roilGame(2);
  castSpell(plain, "A", "roil", { t: "bear" }, book);
  assert.equal(plain.mana["A"], 2, "キッカーしなければ払わない");

  const none = roilGame(2);
  assert.throws(() => castSpell(none, "A", "roil", { t: "bear" }, rulesOf({ roil: spell(...roil.slice(0, 0), ...roil[0].body.slice(1)) }), { kicked: true }), RuleError, "宣言の無いフラグ");
}

// 追加コスト (チームワーク): パワーの合計が N 以上になるように、自分のアンタップ状態のクリーチャーをタップする
const nay = spell(call("additionalCost", { flag: "teamwork", tapCreatures: 2 }), call("target", { zone: "stack", kind: "spell" }, { as: "t" }), call("counter", { target: { ref: "t" }, unlessPay: 4 }, { if: "teamwork" }));
const nayGame = () => {
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("bolt"));
  g.hands["B"].push(card("nay", "Instant", "B"));
  g.battlefield.push(creature("c1", "B", 1), creature("c2", "B", 1), creature("c3", "B", 5, true), creature("o1", "A", 9));
  const book = rulesOf({ bolt: spell(), nay });
  castSpell(g, "A", "bolt", {}, book);
  passPriority(g, "A", book);
  return { g, book };
};
{
  const ok = nayGame();
  castSpell(ok.g, "B", "nay", { t: "bolt" }, ok.book, { teamwork: true, tap: ["c1", "c2"] });
  assert.deepEqual(ok.g.battlefield.filter((p) => p.tapped).map((p) => p.id).sort(), ["c1", "c2", "c3"], "選んだクリーチャーがタップされた");

  for (const [why, tap] of [["パワーが足りない", ["c1"]], ["タップ済み", ["c1", "c3"]], ["相手のクリーチャー", ["c1", "o1"]], ["存在しない", ["c1", "zz"]], ["同じものを2回", ["c1", "c1"]]] as const) {
    const bad = nayGame();
    assert.throws(() => castSpell(bad.g, "B", "nay", { t: "bolt" }, bad.book, { teamwork: true, tap: [...tap] }), RuleError, why);
    assert.equal(bad.g.battlefield.find((p) => p.id === "c1")!.tapped ?? false, false, `${why}: 状態は変わらない`);
    assert.equal(bad.g.stack.length, 1);
  }
}

// 起動型能力: マナ能力 (cost tap + addMana) は、スタックを使わず即座に実行する
const island = (): Ability[] => [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1 })] }];
{
  const g = createGame(["A", "B"]);
  g.battlefield.push({ id: "isl", card: card("Island", "Basic Land — Island", "A"), controller: "A" });
  const book = rulesOf({ Island: island() });
  activateAbility(g, "A", "isl", 0, {}, book);
  assert.equal(g.mana["A"], 1);
  assert.equal(g.battlefield[0].tapped, true);
  assert.equal(g.stack.length, 0, "マナ能力はスタックを使わない");
  assert.throws(() => activateAbility(g, "A", "isl", 0, {}, book), RuleError, "タップ済みは、もう一度起動できない");
  g.battlefield[0].tapped = false;
  g.priority = "B";
  assert.throws(() => activateAbility(g, "B", "isl", 0, {}, book), RuleError, "コントローラーではない");
  assert.throws(() => activateAbility(g, "A", "isl", 0, {}, book), RuleError, "優先権が無い");
  g.priority = "A";
  assert.throws(() => activateAbility(g, "A", "isl", 1, {}, book), RuleError, "その番号の起動型能力は無い");
}

// 起動型能力: マナと生け贄のコスト。スタックに積まれ、解決してから効果が出る。能力そのものは墓地に行かない (Cryogen Relic のような)
{
  const relic = (): Ability[] => [{ kind: "activated", body: [call("cost", { mana: 2, sacrifice: true }), call("draw", { player: "you", count: 1 })] }];
  const setup = (mana: number) => {
    const g = createGame(["A", "B"]);
    g.battlefield.push({ id: "rel", card: card("Relic", "Artifact", "A"), controller: "A" });
    g.libraries["A"] = [card("top")];
    g.mana["A"] = mana;
    return g;
  };
  const book = rulesOf({ Relic: relic() });
  const g = setup(2);
  activateAbility(g, "A", "rel", 0, {}, book);
  assert.deepEqual(g.battlefield, [], "生け贄に捧げた");
  assert.deepEqual(ids(g.graveyards["A"]), ["Relic"]);
  assert.equal(g.mana["A"], 0);
  assert.equal(g.stack.length, 1, "能力はスタックに積まれる");
  assert.deepEqual(ids(g.hands["A"]), [], "まだ効果は出ていない");
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.deepEqual(ids(g.hands["A"]), ["top"], "解決して引いた");
  assert.deepEqual(ids(g.graveyards["A"]), ["Relic"], "能力が解決しても、カードが墓地に増えない");
  assert.equal(g.stack.length, 0);

  const poor = setup(1);
  assert.throws(() => activateAbility(poor, "A", "rel", 0, {}, book), RuleError);
  assert.equal(poor.battlefield.length, 1, "払えなければ、生け贄にもならない");
  assert.equal(poor.mana["A"], 1);
}

// 起動型能力の対象: 不正な対象のときは、コストを払わない
{
  const body = [call("cost", { tap: true }), call("target", { zone: "player", kind: "player" }, { as: "t" }), call("draw", { player: "target", target: { ref: "t" }, count: 1 })];
  const g = createGame(["A", "B"]);
  g.battlefield.push({ id: "src", card: card("Src", "Artifact", "A"), controller: "A" });
  g.libraries["B"] = [card("b1", "Instant", "B")];
  const book = rulesOf({ Src: [{ kind: "activated", body }] });
  assert.throws(() => activateAbility(g, "A", "src", 0, { t: "Z" }, book), RuleError);
  assert.equal(g.battlefield[0].tapped ?? false, false, "対象が不正なら、タップもされない");
  activateAbility(g, "A", "src", 0, { t: "B" }, book);
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.deepEqual(ids(g.hands["B"]), ["b1"]);
}

// 起動型能力のスタック項目は、呪文ではない: kind=spell の対象にならない (打ち消すと、元のカードが墓地に複製されていた)
{
  const g = createGame(["A", "B"]);
  g.battlefield.push({ id: "src", card: card("Src", "Artifact", "A"), controller: "A" });
  g.hands["B"].push(card("deny", "Instant", "B"));
  const book = rulesOf({ Src: [{ kind: "activated", body: [call("cost", { tap: true }), call("draw", { player: "you", count: 1 })] }], deny: spell(call("target", { zone: "stack", kind: "spell" }, { as: "t" }), call("counter", { target: { ref: "t" } })) });
  activateAbility(g, "A", "src", 0, {}, book);
  passPriority(g, "A", book);
  assert.equal(g.stack[0].ability, true);
  assert.throws(() => castSpell(g, "B", "deny", { t: g.stack[0].id }, book), RuleError, "能力は呪文ではない");
  assert.equal(g.stack.length, 1);
}
