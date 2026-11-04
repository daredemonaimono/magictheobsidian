import assert from "node:assert";
import { RuleError, activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { characteristics } from "../src/battle/continuous";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability[] => [{ kind: "spell", body }];
const act = (...body: NodeCall[]): Ability => ({ kind: "activated", body });
const ids = (cs: GameCard[]) => cs.map((c) => c.id);
const creature = (id: string, owner: string, power = 2, toughness = 2, extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power, toughness }), controller: owner, ...extra });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 60; i++) passPriority(g, g.priority!, book);
  assert.equal(g.stack.length, 0, "スタックが空にならない");
};
const walker = (id: string, owner: string, loyalty: number, typeLine = "Legendary Planeswalker — Chandra"): Perm => ({ id, card: card(id, typeLine, owner, { loyalty }), controller: owner, counters: { loyalty } });
const loyaltyOf = (g: Game, id: string) => g.battlefield.find((p) => p.id === id)?.counters?.loyalty;

// ---- 検査: 数の引数に参照 ($X や countCards の出力) を書ける。型の | (または)。新しいノードの置き場所
assert.equal(checkCall(call("addCounter", { target: { ref: "t" }, kind: "stun", count: { ref: "X" } })), null);
assert.ok(checkCall(call("addCounter", { target: { ref: "t" }, kind: "stun", count: "x" }))?.includes("型が違う"));
for (const n of [call("createToken", { name: "Illusion", types: "Creature — Illusion", power: 1, toughness: 1 }), call("createEmblem", { name: "e" }), call("countCards", { zone: "hand", who: "you" }), call("filter", { from: { ref: "l" } }), call("cost", { loyalty: 1 }), call("cost", { loyaltyX: true }), call("emblem", { name: "e" })]) assert.equal(checkCall(n), null, n.node);
assert.ok(checkCall({ ...call("emblem", { name: "e" }), if: "kicked" })?.includes("条件を付けられない"));
assert.equal(checkCall(call("addMana", { amount: 1, spellNotType: "creature" })), null);

