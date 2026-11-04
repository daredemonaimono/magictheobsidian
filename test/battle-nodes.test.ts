import assert from "node:assert";
import { castSpell, passPriority } from "../src/battle/engine";
import { NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame, keywordsOf, statsOf } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", mv = 1): GameCard => ({ id, name: id, typeLine, mv, owner });
const call = (node: string, args: NodeCall["args"], as?: string): NodeCall => ({ node, args, ...(as ? { as } : {}) });
const bookOf = (bodies: Record<string, NodeCall[]>): RuleBook => ({ get: (c) => (bodies[c] ? { card: c, abilities: [{ kind: "spell", body: bodies[c] }] } : undefined) });
// A がソーサリー "spell" を唱えて、全員がパスして解決するまで
const run = (body: NodeCall[], setup: (g: Game) => void = () => {}, targets: Record<string, string> = {}) => {
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("spell", "Sorcery"));
  setup(g);
  const book = bookOf({ spell: body });
  castSpell(g, "A", "spell", targets, book);
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  return g;
};
const ids = (cs: GameCard[]) => cs.map((c) => c.id);

// draw: 一番上から引く
{
  const g = run([call("draw", { player: "you", count: 2 })], (g) => (g.libraries["A"] = [card("c1"), card("c2"), card("c3")]));
  assert.deepEqual(ids(g.hands["A"]), ["c1", "c2"]);
  assert.deepEqual(ids(g.libraries["A"]), ["c3"]);
}
// ライブラリーが足りないとき: 引ける分だけ引き、例外は出さず、記録を残す (Review Focus 1)
{
  const g = run([call("draw", { player: "you", count: 2 })], (g) => (g.libraries["A"] = [card("c1")]));
  assert.deepEqual(ids(g.hands["A"]), ["c1"]);
  assert.ok(g.log.some((l) => l.includes("ライブラリー")));
}
// opponents は相手が引く
{
  const g = run([call("draw", { player: "opponents", count: 1 })], (g) => (g.libraries["B"] = [card("b1", "Instant", "B")]));
  assert.deepEqual(ids(g.hands["B"]), ["b1"]);
  assert.deepEqual(ids(g.hands["A"]), []);
}
// discard: 既定は手札の後ろから。手札が足りないときは、ある分だけ (Review Focus 2)
{
  const g = run([call("discard", { player: "you", count: 1 })], (g) => g.hands["A"].push(card("x"), card("y")));
  assert.deepEqual(ids(g.hands["A"]), ["x"]);
  assert.deepEqual(ids(g.graveyards["A"]), ["y", "spell"], "捨てたカード、そのあと呪文自身");
  const h = run([call("discard", { player: "you", count: 2 })], (g) => g.hands["A"].push(card("x")));
  assert.deepEqual(ids(h.hands["A"]), []);
  assert.deepEqual(ids(h.graveyards["A"]), ["x", "spell"]);
}
// 判断の差し替え口: 捨てるカードを選べる
{
  const g = run([call("discard", { player: "you", count: 1 })], (g) => {
    g.hands["A"].push(card("x"), card("y"));
    g.decide = { discard: (game, p) => [game.hands[p][0]] };
  });
  assert.deepEqual(ids(g.hands["A"]), ["y"]);
}

// bounce: 戦場のパーマネントを持ち主の手札へ。target は zone=battlefield kind=permanent
const perm = (id: string, typeLine: string, owner = "B") => ({ id, card: card(id, typeLine, owner), controller: owner });
const bounceBody = [call("target", { zone: "battlefield", kind: "permanent", notType: "land" }, "t"), call("bounce", { target: { ref: "t" } })];
{
  const g = run(bounceBody, (g) => g.battlefield.push(perm("bear", "Creature — Bear")), { t: "bear" });
  assert.deepEqual(g.battlefield, []);
  assert.deepEqual(ids(g.hands["B"]), ["bear"], "持ち主の手札へ");
}
// 土地は対象にできない / 組み合わせが違う zone と kind も対象無し (castSpell が RuleError)
{
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("spell", "Sorcery"));
  g.battlefield.push(perm("isle", "Basic Land — Island"));
  const book = bookOf({ spell: bounceBody });
  assert.throws(() => castSpell(g, "A", "spell", { t: "isle" }, book));
  const bad = bookOf({ spell: [call("target", { zone: "battlefield", kind: "spell" }, "t")] });
  g.battlefield.push(perm("bear", "Creature — Bear"));
  assert.throws(() => castSpell(g, "A", "spell", { t: "bear" }, bad));
}
// 解決前に対象が戦場から消えたら、何もしない (Review Focus 3)
{
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("spell", "Sorcery"));
  g.battlefield.push(perm("bear", "Creature — Bear"));
  const book = bookOf({ spell: bounceBody });
  castSpell(g, "A", "spell", { t: "bear" }, book);
  g.battlefield = [];
  passPriority(g, "A", book);
  assert.doesNotThrow(() => passPriority(g, "B", book));
  assert.deepEqual(ids(g.hands["B"]), []);
  assert.ok(g.log.some((l) => l.includes("対象が無くなった")));
}

