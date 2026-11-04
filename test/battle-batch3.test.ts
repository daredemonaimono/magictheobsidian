import assert from "node:assert";
import { RuleError, activateAbility, canCastNow, castSpell, passPriority, playLand } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame, keywordsOf, statsOf } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability[] => [{ kind: "spell", body }];
const trig = (...body: NodeCall[]): Ability => ({ kind: "triggered", body });
const ids = (cs: GameCard[]) => cs.map((c) => c.id);
const creature = (id: string, owner: string, extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power: 2, toughness: 2 }), controller: owner, ...extra });
// スタックが空になるまで、優先権を持つ人が順にパスする
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 50; i++) passPriority(g, g.priority!, book);
  assert.equal(g.stack.length, 0, "スタックが空にならない");
};

// ---- 条件の検査: when は誘発型能力だけ・宣言なので if を付けられない、keyword は常在型能力だけ
assert.equal(checkCall(call("when", { event: "cast" })), null);
assert.ok(checkCall(call("when", { event: "cast" }, { if: "kicked" }))?.includes("条件を付けられない"));
assert.ok(checkCall(call("when", { event: "nope" }))?.includes("選べない値"));
assert.equal(checkCall(call("keyword", { name: "flash" })), null);
assert.equal(checkCall(call("addCounter", { target: { ref: "t" }, kind: "stun", count: 1 })), null);
assert.ok(checkCall(call("addCounter", { target: { ref: "t" }, kind: "stun", count: -1 }))?.includes("小さすぎる"));

// ---- 土地を出す: 自分のメインフェイズ、スタックが空、1ターンに1枚。出した土地のマナ能力が使える (Island)
{
  const island = (id: string) => card(id, "Basic Land — Island", "A");
  const book = rulesOf({ Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1 })] }] });
  const g = createGame(["A", "B"]);
  g.hands["A"].push({ ...island("i1"), name: "Island" }, { ...island("i2"), name: "Island" }, card("bolt"));
  playLand(g, "A", "i1", book);
  assert.deepEqual(g.battlefield.map((p) => p.id), ["i1"]);
  assert.ok(!g.battlefield[0].tapped, "出た土地はアンタップ");
  assert.throws(() => playLand(g, "A", "i2", book), RuleError, "1ターンに1枚");
  assert.throws(() => playLand(g, "A", "bolt", book), RuleError, "土地ではない");
  activateAbility(g, "A", "i1", 0, {}, book);
  assert.equal(g.mana["A"], 1, "出した Island でマナが出る");
  // 次の自分のターンには、また出せる
  g.step = "end";
  for (let k = 0; k < 2; k++) passPriority(g, g.priority!, book); // A のターン終了 → B
  g.step = "end";
  for (let k = 0; k < 2; k++) passPriority(g, g.priority!, book); // B のターン終了 → A
  assert.equal(g.active, "A");
  g.step = "main1";
  assert.doesNotThrow(() => playLand(g, "A", "i2", book));
  // 相手のターン・スタックが空でない・メインフェイズ以外は出せない
  const h = createGame(["A", "B"]);
  h.hands["B"].push({ ...island("i3"), name: "Island", owner: "B" });
  h.priority = "B";
  assert.throws(() => playLand(h, "B", "i3", book), RuleError, "相手のターン");
  const s = createGame(["A", "B"]);
  s.hands["A"].push({ ...island("i4"), name: "Island" });
  s.stack.push({ id: "x", card: card("x"), controller: "B", targets: {}, cast: {} });
  assert.throws(() => playLand(s, "A", "i4", book), RuleError, "スタックが空でない");
  const c = createGame(["A", "B"]);
  c.hands["A"].push({ ...island("i5"), name: "Island" });
  c.step = "combat";
  assert.throws(() => playLand(c, "A", "i5", book), RuleError, "メインフェイズ以外");
}