// ---- Chandra, Chill of Compliance
const chandra: Ability[] = [
  act(call("cost", { loyalty: 1 }), call("look", { player: "you", count: 1 }, { as: "l" }), call("choose", { from: { ref: "l" }, count: 1, atMost: true }, { as: "c" }), call("move", { cards: { ref: "c" }, to: "graveyard" }), call("filter", { from: { ref: "c" }, notType: "creature|land" }, { as: "f" }), call("move", { cards: { ref: "f" }, to: "hand" })),
  act(call("cost", { loyalty: 1 }), call("addMana", { amount: 1, spellNotType: "creature" })),
  act(call("cost", { loyaltyX: true }), call("target", { zone: "battlefield", kind: "permanent", type: "artifact|creature" }, { as: "t" }), call("tap", { target: { ref: "t" } }), call("addCounter", { target: { ref: "t" }, kind: "stun", count: { ref: "X" } })),
  act(call("cost", { loyalty: -6 }), call("createEmblem", { name: "chandra" })),
  { kind: "triggered", body: [call("emblem", { name: "chandra" }), call("when", { event: "cast", who: "you" }), call("draw", { player: "you", count: 1 })] },
];
const game = (loyalty = 4) => {
  const g = createGame(["A", "B"]);
  g.battlefield.push(walker("Chandra", "A", loyalty));
  return { g, book: rulesOf({ Chandra: chandra, bolt: spell(), Bear: [] as Ability[] }) };
};
{
  // 戦場に出るときの忠誠度: カードの初期忠誠度が、loyalty カウンターとして置かれる
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("Chandra", "Legendary Planeswalker — Chandra", "A", { loyalty: 4 }));
  const book = rulesOf({ Chandra: chandra });
  castSpell(g, "A", "Chandra", {}, book);
  drain(g, book);
  assert.equal(loyaltyOf(g, "Chandra"), 4);

  // +1 諜報 1: 上のカードを見て、墓地に置くか選ぶ。クリーチャーでも土地でもないカードを墓地に置いたら、手札に加える
  const draws = (top: GameCard, pick: boolean) => {
    const x = game();
    x.g.libraries["A"] = [top, card("rest")];
    if (pick) x.g.decide = { choose: (_g, _p, from) => from };
    activateAbility(x.g, "A", "Chandra", 0, {}, x.book);
    drain(x.g, x.book);
    return x.g;
  };
  const inst = draws(card("spellcard", "Instant", "A"), true);
  assert.deepEqual(ids(inst.hands["A"]), ["spellcard"], "クリーチャーでも土地でもないので、手札へ");
  assert.equal(loyaltyOf(inst, "Chandra"), 5, "+1");
  const creat = draws(card("bear", "Creature — Bear", "A"), true);
  assert.deepEqual(ids(creat.graveyards["A"]), ["bear"], "クリーチャーは墓地に残る");
  assert.deepEqual(ids(creat.hands["A"]), []);
  const land = draws(card("isle", "Basic Land — Island", "A"), true);
  assert.deepEqual(ids(land.graveyards["A"]), ["isle"], "土地も墓地に残る");
  const keep = draws(card("keepme", "Instant", "A"), false);
  assert.deepEqual(ids(keep.libraries["A"]), ["keepme", "rest"], "墓地に置かないなら、上に残る (既定は置かない)");

  // +1 制限つきマナ: クリーチャーでない呪文を唱えるためにしか使えない
  const m = game();
  m.g.payManaCosts = true;
  m.g.hands["A"].push(card("bolt", "Instant", "A", { mv: 1 }), card("Bear", "Creature — Bear", "A", { mv: 1, power: 1, toughness: 1 }));
  activateAbility(m.g, "A", "Chandra", 1, {}, m.book);
  drain(m.g, m.book);
  assert.deepEqual(m.g.restrictedMana["A"], [{ amount: 1, notType: "creature" }]);
  assert.throws(() => castSpell(m.g, "A", "Bear", {}, m.book), RuleError, "クリーチャー呪文には使えない");
  assert.equal(m.g.restrictedMana["A"][0].amount, 1, "払えなければ、減らない");
  castSpell(m.g, "A", "bolt", {}, m.book);
  assert.deepEqual(m.g.restrictedMana["A"], [], "クリーチャーでない呪文には使えて、使うと無くなる");
  assert.equal(m.g.mana["A"], 0);
  // 制限つきマナは、起動型能力のコストには使えない
  const a = game();
  a.g.restrictedMana["A"].push({ amount: 5, notType: "creature" });
  a.g.battlefield.push({ id: "Relic", card: card("Relic", "Artifact", "A"), controller: "A" });
  assert.throws(() => activateAbility(a.g, "A", "Relic", 0, {}, rulesOf({ Relic: [act(call("cost", { mana: 1 }), call("draw", { player: "you", count: 1 }))] })), RuleError);

  // −X: 対象のアーティファクトかクリーチャー1つをタップし、X 個の麻痺カウンターを置く。X は忠誠度まで
  const x = game();
  x.g.battlefield.push(creature("ox", "B"));
  activateAbility(x.g, "A", "Chandra", 2, { t: "ox" }, x.book, [], 3);
  drain(x.g, x.book);
  assert.equal(loyaltyOf(x.g, "Chandra"), 1, "−3");
  const ox = x.g.battlefield.find((p) => p.id === "ox")!;
  assert.equal(ox.tapped, true);
  assert.equal(ox.counters?.stun, 3, "X 個の麻痺カウンター");
  const big = game();
  big.g.battlefield.push(creature("ox", "B"));
  assert.throws(() => activateAbility(big.g, "A", "Chandra", 2, { t: "ox" }, big.book, [], 5), RuleError, "X は忠誠度まで");
  assert.equal(loyaltyOf(big.g, "Chandra"), 4);
  // 型の | (または): アーティファクトも対象にできる。土地は対象にできない
  const art = game();
  art.g.battlefield.push({ id: "relic", card: card("relic", "Artifact", "B"), controller: "B" }, { id: "isl", card: card("isl", "Basic Land — Island", "B"), controller: "B" });
  assert.doesNotThrow(() => activateAbility(art.g, "A", "Chandra", 2, { t: "relic" }, art.book, [], 1));
  const land2 = game();
  land2.g.battlefield.push({ id: "isl", card: card("isl", "Basic Land — Island", "B"), controller: "B" });
  assert.throws(() => activateAbility(land2.g, "A", "Chandra", 2, { t: "isl" }, land2.book, [], 1), RuleError);

  // −6 紋章: 紋章を得る。紋章は戦場の外に残り、Chandra が墓地へ行っても (忠誠度 0) 働く。自分が呪文を唱えるたびに引く
  const e = game(6);
  e.g.libraries["A"] = [card("l1"), card("l2"), card("l3")];
  e.g.hands["A"].push(card("bolt"));
  activateAbility(e.g, "A", "Chandra", 3, {}, e.book);
  assert.equal(e.g.battlefield.some((p) => p.id === "Chandra"), false, "忠誠度 0 で、墓地へ (状態起因処理)");
  assert.deepEqual(ids(e.g.graveyards["A"]), ["Chandra"]);
  drain(e.g, e.book);
  assert.equal(e.g.emblems.length, 1, "紋章を得た");
  castSpell(e.g, "A", "bolt", {}, e.book);
  assert.equal(e.g.stack.length, 2, "紋章の誘発型能力が積まれる");
  drain(e.g, e.book);
  assert.deepEqual(ids(e.g.hands["A"]), ["l1"], "呪文を唱えたので引いた");
  e.g.hands["B"].push(card("zap", "Instant", "B"));
  e.g.priority = "B";
  castSpell(e.g, "B", "zap", {}, rulesOf({ Chandra: chandra, zap: spell() }));
  assert.equal(e.g.stack.length, 1, "相手の呪文では誘発しない");

  // 忠誠度能力のルール: 足りない忠誠度は払えない / 1ターンに1回 / ソーサリーのタイミング (ルールに timing が無くても)
  const poor = game(5);
  assert.throws(() => activateAbility(poor.g, "A", "Chandra", 3, {}, poor.book), RuleError, "忠誠度 5 では −6 を払えない");
  assert.equal(loyaltyOf(poor.g, "Chandra"), 5);
  const once = game();
  activateAbility(once.g, "A", "Chandra", 1, {}, once.book);
  drain(once.g, once.book);
  assert.throws(() => activateAbility(once.g, "A", "Chandra", 0, {}, once.book), RuleError, "1ターンに1回");
  for (let round = 0; round < 2; round++) {
    once.g.step = "end";
    passPriority(once.g, once.g.priority!, once.book);
    passPriority(once.g, once.g.priority!, once.book); // ターンが替わる (A → B → A)
  }
  once.g.step = "main1";
  assert.equal(once.g.active, "A");
  assert.doesNotThrow(() => activateAbility(once.g, "A", "Chandra", 0, {}, once.book), "次のターンには、また使える");
  const opp = game();
  opp.g.active = "B";
  opp.g.priority = "A";
  assert.throws(() => activateAbility(opp.g, "A", "Chandra", 0, {}, opp.book), RuleError, "相手のターン");
  const busy = game();
  busy.g.stack.push({ id: "x", card: card("x"), controller: "B", targets: {}, cast: {} });
  assert.throws(() => activateAbility(busy.g, "A", "Chandra", 0, {}, busy.book), RuleError, "スタックが空でない");
}

