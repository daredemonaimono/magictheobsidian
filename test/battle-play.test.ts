import assert from "node:assert";
import { buildMatch, CardData, DeckData } from "../src/battle/deckToGame";
import { BattleController } from "../src/battle/play";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, RuleBook } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const rules = rulesOf({
  Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }],
  Bear: [],
  Zap: [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent", type: "creature" }, { as: "t" }), call("damage", { target: "$t", amount: 2 })] }],
});
const data = (name: string, extra: Partial<CardData> = {}) => ({ key: name, data: { name, typeLine: "Creature — Bear", cmc: 2, manaCost: "{1}{U}", colors: ["U"], power: "2", toughness: "2", ...extra } as CardData });
const deck = (): DeckData => ({
  format: "standard",
  main: [
    { ...data("Island", { typeLine: "Basic Land — Island", cmc: 0, manaCost: "", power: undefined, toughness: undefined }), n: 30 },
    { ...data("Bear"), n: 26 },
    { ...data("Zap", { typeLine: "Instant", power: undefined, toughness: undefined }), n: 4 },
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
  assert.equal(c.activate(land.id, 0), undefined);
  assert.equal(g.mana["you"], 1);
  assert.ok(g.log.includes("あなたが Island をタップしてマナを出した"));
  assert.ok(c.abilities(land.id)[0].label.startsWith("1: ") && !c.abilities(land.id)[0].usable, "タップ済みの能力は、使えない表示");
  // 2マナ目 (ほかの土地は無いので、マナを足して) で唱える
  g.mana["you"] = 2;
  g.pool["you"] = { U: 2 };
  assert.equal(c.use(bear.id), undefined);
  assert.equal(g.stack.length, 1);
  c.next();
  assert.equal(g.stack.length, 0);
  assert.ok(g.battlefield.some((p) => p.id === bear.id), "「次へ」で解決して、戦場に出る");
  assert.equal(g.step, "main1", "解決で止まる");
}
// 対象が必要なカード: 状態は変わらず、理由が返る
{
  const { g, c } = setup();
  const zap = hold(g, "Zap");
  toMain(c);
  g.mana["you"] = 5;
  const before = JSON.stringify(g);
  const msg = c.use(zap.id);
  assert.ok(msg?.includes("対象を選ぶカードは、まだ使えません"));
  const after = JSON.parse(JSON.stringify(g));
  assert.equal(after.log.length, JSON.parse(before).log.length + 1);
  assert.deepEqual(after.hands, JSON.parse(before).hands);
}
// 「次へ」を繰り返す: 自分のターンを進み、相手のターンを飛ばして、ターン 3 のアップキープで止まる。マナ・プールは空になる
{
  const { g, c } = setup();
  g.mana["you"] = 3;
  g.pool["you"] = { U: 3 };
  const steps: string[] = [];
  let n = 0;
  while (g.turn < 3 && n++ < 30) {
    c.next();
    steps.push(`${g.turn}:${g.step}`);
  }
  assert.ok(n <= 30);
  assert.deepEqual([g.turn, g.step, g.active], [3, "upkeep", "you"]);
  assert.equal(g.mana["you"], 0);
  assert.deepEqual(g.pool["you"], {});
  assert.equal(g.hands["you"].length, 7, "アップキープでは、まだ引かない");
  c.next();
  assert.deepEqual([g.step, g.hands["you"].length], ["draw", 8], "ターン 3 のドロー・ステップで1枚");
  assert.ok(steps.includes("1:main1") && steps.includes("1:end"));
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
// 手札が 9 枚で終了ステップを抜けると 7 枚になり、ログに出る
{
  const { g, c } = setup();
  toMain(c);
  g.hands["you"].push(g.libraries["you"].shift()!, g.libraries["you"].shift()!);
  g.step = "end";
  g.priority = "you";
  c.next();
  assert.equal(g.hands["you"].length, 7);
  assert.ok(g.log.some((l) => l.includes("2 枚捨てた")));
}
void ({} as GameCard);
console.log("play ok");