// ---- パーマネント呪文は戦場に出る。出たとき・離れたときの誘発型能力 (Cryogen Relic): スタックに積まれ、解決で効果が出る
const relic: Ability[] = [
  trig(call("when", { event: "enters", self: true }), call("draw", { player: "you", count: 1 })),
  trig(call("when", { event: "leaves", self: true }), call("draw", { player: "you", count: 1 })),
  { kind: "activated", body: [call("cost", { mana: 2, sacrifice: true }), call("target", { zone: "battlefield", kind: "permanent", type: "creature", tapped: true, min: 0, max: 1 }, { as: "t" }), call("addCounter", { target: { ref: "t" }, kind: "stun", count: 1 })] },
];
{
  const book = rulesOf({ Relic: relic });
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("Relic", "Artifact", "A"));
  g.libraries["A"] = [card("l1"), card("l2"), card("l3")];
  g.battlefield.push(creature("x1", "B", { tapped: true }));
  castSpell(g, "A", "Relic", {}, book); // 呪文能力の無いパーマネントも、ルールがあれば唱えられる
  assert.equal(g.stack.length, 1);
  passPriority(g, "A", book);
  passPriority(g, "B", book); // 解決 → 戦場に出る → 出たときの誘発がスタックに積まれる
  assert.deepEqual(g.battlefield.map((p) => p.id).sort(), ["Relic", "x1"], "墓地ではなく戦場に出た");
  assert.deepEqual(ids(g.graveyards["A"]), []);
  assert.equal(g.stack.length, 1, "出たときの誘発型能力がスタックにある");
  assert.deepEqual(ids(g.hands["A"]), [], "まだ引いていない");
  drain(g, book);
  assert.deepEqual(ids(g.hands["A"]), ["l1"], "出たとき: 引く");

  // 生け贄に捧げる起動型能力: 離れたときの誘発 (離れた自分自身を見る) が、能力より上に積まれる
  g.mana["A"] = 2;
  activateAbility(g, "A", "Relic", 0, { t: "x1" }, book);
  assert.deepEqual(g.battlefield.map((p) => p.id), ["x1"]);
  assert.equal(g.stack.length, 2, "起動型能力と、離れたときの誘発");
  assert.ok(g.stack[1].body && g.stack[1].source === "Relic", "誘発の方が上");
  drain(g, book);
  assert.deepEqual(ids(g.hands["A"]), ["l1", "l2"], "離れたとき: 引く");
  assert.equal(g.battlefield[0].counters?.stun, 1, "麻痺カウンターが置かれた");
  assert.deepEqual(ids(g.graveyards["A"]), ["Relic"]);
}
// インスタント・ソーサリーは、これまでどおり墓地へ。呪文能力もルールも無いカードは唱えられない
{
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("bolt"), card("Mystery", "Artifact", "A"));
  const book = rulesOf({ bolt: spell() });
  castSpell(g, "A", "bolt", {}, book);
  drain(g, book);
  assert.deepEqual(ids(g.graveyards["A"]), ["bolt"]);
  assert.deepEqual(g.battlefield, []);
  assert.throws(() => castSpell(g, "A", "Mystery", {}, book), RuleError, "ルールが無い");
}

// ---- 誘発型: 呪文を唱えたとき (Brineborn Cutthroat): 自分が相手のターン中に唱えたときだけ +1/+1 カウンター。パワー・タフネスに反映
const cutthroat: Ability[] = [trig(call("when", { event: "cast", who: "you", turn: "opponents" }), call("self", {}, { as: "s" }), call("addCounter", { target: { ref: "s" }, kind: "+1/+1", count: 1 })), { kind: "static", body: [call("keyword", { name: "flash" })] }];
{
  const book = rulesOf({ Cutthroat: cutthroat, bolt: spell() });
  const setup = (active: string) => {
    const g = createGame(["A", "B"]);
    g.battlefield.push({ id: "Cutthroat", card: card("Cutthroat", "Creature — Merfolk Pirate", "A", { power: 1, toughness: 2 }), controller: "A" });
    g.hands["A"].push(card("bolt", "Instant", "A"));
    g.hands["B"].push(card("zap", "Instant", "B"));
    g.active = active;
    g.priority = "A";
    return g;
  };
  const opp = setup("B");
  castSpell(opp, "A", "bolt", {}, book);
  assert.equal(opp.stack.length, 2, "唱えた呪文の上に、誘発が積まれる");
  drain(opp, book);
  assert.deepEqual(statsOf(opp.battlefield[0]), { power: 2, toughness: 3 }, "+1/+1 カウンター");
  const own = setup("A");
  castSpell(own, "A", "bolt", {}, book);
  assert.equal(own.stack.length, 1, "自分のターン中は誘発しない");
  // 相手が唱えても誘発しない
  const theirs = setup("B");
  theirs.priority = "B";
  castSpell(theirs, "B", "zap", {}, rulesOf({ Cutthroat: cutthroat, zap: spell() }));
  assert.equal(theirs.stack.length, 1);
}

