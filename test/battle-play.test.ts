import assert from "node:assert";
import { buildMatch, CardData, DeckData } from "../src/battle/deckToGame";
import { BattleController } from "../src/battle/play";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";
import { InputRequest, NeedInput, makeDecider } from "../src/battle/input";

resetRegistry();
registerBuiltinNodes();
const card = (id: string): GameCard => ({ id, name: id, typeLine: "Instant", mv: 0, owner: "you" });

const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const rules = rulesOf({
  Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }],
  Bear: [],
  Mox: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }],
  Think: [{ kind: "spell", body: [{ node: "look", args: { player: "you", count: 3 }, as: "l" }, { node: "choose", args: { from: { ref: "l" }, count: 1 }, as: "c" }, call("move", { cards: { ref: "c" }, to: "hand" })] }],
  Zap: [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 2 })] }],
});
const data = (name: string, extra: Partial<CardData> = {}) => ({ key: name, data: { name, typeLine: "Creature — Bear", cmc: 2, manaCost: "{1}{U}", colors: ["U"], power: "2", toughness: "2", ...extra } as CardData });
const deck = (): DeckData => ({
  format: "standard",
  main: [
    { ...data("Island", { typeLine: "Basic Land — Island", cmc: 0, manaCost: "", power: undefined, toughness: undefined }), n: 30 },
    { ...data("Bear"), n: 22 },
    { ...data("Think", { typeLine: "Instant", power: undefined, toughness: undefined, manaCost: "{U}" }), n: 4 },
    { ...data("Zap", { typeLine: "Instant", power: undefined, toughness: undefined, manaCost: "{U}" }), n: 4 },
  ],
});
const setup = (): { g: Game; c: BattleController } => {
  const g = buildMatch(deck(), deck(), rules, () => 0.5);
  return { g, c: new BattleController(g, rules) };
};
// 手札に指定のカードが来るように並べ替える (1枚、手札の先頭に)
const hold = (g: Game, name: string, owner = "you") => {
  const i = g.libraries[owner].findIndex((x) => x.name === name);
  const j = g.hands[owner].findIndex((x) => x.name === name);
  if (j >= 0) return g.hands[owner][j];
  const [card] = g.libraries[owner].splice(i, 1);
  g.hands[owner].push(card);
  return card;
};
const toMain = (c: BattleController) => {
  for (let i = 0; i < 4 && c.game.step !== "main1"; i++) c.next();
  assert.equal(c.game.step, "main1");
};

