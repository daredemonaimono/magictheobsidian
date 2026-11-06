import assert from "node:assert";
import { castSpell, declareAttackers, declareBlockers, passPriority } from "../src/battle/engine";
import { flushEvents } from "../src/battle/engine/triggers";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// DR-3: 戦闘ダメージの誘発 (damaged)・遅延誘発 (delay)・今ターンに得たライフ (lifeGained)・絞り込み (color / except)・指定したカードを捨てる (discard cards=)

const card = (id: string, typeLine = "Creature", owner = "A", extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const trig = (when: NodeCall["args"], ...body: NodeCall[]): Ability => ({ kind: "triggered", body: [call("when", when), ...body] });
const spell = (...body: NodeCall[]): Ability => ({ kind: "spell", body });
const perm = (id: string, owner: string, power: number, toughness: number, typeLine = "Creature — Bear"): Perm => ({ id, card: card(id, typeLine, owner, { power, toughness }), controller: owner, enteredTurn: 0 });
const drain = (g: Game, book: RuleBook) => {
  for (let i = 0; g.stack.length && i < 40; i++) passPriority(g, g.priority!, book);
};
const next = (g: Game, book: RuleBook) => {
  for (let i = 0; i < g.players.length; i++) passPriority(g, g.priority!, book);
};
const setup = () => {
  const g = createGame(["A", "B"]);
  g.active = "A";
  g.step = "main1";
  g.priority = "A";
  return g;
};
// 指定のステップまで進める (途中で積まれたものは、解決する)
const toStep = (g: Game, book: RuleBook, step: string) => {
  for (let i = 0; g.step !== step && i < 40; i++) {
    if (g.stack.length) drain(g, book);
    else next(g, book);
  }
  drain(g, book);
};
const ids = (cs: GameCard[]) => cs.map((c) => c.id);
const has = (g: Game, id: string) => g.battlefield.some((p) => p.id === id);

// ---- Stinkweed Imp: クリーチャーに戦闘ダメージを与えたら、それを破壊する
const IMP: Ability[] = [trig({ event: "damaged", self: true, combat: true, hit: "creature" }, call("eventPerm", {}, { as: "v" }), call("destroy", { target: { ref: "v" } }))];
{
  const book = rulesOf({ Imp: IMP });
  const g = setup();
  g.battlefield.push(perm("Imp", "A", 1, 1), perm("Wall", "B", 0, 9));
  next(g, book);
  declareAttackers(g, "A", [{ id: "Imp" }], book);
  next(g, book);
  declareBlockers(g, "B", [{ blocker: "Wall", attacker: "Imp" }], book);
  toStep(g, book, "main2");
  assert.ok(!has(g, "Wall"), "ブロッカーは、1 点のダメージでは死なないが、Imp の誘発で破壊される");
  assert.ok(has(g, "Imp"));
}
// プレイヤーに当たったときは、誘発しない (hit=creature)。呪文のダメージも、combat=true では誘発しない
{
  const book = rulesOf({ Imp: IMP, Wall: [], Bolt: [spell(call("target", { zone: "any", kind: "any" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 1 }))] });
  const g = setup();
  g.battlefield.push(perm("Imp", "A", 1, 1), perm("Wall", "B", 0, 9));
  next(g, book);
  declareAttackers(g, "A", [{ id: "Imp" }], book);
  toStep(g, book, "main2");
  assert.ok(has(g, "Wall") && g.life["B"] === 19, "ブロックされなければ、プレイヤーに当たる。Wall は無事");
}

// ---- Prized Amalgam: 墓地からクリーチャーが出たら、次の終了ステップに、戦場に戻る (遅延誘発)
const AMALGAM: Ability[] = [trig({ event: "enters", from: "graveyard", who: "you", type: "creature", zone: "graveyard" }, call("delay", { step: "end" }), call("self", {}, { as: "s" }), call("move", { cards: { ref: "s" }, to: "battlefield", tapped: true }))];
const RAISE: Ability[] = [spell(call("target", { zone: "graveyard", kind: "card", type: "creature" }, { as: "t" }), call("move", { cards: { ref: "t" }, to: "battlefield" }))];
{
  const book = rulesOf({ Amalgam: AMALGAM, Raise: RAISE });
  const g = setup();
  g.graveyards["A"].push(card("Amalgam"), card("Bear"));
  g.hands["A"].push(card("Raise", "Sorcery"));
  castSpell(g, "A", "Raise", { t: "Bear" }, book);
  drain(g, book);
  assert.ok(has(g, "Bear") && !has(g, "Amalgam"), "すぐには戻らない");
  assert.equal(g.delayed?.length, 1, "遅延誘発が、予約された");
  toStep(g, book, "end");
  assert.ok(has(g, "Amalgam"), "終了ステップの開始時に戻る");
  assert.equal(g.battlefield.find((p) => p.id === "Amalgam")?.tapped, true, "タップ状態で");
  assert.equal(g.delayed?.length ?? 0, 0, "1回だけ");
}

// ---- Silversmote Ghoul: 自分の終了ステップに、今ターンに 3 点以上ライフを得ていたら、墓地から、タップ状態で戻る
const GHOUL: Ability[] = [trig({ event: "step", step: "end", who: "you", zone: "graveyard" }, call("lifeGained", { player: "you" }, { as: "n" }), call("compare", { a: { ref: "n" }, b: 3, op: "ge" }, { as: "ok" }), call("self", {}, { as: "s" }), call("move", { cards: { ref: "s" }, to: "battlefield", tapped: true }, { if: "$ok" }))];
for (const [gain, back] of [[3, true], [2, false]] as const) {
  const book = rulesOf({ Ghoul: GHOUL, Gain: [spell(call("gainLife", { player: "you", amount: gain }))] });
  const g = setup();
  g.graveyards["A"].push(card("Ghoul"));
  g.hands["A"].push(card("Gain", "Instant"));
  castSpell(g, "A", "Gain", {}, book);
  drain(g, book);
  toStep(g, book, "end");
  assert.equal(has(g, "Ghoul"), back, `ライフを ${gain} 点得たとき`);
}
{
  // 得た量は、ターンが替わると 0 に戻る
  const book = rulesOf({ Gain: [spell(call("gainLife", { player: "you", amount: 5 }))], Probe: [spell(call("lifeGained", { player: "you" }, { as: "n" }), call("gainLife", { player: "you", amount: 0 }))] });
  const g = setup();
  g.hands["A"].push(card("Gain", "Instant"));
  castSpell(g, "A", "Gain", {}, book);
  drain(g, book);
  assert.equal(g.gained?.["A"], 5);
  toStep(g, book, "end");
  next(g, book);
  assert.equal(g.gained?.["A"] ?? 0, 0, "次のターンには、0");
}

// ---- Ichorid: 自分のアップキープに、墓地の黒いクリーチャーを (自分以外) 1枚追放したら、戻る。終了ステップに生け贄
const ICHORID: Ability[] = [
  trig({ event: "step", step: "upkeep", who: "you", zone: "graveyard" }, call("self", {}, { as: "s" }), call("zoneCards", { zone: "graveyard", player: "you" }, { as: "gy" }), call("filter", { from: { ref: "gy" }, type: "creature", color: "B", except: { ref: "s" } }, { as: "f" }), call("choose", { from: { ref: "f" }, count: 1 }, { as: "c" }), call("exile", { target: { ref: "c" }, optional: true }, { as: "n" }), call("move", { cards: { ref: "s" }, to: "battlefield" }, { if: "$n" })),
  trig({ event: "step", step: "end", self: true }, call("self", {}, { as: "s" }), call("sacrifice", { target: { ref: "s" } })),
];
{
  const book = rulesOf({ Ichorid: ICHORID });
  const g = setup();
  g.step = "end";
  g.graveyards["A"].push(card("Ichorid", "Creature — Horror", "A", { colors: ["B"] }), card("Imp", "Creature — Imp", "A", { colors: ["B"] }), card("Elf", "Creature — Elf", "A", { colors: ["G"] }));
  g.active = "B";
  toStep(g, book, "upkeep"); // B のターンの終わりを越えて、A のアップキープへ
  drain(g, book);
  assert.ok(has(g, "Ichorid"), "黒いクリーチャー (Imp) を追放して、戻る");
  assert.ok(g.exile["A"].some((c) => c.id === "Imp") && !g.exile["A"].some((c) => c.id === "Elf" || c.id === "Ichorid"), "追放されたのは Imp だけ (緑の Elf・自分自身ではない)");
  toStep(g, book, "end");
  assert.ok(!has(g, "Ichorid") && g.graveyards["A"].some((c) => c.id === "Ichorid"), "終了ステップに、生け贄に捧げられて、墓地へ");
}
{
  // 追放できる黒いクリーチャーが無ければ、戻らない
  const book = rulesOf({ Ichorid: ICHORID });
  const g = setup();
  g.step = "end";
  g.active = "B";
  g.graveyards["A"].push(card("Ichorid", "Creature — Horror", "A", { colors: ["B"] }), card("Elf", "Creature — Elf", "A", { colors: ["G"] }));
  toStep(g, book, "upkeep");
  drain(g, book);
  assert.ok(!has(g, "Ichorid"), "追放するものが無ければ、戻らない");
}

// ---- Grief: 戦場に出たとき、相手の手札を見て、土地でないカードを 1 枚選んで、捨てさせる (discard cards=)
const GRIEF: Ability[] = [trig({ event: "enters", self: true }, call("lookHand", { player: "opponents" }, { as: "h" }), call("filter", { from: { ref: "h" }, notType: "land" }, { as: "f" }), call("choose", { from: { ref: "f" }, count: 1 }, { as: "c" }), call("discard", { player: "opponents", cards: { ref: "c" } }))];
{
  const book = rulesOf({ Grief: GRIEF, Summon: [spell(call("lookHand", { player: "you" }))] });
  const g = setup();
  g.hands["B"].push(card("Forest", "Basic Land — Forest", "B"), card("Bolt", "Instant", "B"), card("Counterspell", "Instant", "B"));
  g.battlefield.push(perm("Grief", "A", 3, 2));
  g.events.push({ type: "enters", perm: g.battlefield[0] });
  g.decide = { choose: (_g, _p, from) => from.filter((c) => c.id === "Counterspell") };
  flushEvents(g, book); // 誘発を積む
  drain(g, book);
  assert.deepEqual(ids(g.hands["B"]), ["Forest", "Bolt"], "選んだ Counterspell だけが捨てられる (土地は選べない)");
  assert.deepEqual(ids(g.graveyards["B"]), ["Counterspell"]);
}
console.log("battle-dr3 ok");
