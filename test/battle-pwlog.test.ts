import assert from "node:assert";
import { readFileSync } from "node:fs";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { cpuDo } from "../src/battle/cpu";
import { passPriority } from "../src/battle/engine";
import { boardModel } from "../src/battle/boardModel";
import { resetRegistry } from "../src/battle/registry";
import { parseRule } from "../src/battle/ruleMd";
import { Game, GameCard, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
// 相手のプレインズウォーカーが能力を使ったとき、どの能力か (+2 など) と、何を得たかが、ログに残る (実際の Oko のノート)
const VAULT = "/Users/daredemonai/Documents/Westeros/MagicTheObsidian/Rules";
const rules: RuleBook = { get: (c) => (c === "Oko, Thief of Crowns" ? parseRule(readFileSync(`${VAULT}/${c}.md`, "utf-8")) : undefined) };
const card = (id: string, name: string, typeLine: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name, typeLine, mv: 3, owner, ...extra });
const g: Game = createGame(["you", "opp"]);
g.turn = 4;
g.active = "opp";
g.step = "main1";
g.priority = "opp";
g.battlefield.push({ id: "OK", card: card("OK", "Oko, Thief of Crowns", "Legendary Planeswalker — Oko", "opp", { loyalty: 4 }), controller: "opp", counters: { loyalty: 4 }, enteredTurn: 0 });
cpuDo(g, rules, "opp", { kind: "activate", perm: "OK", index: 0 });
assert.ok(g.log.some((l) => l.startsWith("相手が Oko, Thief of Crowns の能力 +2: ") && l.endsWith("を起動した")), `どの能力か: ${g.log.join(" / ")}`);
// 積まれた能力は、忠誠度のコストを持つ (拡大表示が、使った能力の行だけを出せる)
const view = boardModel(g, rules, "you", () => undefined).stack[0];
assert.equal(view.loyalty, 2);
for (let i = 0; g.stack.length && i < 6; i++) passPriority(g, g.priority!, rules);
assert.ok(g.log.some((l) => l === "相手が Food (トークン) を作った"), `何を得たか: ${g.log.join(" / ")}`);
console.log("pwlog ok");
