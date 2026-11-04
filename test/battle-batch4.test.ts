import assert from "node:assert";
import { characteristics } from "../src/battle/continuous";
import { RuleError, activateAbility, castSpell, passPriority } from "../src/battle/engine";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { checkCall, resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const card = (id: string, typeLine = "Instant", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const spell = (...body: NodeCall[]): Ability[] => [{ kind: "spell", body }];
const trig = (...body: NodeCall[]): Ability => ({ kind: "triggered", body });
const stat = (...body: NodeCall[]): Ability => ({ kind: "static", body });
const ids = (cs: GameCard[]) => cs.map((c) => c.id);
const creature = (id: string, owner: string, power = 2, toughness = 2, extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power, toughness }), controller: owner, ...extra });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 60; i++) passPriority(g, g.priority!, book);
  assert.equal(g.stack.length, 0, "スタックが空にならない");
};
const chars = (g: Game, id: string, book: RuleBook) => characteristics(g, g.battlefield.find((p) => p.id === id)!, book);

// ---- 検査: 継続効果のノードは常在型能力だけ・宣言なので if を付けられない。常在型能力は affect で始める
for (const n of [call("affect", { who: "attached" }), call("staticModify", { power: 1, toughness: 1 }), call("staticGrant", { keyword: "flying" }), call("loseAbilities", {}), call("setBaseStats", { power: 1, toughness: 1 }), call("setTypes", { types: "Creature" }), call("setColors", { colors: "G" }), call("setName", { name: "X" }), call("extraTriggers", { amount: 1 }), call("reduceCost", { amount: 1 }), call("timing", { sorcery: true })]) {
  assert.equal(checkCall(n), null, n.node);
  assert.ok(checkCall({ ...n, if: "kicked" })?.includes("条件を付けられない"), `${n.node} に if`);
}
assert.ok(checkCall(call("affect", { who: "nope" }))?.includes("選べない値"));
{
  const { problems, blankRule, addAbility, removeAbility, addNode } = await import("../src/battle/editor");
  let r = addAbility(removeAbility(blankRule("X"), 0), "static");
  r = addNode(r, 0, "staticModify");
  assert.ok(problems(r).some((p) => p.message.includes("affect")), "効果のノードが affect で始まっていない");
  const ok = addNode(addNode(addAbility(removeAbility(blankRule("X"), 0), "static"), 0, "affect"), 0, "staticModify");
  assert.deepEqual(problems(ok), []);
  const reduce = addNode(addAbility(removeAbility(blankRule("X"), 0), "static"), 0, "reduceCost");
  assert.deepEqual(problems(reduce), [], "reduceCost は affect が要らない");
}