// ---- The Theorist, Jace Beleren
const jace: Ability[] = [
  { kind: "triggered", body: [call("when", { event: "step", step: "draw", who: "opponents" }), call("draw", { player: "you", count: 1 })] },
  act(call("cost", { loyalty: 1 }), call("createToken", { name: "Illusion", types: "Creature — Illusion", power: 1, toughness: 1, colors: "U" })),
  act(call("cost", { loyalty: -2 }), call("target", { zone: "battlefield", kind: "permanent", type: "artifact|creature", controller: "opponents", min: 0, max: 1 }, { as: "t" }), call("bounce", { target: { ref: "t" } })),
  act(call("cost", { loyalty: -6 }), call("draw", { player: "you", count: 3 }), call("countCards", { zone: "hand", who: "you" }, { as: "n" }), call("select", { zone: "battlefield", kind: "permanent", type: "creature", controller: "you" }, { as: "s" }), call("addCounter", { target: { ref: "s" }, kind: "+1/+1", count: { ref: "n" } })),
];
{
  const jgame = (loyalty = 3) => {
    const g = createGame(["A", "B"]);
    g.battlefield.push(walker("Jace", "A", loyalty, "Legendary Planeswalker — Jace"));
    return { g, book: rulesOf({ Jace: jace }) };
  };
  // 各対戦相手のドロー・ステップの開始時に引く (自分のドロー・ステップでは引かない)
  const t = jgame();
  t.g.libraries["A"] = [card("l1"), card("l2")];
  t.g.active = "B";
  t.g.step = "upkeep";
  t.g.priority = "B";
  passPriority(t.g, "B", t.book);
  passPriority(t.g, "A", t.book);
  assert.equal(t.g.step, "draw");
  assert.equal(t.g.stack.length, 1, "ドロー・ステップの開始時の誘発");
  drain(t.g, t.book);
  assert.deepEqual(ids(t.g.hands["A"]), ["l1"]);
  const own = jgame();
  own.g.active = "A";
  own.g.step = "upkeep";
  own.g.priority = "A";
  passPriority(own.g, "A", own.book);
  passPriority(own.g, "B", own.book);
  assert.equal(own.g.step, "draw");
  assert.equal(own.g.stack.length, 0, "自分のドロー・ステップでは誘発しない");

  // +1 トークン: 青の 1/1 のイリュージョン・クリーチャー。戦場を離れると消える (手札には行かない)
  const k = jgame();
  activateAbility(k.g, "A", "Jace", 0, {}, k.book);
  drain(k.g, k.book);
  const tok = k.g.battlefield.find((p) => p.card.token);
  assert.ok(tok, "トークンができた");
  const now = characteristics(k.g, tok!, k.book);
  assert.deepEqual([now.name, now.typeLine, now.colors, now.power, now.toughness], ["Illusion", "Creature — Illusion", ["U"], 1, 1]);
  assert.equal(loyaltyOf(k.g, "Jace"), 4);
  k.g.hands["A"].push(card("bouncer"));
  k.g.step = "main1";
  const bk = rulesOf({ Jace: jace, bouncer: spell(call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("bounce", { target: { ref: "t" } })) });
  castSpell(k.g, "A", "bouncer", { t: tok!.id }, bk);
  drain(k.g, bk);
  assert.equal(k.g.battlefield.some((p) => p.card.token), false);
  assert.deepEqual(ids(k.g.hands["A"]), [], "トークンは手札に行かず、消える");

  // −2: 対戦相手のコントロールするアーティファクトかクリーチャー最大1つを、持ち主の手札へ
  const b = jgame();
  b.g.battlefield.push(creature("ox", "B"), creature("mine", "A"));
  assert.throws(() => activateAbility(b.g, "A", "Jace", 1, { t: "mine" }, b.book), RuleError, "自分のものは対象にできない");
  activateAbility(b.g, "A", "Jace", 1, { t: "ox" }, b.book);
  drain(b.g, b.book);
  assert.deepEqual(ids(b.g.hands["B"]), ["ox"]);
  assert.equal(loyaltyOf(b.g, "Jace"), 1);
  const none = jgame();
  assert.doesNotThrow(() => activateAbility(none.g, "A", "Jace", 1, {}, none.book), "最大 1 つ: 対象を取らなくてもよい");

  // −6: 3 枚引く。そのあと、自分のクリーチャーそれぞれに、手札の枚数ぶんの +1/+1 カウンター
  const s = jgame(6);
  s.g.libraries["A"] = [card("l1"), card("l2"), card("l3"), card("l4")];
  s.g.hands["A"].push(card("h1"));
  s.g.battlefield.push(creature("c1", "A", 1, 1), creature("c2", "A", 2, 2), creature("enemy", "B", 1, 1));
  activateAbility(s.g, "A", "Jace", 2, {}, s.book);
  drain(s.g, s.book);
  assert.equal(s.g.hands["A"].length, 4, "もとの手札 1 枚 + 3 枚");
  assert.equal(s.g.battlefield.find((p) => p.id === "c1")!.counters?.["+1/+1"], 4);
  assert.equal(s.g.battlefield.find((p) => p.id === "c2")!.counters?.["+1/+1"], 4);
  assert.equal(s.g.battlefield.find((p) => p.id === "enemy")!.counters?.["+1/+1"], undefined, "相手のクリーチャーには置かない");
}

