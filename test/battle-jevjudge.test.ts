import assert from "node:assert";
import { Http } from "../src/battle/claude";
import { Ability, NodeCall } from "../src/battle/node";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { Game, GameCard, Perm, RuleBook, createGame } from "../src/battle/state";
import { jevFacts } from "../src/battle/jevFacts";
import { cardTagsOf, jevJudge, renderJudgments, tagNames } from "../src/battle/jevJudge";
import { DEFAULT_CRITERIA, toJevQuestions } from "../src/battle/jevCriteria";

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
const f = jevFacts(g, book, "you", (name) => (name === "Doom" ? ["stopsAttacker"] : []));
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
const none = jevFacts(createGame(["you", "opp"]), book, "you");
assert.equal(none.turnsToKillOpp, null, "攻撃できるものが無ければ null");

// ---- Jev に聞く: 質問は、JSON から。答えは、読みやすい文章にして、AI に渡す
const asked: { state: unknown; questions: Record<string, { type: string; instructions: string }> }[] = [];
const http: Http = async (_url, _h, body) => {
  const b = JSON.parse(body);
  asked.push({ state: b.state, questions: b.questions });
  const answers: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(b.questions as Record<string, { type: string }>)) {
    answers[k] = q.type === "score" ? { type: "score", score: 3.4, confidence: 0.8 } : q.type === "choice" ? { type: "choice", choice: "me", confidence: 0.9, probabilities: { me: 0.9, opp: 0.05, even: 0.05 } } : { type: "noul", noul: k.endsWith("_1") ? 0.2 : 0.85 };
  }
  return { status: 200, json: { model: "jev-1", answers, usage: { input_tokens: 500, output_tokens: 20 } } };
};
const items = [{ id: "A1", label: "A1 3/3" }, { id: "A2", label: "A2 1/1" }];
const r = await jevJudge({ apiKey: "K", model: "jev-latest", http, decision: "attack", facts: f, items });
assert.equal(asked.length, 1, "質問は 1 リクエスト (10 個以内)");
assert.ok(typeof asked[0].state === "object" && (asked[0].state as { lifeDiff: number }).lifeDiff === 12, "状態は、事実の JSON");
assert.equal(Object.keys(asked[0].questions).length, 2 + 2 * 2, "once 2 つ + each 2 つ × 攻撃クリーチャー 2 体");
assert.ok(r.text.includes("形勢: やや有利") && r.text.includes("3.4"), "score は、段階の名前で");
assert.ok(r.text.includes("先に倒せるのは: me"), "choice は、選んだもの");
assert.ok(/ブロックで倒されそうか.*A1 3\/3.*0\.85/.test(r.text) && /A2 1\/1.*0\.20/.test(r.text), "each は、対象ごとの はい の確率");
assert.equal(r.input, 500);

// 11 個以上は、リクエストを分ける
asked.length = 0;
const many = Array.from({ length: 6 }, (_, i) => ({ id: `X${i}`, label: `X${i}` }));
await jevJudge({ apiKey: "K", model: "jev-latest", http, decision: "attack", facts: f, items: many });
assert.equal(asked.length, 2, "2 + 2 × 6 = 14 個 → 2 リクエスト");
assert.ok(asked.every((a) => Object.keys(a.questions).length <= 10));

// ---- カードの分類 (1 枚 1 回): 結果を返す。tags は、しきい値以上の名前
asked.length = 0;
const tags = await cardTagsOf({ apiKey: "K", model: "jev-latest", http, cards: [{ name: "Swords", text: "Exile target creature." }] });
assert.equal(asked.length, 1);
assert.ok(typeof asked[0].state === "object" && (asked[0].state as { name: string }).name === "Swords");
assert.deepEqual(Object.keys(tags.Swords).sort(), ["removesPermanent", "stopsAttacker", "stopsSpell"]);
assert.deepEqual(tagNames({ stopsAttacker: 0.9, stopsSpell: 0.2, removesPermanent: 0.7 }), ["stopsAttacker", "removesPermanent"]);

// ---- 定義から、そのまま送れる形 (each の展開)
assert.ok(Object.keys(toJevQuestions(DEFAULT_CRITERIA.decisions.attack.questions, items)).includes("attackerSafe_1"));
assert.ok(renderJudgments("block", {}, []).includes("Jev"));
console.log("battle-jevjudge ok");