// ---- 装備 (Illvoi Light Jammer): 出たとき、自分のクリーチャー1体に付ける (誘発時に対象を自動で選ぶ)。付いているクリーチャーは +1/+2。装備 {3} はソーサリーのタイミングだけ
const jammer: Ability[] = [
  trig(call("when", { event: "enters", self: true }), call("target", { zone: "battlefield", kind: "permanent", type: "creature", controller: "you" }, { as: "t" }), call("attach", { target: { ref: "t" } }), call("grant", { target: { ref: "t" }, keyword: "hexproof", duration: "endOfTurn" })),
  stat(call("affect", { who: "attached" }), call("staticModify", { power: 1, toughness: 2 })),
  stat(call("keyword", { name: "flash" })),
  { kind: "activated", body: [call("timing", { sorcery: true }), call("cost", { mana: 3 }), call("target", { zone: "battlefield", kind: "permanent", type: "creature", controller: "you" }, { as: "t" }), call("attach", { target: { ref: "t" } })] },
];
{
  const book = rulesOf({ Jammer: jammer, poke: spell(call("target", { zone: "battlefield", kind: "permanent" }, { as: "t" })) });
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("Jammer", "Artifact — Equipment", "A"));
  g.battlefield.push(creature("bear", "A"), creature("ox", "A", 3, 3));
  castSpell(g, "A", "Jammer", {}, book);
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.equal(g.stack.length, 1, "出たときの誘発が、対象を自動で選んで積まれた");
  assert.deepEqual(g.stack[0].targets, { t: "bear" }, "条件に合う最初の対象");
  drain(g, book);
  assert.equal(g.battlefield.find((p) => p.id === "Jammer")!.attachedTo, "bear");
  assert.deepEqual([chars(g, "bear", book).power, chars(g, "bear", book).toughness], [3, 4], "付いているクリーチャーは +1/+2");
  assert.deepEqual([chars(g, "ox", book).power, chars(g, "ox", book).toughness], [3, 3], "付いていないものは変わらない");
  assert.ok(chars(g, "bear", book).keywords.includes("hexproof"), "ターン終了時までの呪禁");
  g.hands["B"].push(card("poke", "Instant", "B"));
  g.priority = "B";
  assert.throws(() => castSpell(g, "B", "poke", { t: "bear" }, book), RuleError, "呪禁");

  // 装備: ソーサリーのタイミング・マナ 3・自分のクリーチャー。付け替えると、前のクリーチャーは元に戻る
  g.priority = "A";
  g.mana["A"] = 3;
  activateAbility(g, "A", "Jammer", 0, { t: "ox" }, book);
  drain(g, book);
  assert.equal(g.battlefield.find((p) => p.id === "Jammer")!.attachedTo, "ox");
  assert.deepEqual([chars(g, "bear", book).power, chars(g, "bear", book).toughness], [2, 2]);
  assert.deepEqual([chars(g, "ox", book).power, chars(g, "ox", book).toughness], [4, 5]);
  assert.equal(g.mana["A"], 0);
  // 相手のターン・スタックが空でないときは、起動できない
  g.mana["A"] = 3;
  g.active = "B";
  g.priority = "A";
  assert.throws(() => activateAbility(g, "A", "Jammer", 0, { t: "bear" }, book), RuleError, "ソーサリーのタイミング");
  g.active = "A";
  g.stack.push({ id: "x", card: card("x"), controller: "B", targets: {}, cast: {} });
  assert.throws(() => activateAbility(g, "A", "Jammer", 0, { t: "bear" }, book), RuleError, "スタックが空でない");
  // 付いているクリーチャーが戦場を離れても、落ちない。装備品はそのまま残る
  g.stack = [];
  g.battlefield = g.battlefield.filter((p) => p.id !== "ox");
  assert.doesNotThrow(() => chars(g, "Jammer", book));
}
// 自分のクリーチャーが居ないとき: 出たときの誘発は、対象が無いので積まれない
{
  const book = rulesOf({ Jammer: jammer });
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("Jammer", "Artifact — Equipment", "A"));
  g.battlefield.push(creature("theirs", "B"));
  castSpell(g, "A", "Jammer", {}, book);
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.equal(g.stack.length, 0, "合法な対象が無いので、誘発型能力は積まれない");
  assert.deepEqual(g.battlefield.map((p) => p.id).sort(), ["Jammer", "theirs"]);
  // 選び方の差し替え口
  const h = createGame(["A", "B"]);
  h.hands["A"].push(card("Jammer", "Artifact — Equipment", "A"));
  h.battlefield.push(creature("c1", "A"), creature("c2", "A"));
  h.decide = { target: (_g, _item, _call, legal) => [legal[legal.length - 1]] };
  castSpell(h, "A", "Jammer", {}, book);
  passPriority(h, "A", book);
  passPriority(h, "B", book);
  assert.deepEqual(h.stack[0].targets, { t: "c2" }, "decide.target で選べる");
}