// ---- 果敢 (Elementalist Adept): 自分がクリーチャーでない呪文を唱えたとき +1/+1 (ターン終了時まで)。クリーチャー呪文では誘発しない
const adept: Ability[] = [trig(call("when", { event: "cast", who: "you", notType: "creature" }), call("self", {}, { as: "s" }), call("modify", { target: { ref: "s" }, power: 1, toughness: 1, duration: "endOfTurn" }))];
{
  const book = rulesOf({ Adept: adept, bolt: spell(), Bear: [] as Ability[] });
  const g = createGame(["A", "B"]);
  g.battlefield.push({ id: "Adept", card: card("Adept", "Creature — Human Wizard", "A", { power: 2, toughness: 2 }), controller: "A" });
  g.hands["A"].push(card("bolt"), card("Bear", "Creature — Bear", "A", { power: 1, toughness: 1 }));
  castSpell(g, "A", "Bear", {}, book);
  assert.equal(g.stack.length, 1, "クリーチャー呪文では誘発しない");
  drain(g, book);
  assert.deepEqual(statsOf(g.battlefield.find((p) => p.id === "Adept")!), { power: 2, toughness: 2 });
  castSpell(g, "A", "bolt", {}, book);
  drain(g, book);
  assert.deepEqual(statsOf(g.battlefield.find((p) => p.id === "Adept")!), { power: 3, toughness: 3 }, "果敢");
  g.step = "end";
  g.priority = "A";
  g.passes = [];
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.deepEqual(statsOf(g.battlefield.find((p) => p.id === "Adept")!), { power: 2, toughness: 2 }, "ターン終了時に戻る");
}

// ---- 麻痺カウンター: アンタップするかわりに、1つ取り除く (置換効果)。アンタップ・ステップでも untap ノードでも
{
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("x1", "B", { tapped: true, counters: { stun: 1 } }));
  const book = rulesOf({});
  g.step = "end";
  passPriority(g, "A", book);
  passPriority(g, "B", book); // B のターンのアンタップ
  assert.equal(g.battlefield[0].tapped, true, "麻痺カウンターがあるので、アンタップされない");
  assert.equal(g.battlefield[0].counters?.stun, 0, "かわりに1つ取り除かれる");
  g.step = "end";
  passPriority(g, g.priority!, book);
  passPriority(g, g.priority!, book); // A のターン
  g.step = "end";
  passPriority(g, g.priority!, book);
  passPriority(g, g.priority!, book); // また B のターン
  assert.equal(g.battlefield[0].tapped, false, "次のターンにはアンタップされる");

  const u = createGame(["A", "B"]);
  u.hands["A"].push(card("untapper"));
  u.battlefield.push(creature("x2", "B", { tapped: true, counters: { stun: 1 } }));
  const ub = rulesOf({ untapper: spell(call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" }), call("untap", { target: { ref: "t" } })) });
  castSpell(u, "A", "untapper", { t: "x2" }, ub);
  drain(u, ub);
  assert.equal(u.battlefield[0].tapped, true, "untap ノードも、アンタップのかわりに取り除く");
  assert.equal(u.battlefield[0].counters?.stun, 0);
}

// ---- +1/+1 カウンターはパワー・タフネスに足される。キーワードの宣言 (keyword): 瞬速で唱えられ、戦場に出るとキーワードを得る
{
  assert.deepEqual(statsOf({ id: "p", card: card("p", "Creature", "A", { power: 1, toughness: 1 }), controller: "A", counters: { "+1/+1": 2 } }), { power: 3, toughness: 3 });
  const merfolk = (flash: boolean): { g: Game; book: RuleBook } => {
    const g = createGame(["A", "B"]);
    g.hands["B"].push(card("Merfolk", "Creature — Merfolk", "B", { power: 1, toughness: 1 }));
    const body: Ability[] = flash ? [{ kind: "static", body: [call("keyword", { name: "flash" }), call("keyword", { name: "hexproof" })] }] : [];
    return { g, book: rulesOf({ Merfolk: body }) };
  };
  const yes = merfolk(true);
  yes.g.priority = "B"; // 相手のターンに、優先権を得た
  assert.ok(canCastNow(yes.g, "B", yes.g.hands["B"][0], yes.book), "瞬速を宣言していれば、相手のターンにも唱えられる");
  castSpell(yes.g, "B", "Merfolk", {}, yes.book);
  drain(yes.g, yes.book);
  assert.deepEqual(keywordsOf(yes.g.battlefield[0]).sort(), ["flash", "hexproof"], "戦場に出ると、宣言したキーワードを得る");
  const no = merfolk(false);
  no.g.priority = "B";
  assert.ok(!canCastNow(no.g, "B", no.g.hands["B"][0], no.book));
  assert.throws(() => castSpell(no.g, "B", "Merfolk", {}, no.book), RuleError);
}

// ---- 最終レビューの指摘
// 土地は唱えられない (playLand の 1ターン1枚の制限を抜けられていた)
{
  const book = rulesOf({ Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1 })] }] });
  const g = createGame(["A", "B"]);
  g.hands["A"].push({ ...card("i1", "Basic Land — Island", "A"), name: "Island" });
  assert.throws(() => castSpell(g, "A", "i1", {}, book), RuleError, "土地は唱えられない");
  assert.equal(g.stack.length, 0);
}