// ---- 状態起因処理: タフネス 0 以下のクリーチャー・付いている先を失ったオーラは墓地へ (トークンは消える)
{
  const shrink = spell(call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("modify", { target: { ref: "t" }, power: -3, toughness: -3, duration: "endOfTurn" }));
  const aura: Ability[] = [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("attach", { target: { ref: "t" } })] }, { kind: "static", body: [call("affect", { who: "attached" }), call("staticModify", { power: 1, toughness: 1 })] }];
  const book = rulesOf({ shrink, Aura: aura, bounce: spell(call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("bounce", { target: { ref: "t" } })) });
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("bear", "A", 2, 2));
  g.hands["A"].push(card("shrink"), card("Aura", "Enchantment — Aura", "A"), card("bounce"));
  castSpell(g, "A", "shrink", { t: "bear" }, book);
  drain(g, book);
  assert.equal(g.battlefield.some((p) => p.id === "bear"), false, "タフネス 0 以下で墓地へ");
  assert.ok(ids(g.graveyards["A"]).includes("bear"));
  // オーラ: 付いている先が離れたら、墓地へ
  const h = createGame(["A", "B"]);
  h.battlefield.push(creature("ox", "A", 2, 2));
  h.hands["A"].push(card("Aura", "Enchantment — Aura", "A"), card("bounce"));
  castSpell(h, "A", "Aura", { t: "ox" }, book);
  drain(h, book);
  assert.equal(h.battlefield.find((p) => p.id === "Aura")!.attachedTo, "ox");
  castSpell(h, "A", "bounce", { t: "ox" }, book);
  drain(h, book);
  assert.equal(h.battlefield.some((p) => p.id === "Aura"), false, "付いている先が離れたので、オーラは墓地へ");
  assert.ok(ids(h.graveyards["A"]).includes("Aura"));
}