// ---- Wizard's Staff: 付いているクリーチャーは果敢を持つ (組み込みの誘発)。誘発型能力は追加でもう1回誘発する
{
  const staff: Ability[] = [stat(call("affect", { who: "attached" }), call("staticGrant", { keyword: "prowess" }), call("extraTriggers", { amount: 1 }))];
  const cut: Ability[] = [trig(call("when", { event: "cast", who: "you", turn: "opponents" }), call("self", {}, { as: "s" }), call("addCounter", { target: { ref: "s" }, kind: "+1/+1", count: 1 }))];
  const book = rulesOf({ Staff: staff, Cut: cut, bolt: spell(), Bear: [] as Ability[] });
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("wiz", "A", 1, 1), { id: "Staff", card: card("Staff", "Artifact — Equipment", "A"), controller: "A", attachedTo: "wiz" });
  g.hands["A"].push(card("bolt"), card("Bear", "Creature — Bear", "A", { power: 1, toughness: 1 }));
  assert.ok(chars(g, "wiz", book).keywords.includes("prowess"));
  castSpell(g, "A", "Bear", {}, book);
  assert.equal(g.stack.length, 1, "クリーチャー呪文では果敢は誘発しない");
  drain(g, book);
  castSpell(g, "A", "bolt", {}, book);
  assert.equal(g.stack.length, 3, "呪文 + 果敢の誘発が、追加でもう1回で 2 つ");
  drain(g, book);
  assert.deepEqual([chars(g, "wiz", book).power, chars(g, "wiz", book).toughness], [3, 3], "+1/+1 が 2 回 (ターン終了時まで)");
  g.step = "end";
  g.priority = "A";
  g.passes = [];
  passPriority(g, "A", book);
  passPriority(g, "B", book);
  assert.deepEqual([chars(g, "wiz", book).power, chars(g, "wiz", book).toughness], [1, 1], "ターン終了時に戻る");

  // 付いたクリーチャー自身の誘発型能力も、追加でもう1回 (Brineborn Cutthroat)
  const h = createGame(["A", "B"]);
  h.battlefield.push({ id: "Cut", card: card("Cut", "Creature — Merfolk", "A", { power: 1, toughness: 2 }), controller: "A" }, { id: "Staff", card: card("Staff", "Artifact — Equipment", "A"), controller: "A", attachedTo: "Cut" });
  h.hands["A"].push(card("bolt"));
  h.active = "B";
  h.priority = "A";
  castSpell(h, "A", "bolt", {}, book);
  drain(h, book);
  assert.equal(h.battlefield[0].counters?.["+1/+1"], 2, "カウンターが 2 個");
  // 付いていなければ、何も起きない
  const i = createGame(["A", "B"]);
  i.battlefield.push(creature("wiz", "A", 1, 1), { id: "Staff", card: card("Staff", "Artifact — Equipment", "A"), controller: "A" });
  assert.ok(!chars(i, "wiz", book).keywords.includes("prowess"));
}

