import assert from "node:assert";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";
import { battleFacts } from "../src/battle/battleFacts";

resetRegistry();
registerBuiltinNodes();

// 事実 (コードが計算): ライフ差・倒すまでのターン数・盤面・マナ・手札で使える行動
const card = (id: string, typeLine: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id, typeLine, mv: 1, owner, ...extra });
const call = (node: string, args: NodeCall["args"]): NodeCall => ({ node, args });
const rulesOf = (m: Record<string, Ability[]>): RuleBook => ({ get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) });
const creature = (id: string, owner: string, power: number, toughness: number, extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power, toughness }), controller: owner, enteredTurn: 0, ...extra });
const book = rulesOf({ Doom: [{ kind: "spell", body: [call("target", { zone: "battlefield", kind: "permanent" })] }], Mana: [{ kind: "spell", body: [] }] });

const g: Game = createGame(["you", "opp"]);
g.turn = 5;
g.payManaCosts = true;
g.priority = "you";
g.life = { you: 20, opp: 8 };
g.battlefield.push(creature("A1", "you", 3, 3), creature("A2", "you", 1, 1, { enteredTurn: 5 }), creature("B1", "opp", 2, 2, { tapped: true }), { id: "Plains", card: card("Plains", "Basic Land — Plains", "opp"), controller: "opp", enteredTurn: 0 }, { id: "Swamp", card: card("Swamp", "Basic Land — Swamp", "opp"), controller: "opp", enteredTurn: 0, tapped: true });
g.hands["you"] = [card("Doom", "Instant", "you", { mv: 2 }), card("Mana", "Sorcery", "you", { mv: 9 })];
g.mana["you"] = 0;
const f = battleFacts(g, book, "you", (name) => (name === "Doom" ? ["stopsAttacker"] : []));
assert.deepEqual(f.life, { you: 20, opp: 8 });
assert.equal(f.lifeDiff, 12);
assert.equal(f.turnsToKillOpp, 3, "召喚酔いでない A1 (3) だけで、8 点を倒す: 3 ターン");
assert.equal(f.turnsToKillMe, 10, "相手の B1 (2) で、20 点: 10 ターン");
assert.equal(f.board.length, 3);
assert.deepEqual(f.board.find((b) => b.name === "A2"), { owner: "you", name: "A2", power: 1, toughness: 1, tapped: false, attacking: false, summoningSick: true, keywords: [] });
assert.equal(f.oppUntappedMana, 1, "相手のアンタップの土地は 1 つ");
assert.equal(f.handActions.length, 2);
assert.deepEqual(f.handActions.map((h) => [h.card, h.cost, h.tags]), [["Doom", 2, ["stopsAttacker"]], ["Mana", 9, []]]);
assert.ok(f.handActions.every((h) => h.castable === false), "マナが無いので、どれも、いま唱えられない");
const none = battleFacts(createGame(["you", "opp"]), book, "you");
assert.equal(none.turnsToKillOpp, null, "攻撃できるものが無ければ null");

console.log("battle-facts ok");