// ---- choose の atMost: 0〜count 枚。filter: type / notType (| は または) で絞る
{
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("probe"));
  g.libraries["A"] = [card("a", "Instant"), card("b", "Creature — Bear"), card("c", "Basic Land — Island")];
  const body = spell(
    call("look", { player: "you", count: 3 }, { as: "l" }),
    call("filter", { from: { ref: "l" }, notType: "creature|land" }, { as: "n" }),
    call("filter", { from: { ref: "l" }, type: "creature|land" }, { as: "y" }),
    call("move", { cards: { ref: "n" }, to: "graveyard" }),
    call("move", { cards: { ref: "y" }, to: "hand" }),
  );
  const book = rulesOf({ probe: body });
  castSpell(g, "A", "probe", {}, book);
  drain(g, book);
  assert.deepEqual(ids(g.graveyards["A"]).filter((x) => x !== "probe"), ["a"], "notType=creature|land: どちらでもないもの");
  assert.deepEqual(ids(g.hands["A"]), ["b", "c"], "type=creature|land: どちらかであるもの");
}

// ---- 最終レビューの指摘
// 対象・宣言のノードの引数には、参照を書けない (エンジンが値を解決せずに読むため。TypeError や NaN になる)
for (const n of [call("target", { zone: "battlefield", kind: "permanent", mv: { ref: "X" } }), call("target", { zone: "battlefield", kind: "permanent", max: { ref: "X" } }), call("cost", { mana: { ref: "X" } }), call("additionalCost", { flag: "kicked", mana: { ref: "X" } }), call("modes", { count: { ref: "X" }, min: 1, max: 1 })]) {
  assert.ok(checkCall(n)?.includes("参照を書けない"), `${n.node}: ${checkCall(n)}`);
}