// 土地を出す → マナ → クリーチャーを唱える → 「次へ」で解決
{
  const { g, c } = setup();
  const land = hold(g, "Island");
  const land2 = hold(g, "Island");
  void land2;
  const bear = hold(g, "Bear");
  toMain(c);
  assert.equal(c.use(land.id), undefined);
  assert.ok(g.battlefield.some((p) => p.id === land.id));
  assert.ok(g.log.includes("あなたが Island を出した"));
  const second = g.hands["you"].find((x) => x.name === "Island")!;
  assert.ok(c.use(second.id), "2枚目の土地は出せない: 理由が返る");
  assert.ok(!g.battlefield.some((p) => p.id === second.id), "状態は変わらない");
  assert.ok(c.use(bear.id), "マナが無いと唱えられない (理由が返る)");
  // 土地 1 枚では、MV2 の Bear は唱えられない: マナを出しても使い道が無いので、タップできない (進めるとマナが消えるだけ。前提を変えた: 以前は、いつでもタップできた)
  assert.ok(c.activate(land.id, 0), "使い道の無いマナは、出せない: 理由が返る");
  assert.equal(g.mana["you"], 0);
  assert.deepEqual(c.abilities(land.id), [], "マナを出すだけの能力は、手で使う一覧に出ない (前提を変えた: マナは、カードを使うとき、自動で払う)");
  const l2 = g.hands["you"].find((x) => x.name === "Island")!;
  g.hands["you"] = g.hands["you"].filter((x) => x !== l2);
  g.battlefield.push({ id: l2.id, card: l2, controller: "you" }); // 2枚目の土地 (これで、Bear が唱えられる)
  assert.equal(c.activate(land.id, 0), undefined);
  assert.equal(g.mana["you"], 1);
  assert.ok(g.log.includes("あなたが Island をタップしてマナを出した"));
  assert.equal(c.activate(l2.id, 0), undefined); // 2マナ目
  assert.equal(g.mana["you"], 2);
  assert.equal(c.use(bear.id), undefined);
  assert.equal(g.stack.length, 1);
  c.next();
  assert.equal(g.stack.length, 0);
  assert.ok(g.battlefield.some((p) => p.id === bear.id), "「次へ」で解決して、戦場に出る");
  assert.equal(g.step, "main1", "解決で止まる");
}
// 対象を取るカード: 対象にできるものが無ければ使えない。あれば、対象を選んで唱えて、解決でダメージ
{
  const { g, c } = setup();
  const zap = hold(g, "Zap");
  toMain(c);
  g.mana["you"] = 2;
  g.pool["you"] = { U: 2 };
  const before = JSON.parse(JSON.stringify(g));
  assert.ok(c.use(zap.id)?.includes("対象にできるものがありません"));
  assert.deepEqual(JSON.parse(JSON.stringify(g)).hands, before.hands);
  const bear = hold(g, "Bear", "opp");
  g.battlefield.push({ id: bear.id, card: { ...bear, power: 2, toughness: 3 }, controller: "opp" });
  const slots = c.needsForCard(zap.id);
  assert.deepEqual(slots.map((x) => [x.as, x.legal]), [["t", [bear.id]]]);
  assert.ok(c.use(zap.id, { t: "nope" }), "不正な対象は、使えない");
  assert.ok(g.hands["you"].some((x) => x.id === zap.id));
  assert.equal(c.use(zap.id), undefined, "対象を渡さなくても、試し撃ちと同じ仮の対象で、例外にならない");
  g.stack.length = 0;
  g.hands["you"].push(zap);
  g.graveyards["you"] = g.graveyards["you"].filter((x) => x.id !== zap.id);
  g.mana["you"] = 2;
  g.pool["you"] = { U: 2 };
  assert.equal(c.use(zap.id, { t: bear.id }), undefined);
  assert.equal(g.stack.length, 1);
  c.next();
  assert.equal(g.battlefield.find((p) => p.id === bear.id)!.damage, 2);
  assert.ok(g.graveyards["you"].some((x) => x.id === zap.id));
}
// 「次へ」は、次のステップへ進む (次の「できること」までではない)。戦闘は、その中の段階 (戦闘開始 → 攻撃クリーチャー指定 → 戦闘終了) ごと。相手のターンも、ステップごと
{
  const { g, c } = setup();
  g.mana["you"] = 3;
  g.pool["you"] = { U: 3 };
  const steps: string[] = [];
  let n = 0;
  while (g.turn < 3 && n++ < 40) {
    c.next();
    steps.push(`${g.turn}:${g.step}${g.step === "combat" ? `/${g.combatPhase}` : ""}`);
    if (g.active === "opp") assert.equal(g.priority, "you", "相手のステップで止まるとき、自分に優先権がある");
  }
  assert.deepEqual(steps, ["1:draw", "1:main1", "1:main2", "1:end", "2:upkeep", "2:draw", "2:main1", "2:main2", "2:end", "3:upkeep"], "攻撃できるクリーチャーがいなければ、戦闘ステップは飛ばす");
  assert.equal(g.mana["you"], 0, "マナ・プールは、ステップで空になる");
  assert.ok(g.log.includes("ターン 2: 相手のターン") && g.log.includes("相手がカードを引いた") && g.log.includes("ターン 3: あなたのターン"), "ターンの区切りと、相手のドローが、ログに出る");
  c.next();
  c.next();
  assert.equal(g.hands["you"].length, 8, "ターン 3 のドローで1枚");
}
// 攻撃できるクリーチャーがいれば、戦闘ステップは、段階ごとに止まる。召喚酔い・タップ済みは、いないのと同じ
{
  const { g, c } = setup();
  g.battlefield.push({ id: "b1", card: { id: "b1", name: "Bear", typeLine: "Creature — Bear", mv: 2, owner: "you", power: 2, toughness: 2 }, controller: "you" });
  const steps: string[] = [];
  for (let i = 0; i < 8 && g.turn === 1; i++) {
    c.next();
    steps.push(`${g.step}${g.step === "combat" ? `/${g.combatPhase}` : ""}`);
  }
  assert.deepEqual(steps.slice(0, 6), ["draw", "main1", "combat/beginning", "combat/attackers", "combat/end", "main2"]);
}
{
  const { g, c } = setup();
  g.battlefield.push({ id: "b1", card: { id: "b1", name: "Bear", typeLine: "Creature — Bear", mv: 2, owner: "you", power: 2, toughness: 2 }, controller: "you", enteredTurn: 1 });
  c.next();
  c.next();
  c.next();
  assert.equal(g.step, "main2", "召喚酔いのクリーチャーだけなら、戦闘は飛ばす");
}
// {1}{U} は、青 1 つでは唱えられない (青 2 つなら、唱えられる)
{
  const { g, c } = setup();
  const bear = hold(g, "Bear");
  toMain(c);
  g.mana["you"] = 1;
  g.pool["you"] = { U: 1 };
  assert.ok(c.use(bear.id)?.includes("マナが足りません"), "マナ 1 では、MV2 は唱えられない (出せるマナが、ほかに無い)");
  g.mana["you"] = 2;
  g.pool["you"] = { U: 2 };
  assert.equal(c.use(bear.id), undefined);
  assert.equal(g.mana["you"], 0);
}
// 相手のターンのステップでも、自分は応答できる (土地 + インスタント)
{
  const { g, c } = setup();
  const isl = hold(g, "Island");
  g.hands["you"] = g.hands["you"].filter((x) => x !== isl);
  g.battlefield.push({ id: isl.id, card: isl, controller: "you" });
  const zap = hold(g, "Zap");
  const foe = hold(g, "Bear", "opp");
  g.battlefield.push({ id: foe.id, card: { ...foe, power: 2, toughness: 2 }, controller: "opp" });
  toMain(c);
  g.step = "end";
  g.priority = "you";
  c.next(); // 終了 → 相手のターンのアップキープ
  assert.deepEqual([g.turn, g.active, g.step, g.priority], [2, "opp", "upkeep", "you"]);
  assert.equal(c.activate(isl.id, 0), undefined);
  assert.equal(c.use(zap.id, { t: foe.id }), undefined);
  assert.equal(g.stack.length, 1);
}
// マリガン (ロンドン): 終えるまで、使えない・次へも押せない。マリガンで 7 枚引き直し、キープで引き直した回数だけ底に置く
{
  const { g } = setup();
  const seq = (() => { let x = 7; return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296); })();
  const c = new BattleController(g, rules, "you", seq);
  g.mulligan = { count: 0 };
  const total = g.hands["you"].length + g.libraries["you"].length;
  const first = g.hands["you"].map((x) => x.id).join();
  assert.ok(c.use(g.hands["you"][0].id)?.includes("マリガン"));
  assert.ok(c.next()?.includes("マリガン"));
  assert.deepEqual(c.actions(), []);
  assert.equal(c.mulligan(), undefined);
  assert.equal(g.mulligan?.count, 1);
  assert.equal(g.hands["you"].length, 7);
  assert.equal(g.hands["you"].length + g.libraries["you"].length, total, "枚数は変わらない");
  assert.notEqual(g.hands["you"].map((x) => x.id).join(), first, "引き直す");
  assert.equal(c.keep(), "bottom");
  assert.ok(c.bottom([]), "枚数が違う");
  assert.ok(c.bottom(["nope"]), "手札に無い");
  assert.equal(g.mulligan?.count, 1, "失敗では、終わらない");
  const put = g.hands["you"][2].id;
  assert.equal(c.bottom([put]), undefined);
  assert.equal(g.mulligan, undefined);
  assert.equal(g.hands["you"].length, 6);
  assert.equal(g.libraries["you"][g.libraries["you"].length - 1].id, put, "底に置いた");
  assert.equal(g.hands["you"].length + g.libraries["you"].length, total);
  assert.equal(c.next(), undefined, "終えたら、進める");
}
{
  const { g } = setup();
  const c = new BattleController(g, rules);
  g.mulligan = { count: 0 };
  assert.equal(c.keep(), "done");
  assert.equal(g.mulligan, undefined);
  assert.equal(g.hands["you"].length, 7);
  g.mulligan = { count: 7 };
  assert.ok(c.mulligan(), "7 回より先は、できない");
}
// 相手のライブラリーが空: ゲームが終わって、止まる。続けて呼んでも例外にならない
{
  const { g, c } = setup();
  g.libraries["opp"] = [];
  for (let i = 0; i < 30; i++) c.next();
  assert.ok(g.over);
  c.next();
  assert.deepEqual(g.over?.winner, "you");
}
// 手札が 9 枚で終了ステップを抜けるとき: 捨てるカードを聞く (答えるまで、局面は変わらない)。答えたら 7 枚になる。取り消せる
{
  const { g, c } = setup();
  toMain(c);
  g.hands["you"].push(g.libraries["you"].shift()!, g.libraries["you"].shift()!);
  g.step = "end";
  g.priority = "you";
  assert.equal(c.next(), undefined);
  assert.equal(c.pending?.request.kind, "discard");
  assert.equal(g.hands["you"].length, 9, "答えるまで、変わらない");
  assert.equal(g.step, "end");
  c.cancel();
  assert.equal(c.pending, undefined);
  assert.equal(g.hands["you"].length, 9);
  c.next();
  const req = c.pending!.request;
  assert.ok(req.kind === "discard" && req.n === 2 && req.cards.length === 9 && req.cleanup === true, "クリンナップの上限による (残すカードを選ぶ形にする印)");
  const drop = (req as { cards: { id: string }[] }).cards.slice(0, 2).map((x) => x.id);
  assert.equal(c.answer(drop), undefined);
  assert.equal(c.pending, undefined);
  assert.equal(g.hands["you"].length, 7, "7 枚になる");
  assert.ok(drop.every((id) => g.graveyards["you"].some((x) => x.id === id)), "選んだカードが捨てられる");
  assert.equal(g.turn, 2, "続けて、相手のターンの始まりまで進む");
}
// 選ぶ (look + choose): 解決のときに聞く。答えると、そのカードが手札に
{
  const { g, c } = setup();
  const think = hold(g, "Think");
  toMain(c);
  g.mana["you"] = 1;
  g.pool["you"] = { U: 1 };
  assert.equal(c.use(think.id), undefined);
  assert.equal(c.pending, undefined);
  assert.equal(g.stack.length, 1);
  const top3 = g.libraries["you"].slice(0, 3).map((x) => x.id);
  c.next();
  const req = c.pending!.request;
  assert.ok(req.kind === "choose" && req.min === 1 && req.max === 1 && req.cards.map((x) => x.id).join() === top3.join());
  assert.equal(g.stack.length, 1, "答えるまで、解決しない");
  const handBefore = g.hands["you"].length;
  assert.equal(c.answer([top3[2]]), undefined);
  assert.equal(c.pending, undefined);
  assert.equal(g.stack.length, 0);
  assert.equal(g.hands["you"].length, handBefore + 1);
  assert.ok(g.hands["you"].some((x) => x.id === top3[2]), "選んだカードが手札に");
}
// 質問の種類ごとの判断 (自分への質問は、答えが無ければ入力待ち。相手・自動で決まる場面は聞かない)
{
  const g = createGame(["you", "opp"]);
  g.hands["you"] = [card("a"), card("b"), card("c")];
  g.hands["opp"] = [card("x"), card("y")];
  const d = makeDecider("you", []);
  const ask = (f: () => unknown): InputRequest | undefined => {
    try {
      f();
    } catch (e) {
      if (e instanceof NeedInput) return e.request;
      throw e;
    }
    return undefined;
  };
  assert.deepEqual(ask(() => d.pay!(g, "you", 2)), { kind: "pay", n: 2 });
  assert.deepEqual(ask(() => d.may!(g, "you", "exile")), { kind: "may", what: "exile" });
  assert.equal(d.pay!(g, "opp", 2), undefined, "相手は聞かない");
  assert.equal(d.discard!(g, "opp", 1), undefined);
  assert.equal(d.discard!(g, "you", 3), undefined, "全部捨てるなら聞かない");
  assert.equal(ask(() => d.discard!(g, "you", 1))?.kind, "discard");
  assert.equal(d.choose!(g, "you", g.hands["you"], 3, false), undefined, "全部選ぶなら聞かない");
  assert.deepEqual(ask(() => d.choose!(g, "you", g.hands["you"], 2, true)), { kind: "choose", min: 0, max: 2, cards: g.hands["you"].map((x) => ({ id: x.id, name: x.name })) });
  const item = { id: "i", card: card("Spell"), controller: "you", targets: {}, cast: {} };
  assert.equal(d.target!(g, item, { node: "target", args: { zone: "any", kind: "any" } }, ["only"]), undefined, "候補が必要な数しかなければ、聞かない");
  assert.equal(ask(() => d.target!(g, item, { node: "target", args: { zone: "any", kind: "any" } }, ["p", "q"]))?.kind, "target");
  const ans = makeDecider("you", [true, false, ["b"]]);
  assert.equal(ans.may!(g, "you", "x"), true);
  assert.equal(ans.pay!(g, "you", 1), false);
  assert.deepEqual(ans.discard!(g, "you", 1)!.map((x) => x.id), ["b"]);
}
console.log("play ok");