// ---- Witness Protection (オーラ): 付いたクリーチャーは、すべての能力を失い、緑と白のクリーチャー・市民で、基本のパワー・タフネスが 1/1 で、名前が変わる。
// パーマネント呪文は、戦場に出てから効果を実行する (出た自分を、付ける対象に使うため)
const witness: Ability[] = [
  { kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("attach", { target: { ref: "t" } })] },
  stat(call("affect", { who: "attached" }), call("loseAbilities", {}), call("setBaseStats", { power: 1, toughness: 1 }), call("setTypes", { types: "Creature — Citizen" }), call("setColors", { colors: "G W" }), call("setName", { name: "Legitimate Businessperson" })),
];
{
  const cut: Ability[] = [trig(call("when", { event: "cast", who: "you" }), call("self", {}, { as: "s" }), call("addCounter", { target: { ref: "s" }, kind: "+1/+1", count: 1 })), stat(call("keyword", { name: "hexproof" }))];
  const book = rulesOf({ Witness: witness, Cut: cut, bolt: spell() });
  const g = createGame(["A", "B"]);
  g.hands["A"].push(card("Witness", "Enchantment — Aura", "A"));
  g.battlefield.push({ id: "Cut", card: card("Cut", "Creature — Merfolk Pirate", "B", { power: 3, toughness: 3, colors: ["U"] }), controller: "B" });
  const before = chars(g, "Cut", book);
  assert.deepEqual([before.power, before.toughness, before.name, before.lostAbilities], [3, 3, "Cut", false]);
  assert.ok(before.keywords.includes("hexproof"), "宣言されたキーワードを持つ");
  // 呪禁: 相手(A)は、Cut を対象にできない
  assert.throws(() => castSpell(g, "A", "Witness", { t: "Cut" }, book), RuleError, "呪禁の相手には付けられない");
  g.battlefield[0].controller = "A"; // 自分のクリーチャーなら付けられる (この検査では、コントローラーを入れ替えて試す)
  g.battlefield[0].card.owner = "A";
  castSpell(g, "A", "Witness", { t: "Cut" }, book);
  assert.equal(g.stack.length, 2, "Witness を唱えたときに、Cut の誘発型能力 (まだ能力を持っている) が積まれる");
  drain(g, book);
  assert.equal(g.battlefield.find((p) => p.id === "Witness")!.attachedTo, "Cut", "オーラは戦場に出て、付いた");
  assert.deepEqual(ids(g.graveyards["A"]), [], "オーラは墓地へ行かない");
  const after = chars(g, "Cut", book);
  assert.equal(after.lostAbilities, true);
  assert.deepEqual(after.keywords, [], "能力(キーワード)を失う");
  assert.deepEqual([after.power, after.toughness], [2, 2], "基本 1/1 + カウンター 1 (Witness を唱えたときの誘発で置かれた)");
  assert.equal(after.typeLine, "Creature — Citizen");
  assert.deepEqual(after.colors, ["G", "W"]);
  assert.equal(after.name, "Legitimate Businessperson");
  // 能力を失ったので、誘発型能力も働かない
  g.hands["A"].push(card("bolt"));
  castSpell(g, "A", "bolt", {}, book);
  assert.equal(g.stack.length, 1, "Cut の誘発型能力は働かない");
  // オーラが離れれば、元に戻る
  g.stack = [];
  g.battlefield = g.battlefield.filter((p) => p.id !== "Witness");
  const back = chars(g, "Cut", book);
  assert.deepEqual([back.power, back.toughness, back.name, back.lostAbilities], [4, 4, "Cut", false]);
}

// ---- Geist of Saint Thalia: クリーチャーでない呪文のコストを {1} 減らす (自分の呪文だけ)。カード自体のマナコストの支払いは、payManaCosts のときだけ
{
  const geist: Ability[] = [stat(call("keyword", { name: "flying" })), stat(call("reduceCost", { amount: 1, who: "you", notType: "creature" }))];
  const book = rulesOf({ Geist: geist, bolt: spell(), ritual: spell(), Bear: [] as Ability[] });
  const make = (withGeist: boolean, pay: boolean) => {
    const g = createGame(["A", "B"]);
    g.payManaCosts = pay;
    if (withGeist) g.battlefield.push({ id: "Geist", card: card("Geist", "Legendary Creature — Spirit Cleric", "A", { power: 2, toughness: 2 }), controller: "A" });
    g.hands["A"].push(card("bolt", "Instant", "A", { mv: 1 }), card("ritual", "Sorcery", "A", { mv: 3 }), card("Bear", "Creature — Bear", "A", { mv: 2, power: 1, toughness: 1 }));
    return g;
  };
  assert.ok(chars(make(true, true), "Geist", book).keywords.includes("flying"));
  assert.doesNotThrow(() => castSpell(make(false, false), "A", "bolt", {}, book), "払わない設定では、マナ 0 でも唱えられる");
  const none = make(false, true);
  assert.throws(() => castSpell(none, "A", "bolt", {}, book), RuleError, "マナ 1 が要る");
  none.mana["A"] = 1;
  castSpell(none, "A", "bolt", {}, book);
  assert.equal(none.mana["A"], 0);
  const withG = make(true, true);
  castSpell(withG, "A", "bolt", {}, book);
  assert.equal(withG.mana["A"], 0, "軽減されて 0");
  withG.mana["A"] = 2;
  drain(withG, book);
  castSpell(withG, "A", "ritual", {}, book);
  assert.equal(withG.mana["A"], 0, "マナ総量 3 が 2 になる");
  drain(withG, book);
  withG.mana["A"] = 1;
  assert.throws(() => castSpell(withG, "A", "Bear", {}, book), RuleError, "クリーチャーは軽減されない (2 要る)");
  // 相手の呪文は軽減されない
  const opp = make(true, true);
  opp.hands["B"].push(card("zap", "Instant", "B", { mv: 1 }));
  opp.priority = "B";
  assert.throws(() => castSpell(opp, "B", "zap", {}, rulesOf({ Geist: geist, zap: spell() })), RuleError, "B の呪文は軽減されない");
}