// counter の unlessPay: 対象のコントローラーが払えば打ち消されない (Review Focus 4)
const unlessBody = [call("target", { zone: "stack", kind: "spell" }, "t"), call("counter", { target: { ref: "t" }, unlessPay: 4 })];
const duel = (mana: number, decide?: Game["decide"]) => {
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("bolt"));
  g.hands["B"].push(card("snag", "Instant", "B"));
  g.mana["A"] = mana;
  g.decide = decide;
  const book = bookOf({ bolt: [], snag: unlessBody });
  castSpell(g, "A", "bolt", {}, book);
  passPriority(g, "A", book);
  castSpell(g, "B", "snag", { t: "bolt" }, book);
  passPriority(g, "B", book);
  passPriority(g, "A", book);
  return g;
};
{
  const paid = duel(4);
  assert.deepEqual(paid.stack.map((s) => s.id), ["bolt"], "払ったので打ち消されない");
  assert.equal(paid.mana["A"], 0);
  const short = duel(3);
  assert.deepEqual(short.stack, [], "払えないので打ち消される");
  assert.deepEqual(ids(short.graveyards["A"]), ["bolt"]);
  assert.equal(short.mana["A"], 3, "払えなければマナは減らない");
  const refuse = duel(4, { pay: () => false });
  assert.deepEqual(refuse.stack, [], "払わないと決めたら打ち消される");
  assert.equal(refuse.mana["A"], 4);
  const liar = duel(3, { pay: () => true });
  assert.deepEqual(liar.stack, [], "払うと言っても、マナが足りなければ打ち消される");
}

// プレイヤーを対象にする (Ancestral Recall の "Target player draws three cards"): target zone=player kind=player + draw player=target
const recall = [call("target", { zone: "player", kind: "player" }, "t"), call("draw", { player: "target", target: { ref: "t" }, count: 3 })];
{
  const lib = (o: string) => [card(`${o}1`), card(`${o}2`), card(`${o}3`), card(`${o}4`)];
  const other = run(recall, (g) => (g.libraries["B"] = lib("b")), { t: "B" });
  assert.deepEqual(ids(other.hands["B"]), ["b1", "b2", "b3"], "対象に選んだ相手が引く");
  assert.deepEqual(ids(other.hands["A"]), []);
  const self = run(recall, (g) => (g.libraries["A"] = lib("a")), { t: "A" });
  assert.deepEqual(ids(self.hands["A"]), ["a1", "a2", "a3"], "自分も対象にできる");
  // 存在しないプレイヤーは対象にできない
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("spell", "Sorcery"));
  assert.throws(() => castSpell(g, "A", "spell", { t: "Z" }, bookOf({ spell: recall })));
  // player=target で対象を渡し忘れても、落ちずに記録を残す
  const lost = run([call("draw", { player: "target", count: 1 })], (g) => (g.libraries["A"] = lib("a")));
  assert.ok(lost.log.some((l) => l.includes("対象のプレイヤーが無い")));
  assert.deepEqual(ids(lost.hands["A"]), []);
}

// tap / untap: 戦場のパーマネントの状態。対象の controller 絞り込み (you = 呪文のコントローラー / opponents = それ以外)
{
  const mine = { id: "mine", card: card("mine", "Creature — Wizard", "A"), controller: "A", tapped: true };
  const theirs = { id: "theirs", card: card("theirs", "Creature — Bear", "B"), controller: "B" };
  const untapMine = [call("target", { zone: "battlefield", kind: "permanent", type: "creature", controller: "you" }, "t"), call("untap", { target: { ref: "t" } })];
  const g = run(untapMine, (g) => g.battlefield.push(mine, theirs), { t: "mine" });
  assert.equal(g.battlefield.find((p) => p.id === "mine")!.tapped, false, "アンタップされる");
  // 相手のクリーチャーは controller=you では対象にできない
  const h = createGame(["A", "B"]);
  h.hands["A"].push(card("spell", "Sorcery"));
  h.battlefield.push(theirs);
  assert.throws(() => castSpell(h, "A", "spell", { t: "theirs" }, bookOf({ spell: untapMine })));
  // opponents は逆
  const tapTheirs = [call("target", { zone: "battlefield", kind: "permanent", controller: "opponents" }, "t"), call("tap", { target: { ref: "t" } })];
  const i = run(tapTheirs, (g) => g.battlefield.push(mine, theirs), { t: "theirs" });
  assert.equal(i.battlefield.find((p) => p.id === "theirs")!.tapped, true, "タップされる");
  const j = createGame(["A", "B"]);
  j.hands["A"].push(card("spell", "Sorcery"));
  j.battlefield.push(mine);
  assert.throws(() => castSpell(j, "A", "spell", { t: "mine" }, bookOf({ spell: tapTheirs })));
  // 解決前に消えた対象は、何もしない (例外なし)
  const k = createGame(["A", "B"]);
  k.hands["A"].push(card("spell", "Sorcery"));
  k.battlefield.push({ ...theirs });
  const book = bookOf({ spell: tapTheirs });
  castSpell(k, "A", "spell", { t: "theirs" }, book);
  k.battlefield = [];
  passPriority(k, "A", book);
  assert.doesNotThrow(() => passPriority(k, "B", book));
}
// スタックの呪文の controller 絞り込み: 相手の呪文だけを打ち消す
{
  const body = [call("target", { zone: "stack", kind: "spell", controller: "opponents" }, "t"), call("counter", { target: { ref: "t" } })];
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("bolt"));
  g.hands["B"].push(card("deny", "Instant", "B"), card("mine2", "Instant", "B"));
  const book = bookOf({ bolt: [], mine2: [], deny: body });
  castSpell(g, "A", "bolt", {}, book);
  passPriority(g, "A", book);
  castSpell(g, "B", "mine2", {}, book);
  assert.throws(() => castSpell(g, "B", "deny", { t: "mine2" }, book), "自分の呪文は対象にできない");
  castSpell(g, "B", "deny", { t: "bolt" }, book);
  assert.equal(g.stack.length, 3);
}

