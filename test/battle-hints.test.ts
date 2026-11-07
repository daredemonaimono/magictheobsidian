import assert from "node:assert";
import { aiOptions } from "../src/battle/ai";
import { battleHints } from "../src/battle/battleHints";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();

// 行動の分析 (コードが計算): 役割・実行したあとの局面 (試し撃ち)・色・攻撃とブロックの比較
const call = (node: string, args: NodeCall["args"] = {}, extra: Partial<NodeCall> = {}): NodeCall => ({ node, args, ...extra });
const m: Record<string, Ability[]> = {
  Bolt: [{ kind: "spell", body: [call("target", { zone: "any", kind: "any" }, { as: "t" }), call("damage", { target: { ref: "t" }, amount: 3 })] }],
  Sign: [{ kind: "spell", body: [call("draw", { player: "you", count: 2 })] }],
  Swamp: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "B" })] }],
  Island: [{ kind: "activated", body: [call("cost", { tap: true }), call("addMana", { amount: 1, color: "U" })] }],
};
const rules: RuleBook = { get: (c) => (m[c] ? { card: c, abilities: m[c] } : undefined) };
const card = (id: string, typeLine: string, owner: string, extra: Partial<GameCard> = {}): GameCard => ({ id, name: id.replace(/\d+$/, ""), typeLine, mv: 1, owner, ...extra });
const creature = (id: string, owner: string, power: number, toughness: number, extra: Partial<Perm> = {}): Perm => ({ id, card: card(id, "Creature — Bear", owner, { power, toughness }), controller: owner, enteredTurn: 0, ...extra });

const g: Game = createGame(["me", "foe"]);
g.step = "main1";
g.active = "me";
g.priority = "me";
g.turn = 3;
g.libraries["me"] = Array.from({ length: 10 }, (_, i) => card(`L${i}`, "Land", "me"));
g.hands["me"] = [card("Bolt1", "Instant", "me"), card("Sign1", "Sorcery", "me"), card("Island1", "Basic Land — Island", "me", { colors: [] }), card("Spell1", "Sorcery", "me", { manaCost: "{1}{U}" })];
g.battlefield.push({ id: "Swamp1", card: card("Swamp1", "Basic Land — Swamp", "me"), controller: "me", enteredTurn: 0 });
const opts = aiOptions(g, rules, "me");
const text = battleHints("act", g, rules, "me", opts);
assert.ok(text.includes("行動の分析"), "見出し");
const lineOf = (label: string) => text.split("\n").find((l) => l.includes(label)) ?? "";
const bolt = opts.find((o) => o.label.includes("Bolt"));
assert.ok(bolt, "Bolt が選択肢にある");
assert.ok(lineOf("Bolt").includes("damage"), "役割: damage");
assert.ok(/相手のライフ 20→17/.test(text), "試し撃ち: Bolt で相手のライフが 17 になる");
assert.ok(/Sign/.test(text) && /cardAdvantage/.test(lineOf("Sign")) && /手札/.test(lineOf("Sign")), "ドロー: cardAdvantage・手札の変化");
assert.ok(/土地/.test(text) && /出せる色: U/.test(lineOf("Island")), "土地: 出せる色");
assert.ok(/足りない色: U/.test(lineOf("Island")) || /足りない色: U/.test(text), "手札の呪文に要る色 (U) が、場の土地 (B) では足りない");
assert.equal(g.life["foe"], 20, "試し撃ちは、元の局面を変えない");
assert.equal(g.hands["me"].length, 4);

// 攻撃: 攻撃できるクリーチャーごとに、相手のブロッカーとの比べ合い
const a: Game = createGame(["me", "foe"]);
a.turn = 4;
a.battlefield.push(creature("Mine1", "me", 3, 3), creature("Mine2", "me", 1, 1), creature("Wall1", "foe", 2, 4), creature("Biter1", "foe", 4, 2));
const atk = battleHints("attack", a, rules, "me");
assert.ok(/Mine 3\/3/.test(atk) && /Wall 2\/4/.test(atk) && /Biter 4\/2/.test(atk), "ブロックしうる相手が出る");
assert.ok(/Mine 1\/1[^\n]*Wall 2\/4 にブロックされると、倒される/.test(atk), "1/1 は、2/4 にブロックされると倒される");
assert.ok(/ライフ差/.test(atk), "事実の 1 行 (ライフ差・倒すまでのターン数)");

// ブロック: 攻撃してくるクリーチャーごとに、自分のブロッカーで受けたときの結果
const b: Game = createGame(["me", "foe"]);
b.active = "foe";
b.turn = 4;
b.battlefield.push(creature("Mine1", "me", 2, 3), creature("Hit1", "foe", 3, 3, { attacking: true, attackTarget: "me" }));
const blk = battleHints("block", b, rules, "me");
assert.ok(/Hit 3\/3/.test(blk) && /Mine 2\/3 でブロックすると、自分だけが倒される/.test(blk), "2/3 で 3/3 を受けると、自分だけが倒される");
console.log("battle-hints ok");