// 誘発型能力の最初のノードは when (それ以外の位置の when も、きっかけにならない)。黙って誘発しないのを防ぐ
{
  const first = trig(call("when", { event: "enters", self: true }), call("draw", { player: "you", count: 1 }));
  const notFirst = trig(call("self", {}, { as: "s" }), call("when", { event: "enters", self: true }), call("draw", { player: "you", count: 1 }));
  const noWhen = trig(call("draw", { player: "you", count: 1 }));
  const { problems, blankRule } = await import("../src/battle/editor");
  const msgs = (ab: Ability) => problems({ ...blankRule("X"), abilities: [ab] }).map((p) => p.message);
  assert.deepEqual(msgs(first), []);
  assert.ok(msgs(notFirst).some((m) => m.includes("最初のノード")), "when が先頭にない");
  assert.ok(msgs(noWhen).some((m) => m.includes("最初のノード")), "when が無い");
  const { cardStatus } = await import("../src/battle/coverage");
  const bad = cardStatus("X", `---\ncard: "[[X]]"\n---\n\n## 誘発型能力\n\n- draw player=you count=1\n`);
  assert.equal(bad.status, "unbuilt");
  assert.ok(bad.reasons[0].includes("最初のノード"), bad.reasons[0]);
}

// 対象を取る誘発型能力 (誘発時に対象を選べない) は、対象が無いので解決しない。残りの効果だけが実行されない
{
  const rule = rulesOf({ Gob: [trig(call("when", { event: "enters", self: true }), call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("tap", { target: { ref: "t" } }), call("draw", { player: "you", count: 1 }))] });
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("Gob", "Creature — Goblin", "A", { power: 1, toughness: 1 }));
  g.libraries["A"] = [card("l1")];
  castSpell(g, "A", "Gob", {}, rule);
  drain(g, rule);
  assert.deepEqual(ids(g.hands["A"]), [], "対象が無いので、引く効果も実行されない");
  assert.ok(g.log.some((l) => l.includes("対象が無くなった")));
}

// 誘発型能力が積まれても、呪文を唱えた本人が優先権を持つ (積まれた誘発に、先に応答できる)
{
  const book = rulesOf({ Cutthroat: cutthroat, bolt: spell() });
  const g = createGame(["A", "B"]);
  g.battlefield.push({ id: "Cutthroat", card: card("Cutthroat", "Creature — Merfolk Pirate", "A", { power: 1, toughness: 2 }), controller: "A" });
  g.hands["A"].push(card("bolt"));
  g.active = "B";
  g.priority = "A";
  castSpell(g, "A", "bolt", {}, book);
  assert.equal(g.stack.length, 2);
  assert.equal(g.priority, "A", "唱えた本人が優先権を持つ");
}