// modify / grant: 修整とキーワードを、持続つきで (Octopus Form)。呪禁は、相手の対象を止める。ターン終了時までの効果は、ターンの終わりに消える
{
  const octopus = [
    call("target", { zone: "battlefield", kind: "permanent", type: "creature", controller: "you" }, "t"),
    call("modify", { target: { ref: "t" }, power: 1, toughness: 1, duration: "endOfTurn" }),
    call("grant", { target: { ref: "t" }, keyword: "hexproof", duration: "endOfTurn" }),
    call("untap", { target: { ref: "t" } }),
  ];
  const wizard = { id: "wiz", card: { ...card("wiz", "Creature — Wizard", "A"), power: 2, toughness: 2, keywords: ["flash"] }, controller: "A", tapped: true };
  const g = run(octopus, (g) => g.battlefield.push(wizard), { t: "wiz" });
  const p = g.battlefield[0];
  assert.deepEqual(statsOf(p), { power: 3, toughness: 3 });
  assert.deepEqual(keywordsOf(p).sort(), ["flash", "hexproof"].sort(), "もとのキーワードと、得たキーワード");
  assert.equal(p.tapped, false);

  // 呪禁: 相手(B)の呪文は、対象にできない。自分(A)は対象にできる
  const poke = [call("target", { zone: "battlefield", kind: "permanent" }, "t"), call("tap", { target: { ref: "t" } })];
  g.hands["B"].push(card("poke", "Instant", "B"));
  g.hands["A"].push(card("self", "Instant", "A"));
  g.priority = "B";
  assert.throws(() => castSpell(g, "B", "poke", { t: "wiz" }, bookOf({ poke })), "呪禁");
  g.priority = "A";
  castSpell(g, "A", "self", { t: "wiz" }, bookOf({ self: poke }));

  // ターンの終わり: ターン終了時までの効果が消える。そのあとは、相手も対象にできる
  const g2 = run(octopus, (g) => g.battlefield.push({ ...wizard }), { t: "wiz" });
  g2.step = "end";
  g2.priority = "A";
  g2.passes = [];
  const book = bookOf({});
  passPriority(g2, "A", book);
  passPriority(g2, "B", book);
  assert.deepEqual(statsOf(g2.battlefield[0]), { power: 2, toughness: 2 });
  assert.deepEqual(keywordsOf(g2.battlefield[0]), ["flash"]);
  g2.hands["B"].push(card("poke", "Instant", "B"));
  g2.priority = "B";
  assert.doesNotThrow(() => castSpell(g2, "B", "poke", { t: "wiz" }, bookOf({ poke })));

  // 持続 forever は残る / パワーの無いカードは statsOf が null
  const g3 = run([call("target", { zone: "battlefield", kind: "permanent" }, "t"), call("modify", { target: { ref: "t" }, power: 2, toughness: 0, duration: "forever" })], (g) => g.battlefield.push({ ...wizard }), { t: "wiz" });
  g3.step = "end";
  g3.priority = "A";
  g3.passes = [];
  passPriority(g3, "A", book);
  passPriority(g3, "B", book);
  assert.deepEqual(statsOf(g3.battlefield[0]), { power: 4, toughness: 2 });
  assert.equal(statsOf({ id: "i", card: card("i", "Artifact"), controller: "A" }), null);
}

// キーワードの表記ゆれ: Scryfall の "Hexproof" / "First strike" も、こちらの "hexproof" / "firstStrike" と同じに扱う
{
  const printed = { id: "p", card: { ...card("p", "Creature — Merfolk", "A"), keywords: ["Hexproof", "First strike"] }, controller: "A" };
  assert.deepEqual(keywordsOf(printed).sort(), ["firststrike", "hexproof"]);
  const g = createGame(["A", "B"]);
  g.hands["B"].push(card("poke", "Instant", "B"));
  g.battlefield.push(printed);
  g.priority = "B";
  assert.throws(() => castSpell(g, "B", "poke", { t: "p" }, bookOf({ poke: [call("target", { zone: "battlefield", kind: "permanent" }, "t")] })), "印刷された呪禁も、相手の対象を止める");
}