// ---- 最終レビューの指摘
// 付いていたクリーチャーが戦場を離れたら、装備品の「付いている先」は外れる。同じカードが戻っても、勝手に付き直さない
{
  const bounceMine = spell(call("target", { zone: "battlefield", kind: "permanent", type: "creature", controller: "you" }, { as: "t" }), call("bounce", { target: { ref: "t" } }));
  const book = rulesOf({ Jammer: jammer, bounce: bounceMine, bear: [] as Ability[] });
  const g = createGame(["A", "B"]);
  g.battlefield.push(creature("bear", "A"), { id: "Jammer", card: card("Jammer", "Artifact — Equipment", "A"), controller: "A", attachedTo: "bear" });
  g.hands["A"].push(card("bounce"));
  assert.deepEqual([chars(g, "bear", book).power, chars(g, "bear", book).toughness], [3, 4]);
  castSpell(g, "A", "bounce", { t: "bear" }, book);
  drain(g, book);
  assert.equal(g.battlefield.find((p) => p.id === "Jammer")!.attachedTo, undefined, "付いていた先が離れたので、外れる");
  castSpell(g, "A", "bear", {}, book);
  drain(g, book);
  assert.deepEqual([chars(g, "bear", book).power, chars(g, "bear", book).toughness], [2, 2], "戻ってきた bear に、装備の効果は及ばない");
}

// 果敢は keyword prowess (組み込み)。1 回の呪文で、1 度だけ誘発する。カードデータの keywords ("Prowess") からも
{
  const decl = rulesOf({ Monk: [stat(call("keyword", { name: "prowess" }))], bolt: spell() });
  for (const [label, monk] of [["宣言", card("Monk", "Creature — Monk", "A", { power: 1, toughness: 1 })], ["カードデータ", card("Monk", "Creature — Monk", "A", { power: 1, toughness: 1, keywords: ["Prowess"] })]] as const) {
    const book = label === "宣言" ? decl : rulesOf({ Monk: [] as Ability[], bolt: spell() });
    const g = createGame(["A", "B"]);
    g.battlefield.push({ id: "Monk", card: monk, controller: "A" });
    g.hands["A"].push(card("bolt"));
    castSpell(g, "A", "bolt", {}, book);
    assert.equal(g.stack.length, 2, `${label}: 果敢が 1 度だけ誘発`);
    drain(g, book);
    assert.deepEqual([chars(g, "Monk", book).power, chars(g, "Monk", book).toughness], [2, 2], label);
  }
}

// affect で始まる常在型能力の中の keyword / reduceCost は、読まれない (affect の無い常在型能力に書く) ので、検査で止める
{
  const { problems, blankRule, addAbility, removeAbility, addNode } = await import("../src/battle/editor");
  for (const bad of ["keyword", "reduceCost"]) {
    const r = addNode(addNode(addAbility(removeAbility(blankRule("X"), 0), "static"), 0, "affect"), 0, bad);
    assert.ok(problems(r).some((p) => p.message.includes("affect") && p.message.includes(bad)), bad);
  }
}