// 参照の検査は共通 (ノード設定画面・AI の返事の検証・状況レポート): X は −X の忠誠度能力の中だけ。数の引数には数の出力、ref の引数には id の出力
{
  const { problems, blankRule } = await import("../src/battle/editor");
  const { cardStatus } = await import("../src/battle/coverage");
  const msgs = (ab: Ability) => problems({ ...blankRule("X"), abilities: [ab] }).map((p) => p.message);
  assert.ok(msgs(act(call("cost", { mana: 1 }), call("draw", { player: "you", count: { ref: "X" } }))).some((m) => m.includes("$X")), "X の無い能力");
  assert.deepEqual(msgs(act(call("cost", { loyaltyX: true }), call("draw", { player: "you", count: { ref: "X" } }))), []);
  assert.ok(msgs({ kind: "spell", body: [call("draw", { player: "you", count: { ref: "X" } })] }).some((m) => m.includes("$X")), "呪文能力には X が無い");
  const numeric = act(call("cost", { loyalty: 1 }), call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" }), call("addCounter", { target: { ref: "t" }, kind: "stun", count: { ref: "t" } }));
  assert.ok(msgs(numeric).some((m) => m.includes("数ではない")), "対象の id を数の引数に渡した");
  const wrongKind = act(call("cost", { loyalty: 1 }), call("countCards", { zone: "hand" }, { as: "n" }), call("bounce", { target: { ref: "n" } }));
  assert.ok(msgs(wrongKind).some((m) => m.includes("id ではない")), "枚数を ref の引数に渡した");
  const good = act(call("cost", { loyalty: 1 }), call("countCards", { zone: "hand" }, { as: "n" }), call("select", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "s" }), call("addCounter", { target: { ref: "s" }, kind: "+1/+1", count: { ref: "n" } }));
  assert.deepEqual(msgs(good), []);
  // 状況レポートでも、未定義の参照は組めていない (unbuilt)
  const bad = cardStatus("Foo", `---\ncard: "[[Foo]]"\n---\n\n## 起動型能力\n\n- cost loyalty=1\n- draw player=you count=$n\n`);
  assert.equal(bad.status, "unbuilt");
  assert.ok(bad.reasons[0].includes("見つからない"), bad.reasons[0]);
}

// loyalty と loyaltyX の併用でも、忠誠度は負にならない
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(walker("W", "A", 3));
  const book = rulesOf({ W: [act(call("cost", { loyalty: -1, loyaltyX: true }), call("draw", { player: "you", count: 0 }))] });
  assert.throws(() => activateAbility(g, "A", "W", 0, {}, book, [], 3), RuleError, "−1 と −3 で −4");
  assert.doesNotThrow(() => activateAbility(g, "A", "W", 0, {}, book, [], 2));
  assert.equal(g.battlefield.some((x) => x.id === "W"), false, "忠誠度0 になり、状況起因処理で墓地へ");
}

// 紋章は、戦場の継続効果 (すべての能力を失う、など) の影響を受けない
{
  const wipe: Ability[] = [{ kind: "static", body: [call("affect", { who: "all" }), call("loseAbilities", {})] }];
  const g = createGame(["A", "B"]);
  g.battlefield.push(walker("Chandra", "A", 4), { id: "Wipe", card: card("Wipe", "Enchantment", "A"), controller: "A" });
  g.emblems.push({ id: "emblem#1", card: card("Chandra", "Legendary Planeswalker — Chandra", "A"), controller: "A", emblem: "chandra" });
  g.hands["A"].push(card("bolt"));
  const book = rulesOf({ Chandra: chandra, Wipe: wipe, bolt: spell() });
  castSpell(g, "A", "bolt", {}, book);
  assert.equal(g.stack.length, 2, "紋章の誘発は止まらない");
}
