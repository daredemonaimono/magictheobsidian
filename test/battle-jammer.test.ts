import assert from "node:assert";
import { parseRule } from "../src/battle/ruleMd";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { boardModel } from "../src/battle/boardModel";
import { BattleController } from "../src/battle/play";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const real = parseRule(`---
mtg: rule
card: "[[Illvoi Light Jammer]]"
---

## 常在型能力

- keyword name=flash

## 誘発型能力

- when event=enters self=true
- target as=t zone=battlefield kind=permanent type=creature controller=you
- attach target=$t
- grant target=$t keyword=hexproof duration=endOfTurn

## 常在型能力

- affect who=attached
- staticModify power=1 toughness=2

## 起動型能力

- timing sorcery=true
- cost mana=3
- target as=t zone=battlefield kind=permanent type=creature controller=you
- attach target=$t
`);
const rules: RuleBook = { get: (c) => (c === "Jammer" ? real : undefined) };
const mk = (id: string, typeLine: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id.replace(/\d+$/, ""), typeLine, mv: 0, owner: "you", ...extra });
const g = createGame(["you", "opp"]);
g.libraries["you"] = Array.from({ length: 5 }, (_, i) => mk(`L${i}`, "Land"));
g.libraries["opp"] = g.libraries["you"].map((c) => ({ ...c, id: "o" + c.id, owner: "opp" }));
const bear = (id: string): Perm => ({ id, card: mk(id, "Creature — Bear", { power: 2, toughness: 2 }), controller: "you" });
g.battlefield.push(bear("Bear1"), bear("Bear2"));
g.hands["you"] = [mk("Jammer1", "Artifact — Equipment", { manaCost: "{1}{U}", mv: 2 })];
g.step = "main1";
const c = new BattleController(g, rules, "you", () => 0.5);
assert.equal(c.use("Jammer1"), undefined);
c.next();
assert.equal(c.pending?.request.kind, "target", "装備先を聞く (Illvoi Light Jammer の、戦場に出たときの誘発)");
c.answer(["Bear2"]);
assert.equal(g.stack.length, 1, "誘発が積まれる");
c.next();
assert.equal(g.battlefield.find((p) => p.id === "Jammer1")?.attachedTo, "Bear2");
const view = boardModel(g, rules, "you", () => undefined).self.creatures;
const b2 = view.find((x) => x.id === "Bear2")!;
assert.deepEqual([b2.power, b2.toughness, b2.powerMod, b2.toughnessMod], [3, 4, "up", "up"], "+1/+2 を受けた数字は、up (黄色)");
g.battlefield.find((p) => p.id === "Bear1")!.counters = { "+1/+1": -1 };
const down = boardModel(g, rules, "you", () => undefined).self.creatures.find((x) => x.id === "Bear1")!;
assert.deepEqual([down.power, down.toughness, down.powerMod, down.toughnessMod], [1, 1, "down", "down"], "下がった数字は、down (赤)");
delete g.battlefield.find((p) => p.id === "Bear1")!.counters;
const b1 = view.find((x) => x.id === "Bear1")!;
assert.deepEqual([b1.power, b1.toughness, b1.powerMod, b1.toughnessMod], [2, 2, undefined, undefined]);
// スタックの能力の説明: 忠誠度能力は +N / −N、呪文には付かない
{
  const mkItem = (id: string, args: Record<string, unknown>, ability = true) => ({ id, card: mk("Jace", "Legendary Planeswalker — Jace"), controller: "you", targets: {}, cast: {}, ability, ...(args.loyalty !== undefined ? { loyalty: args.loyalty } : {}), ...(args.loyaltyX ? { loyaltyX: true } : {}), body: [{ node: "createToken", args: {} }] }) as unknown as Game["stack"][number];
  g.stack = [mkItem("s1", { loyalty: 1 }), mkItem("s2", { loyalty: -2 }), mkItem("s3", {}), mkItem("s4", {}, false)];
  const st = boardModel(g, rules, "you", () => "u://j").stack;
  assert.ok(st[0].label?.startsWith("+1: "));
  assert.ok(st[1].label?.startsWith("−2: "));
  assert.ok(st[2].label?.startsWith("起動: "));
  assert.equal(st[3].label, undefined, "能力でなければ、説明は付かない");
  assert.equal(st[0].image, "u://j");
}
console.log("jammer ok");
