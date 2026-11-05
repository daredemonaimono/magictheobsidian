import assert from "node:assert";
import { buildMatch, CardData, DeckData } from "../src/battle/deckToGame";
import { BattleController } from "../src/battle/play";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { RuleBook } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const call = (node: string, args: NodeCall["args"], extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
// 積み重ねられた叡智と同じ形: 3 枚見て、1 枚を手札に、残りを好きな順番で底に
const rules = rulesOf({
  Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }],
  Sift: [{ kind: "spell", body: [{ node: "look", args: { player: "you", count: 3 }, as: "l" }, { node: "choose", args: { from: { ref: "l" }, count: 1 }, as: "c" }, call("move", { cards: { ref: "c" }, to: "hand" }), call("move", { cards: { ref: "l" }, except: { ref: "c" }, to: "bottom" })] }],
});
const data = (name: string, extra: Partial<CardData> = {}) => ({ key: name, data: { name, typeLine: "Creature — Bear", cmc: 2, manaCost: "{1}{U}", colors: ["U"], power: "2", toughness: "2", ...extra } as CardData });
const deck = (): DeckData => ({
  format: "standard",
  main: [
    { ...data("Island", { typeLine: "Basic Land — Island", cmc: 0, manaCost: "", power: undefined, toughness: undefined }), n: 30 },
    { ...data("Bear"), n: 26 },
    { ...data("Sift", { typeLine: "Instant", power: undefined, toughness: undefined, manaCost: "{U}" }), n: 4 },
  ],
});
const g = buildMatch(deck(), deck(), rules, () => 0.5);
const c = new BattleController(g, rules);
for (let i = 0; i < 4 && g.step !== "main1"; i++) c.next();
// 手札に Sift
const i = g.libraries["you"].findIndex((x) => x.name === "Sift");
let sift = g.hands["you"].find((x) => x.name === "Sift");
if (!sift) [sift] = g.libraries["you"].splice(i, 1), g.hands["you"].push(sift);
g.mana["you"] = 1;
g.pool["you"] = { U: 1 };
const [t1, t2, t3] = g.libraries["you"].slice(0, 3).map((x) => x.id);
const lib = g.libraries["you"].length;
assert.equal(c.use(sift.id), undefined);
c.next();
assert.equal(c.pending!.request.kind, "choose");
c.answer([t1]); // t1 を手札へ。残りは t2, t3
const req = c.pending!.request;
assert.ok(req.kind === "order" && req.to === "bottom" && req.cards.map((x) => x.id).join() === [t2, t3].join(), "残り 2 枚の順番を聞く");
assert.equal(c.answer([t3, t2]), undefined);
assert.equal(c.pending, undefined);
const L = g.libraries["you"];
assert.equal(L.length, lib - 1);
assert.deepEqual(L.slice(-2).map((x) => x.id), [t3, t2], "答えの順 (上から下へ) で底に");
assert.ok(g.hands["you"].some((x) => x.id === t1));
console.log("battle-order ok");
