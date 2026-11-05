import assert from "node:assert";
import { AskAi } from "../src/battle/ai";
import { aiMulligan, applyMulligan } from "../src/battle/aiMulligan";
import { CardData, DeckData, buildMatch } from "../src/battle/deckToGame";
import { CPU_MAX_MULLIGANS } from "../src/battle/cpu";
import { seeded } from "../src/battle/rng";
import { registerBuiltinNodes } from "../src/battle/nodes";
import { resetRegistry } from "../src/battle/registry";
import { RuleBook } from "../src/battle/state";

resetRegistry();
registerBuiltinNodes();
const rules: RuleBook = { get: () => undefined };
const data = (name: string, extra: Partial<CardData> = {}) => ({ key: name, data: { name, typeLine: "Creature — Bear", cmc: 2, manaCost: "{1}{U}", colors: ["U"], power: "2", toughness: "2", ...extra } as CardData });
const deck = (): DeckData => ({ format: "standard", main: [{ ...data("Island", { typeLine: "Basic Land — Island", cmc: 0, manaCost: "" }), n: 24 }, { ...data("Bear"), n: 36 }] });
const fresh = (seed: number) => {
  const rng = seeded(seed);
  const g = buildMatch(deck(), deck(), rules, rng);
  return { g, rng };
};
const ids = (g: ReturnType<typeof fresh>["g"]) => JSON.stringify([g.hands["opp"].map((c) => c.id), g.libraries["opp"].map((c) => c.id)]);

// AI が、2 回マリガンして、3 回目でキープ。底に置くカードを、手札から 2 枚選ぶ
{
  const { g, rng } = fresh(7);
  const systems: string[] = [];
  let k = 0;
  const ask: AskAi = async (system, user) => {
    systems.push(system);
    if (user.includes("底に置くカード")) return { text: JSON.stringify({ bottom: [g.hands["opp"][0].id, g.hands["opp"][1].id], why: "x" }) };
    return { text: JSON.stringify({ keep: ++k >= 3 }) };
  };
  const r = await aiMulligan(g, "opp", rng, ask, "土地が2枚以下ならマリガン");
  assert.equal(r.count, 2);
  assert.equal(r.bottom.length, 2);
  assert.equal(g.hands["opp"].length, 5, "7 枚引き直して、2 枚を底に置いた");
  assert.ok(systems.every((s) => s.includes("土地が2枚以下ならマリガン")), "メモが、指示に入る");
  assert.ok(g.log.includes("相手はマリガンした (2 回)"));
  // リプレイ: 同じ種で、記録の結果から、同じ手札・山札を作り直す (API は呼ばない)
  const again = fresh(7);
  applyMulligan(again.g, "opp", again.rng, r);
  assert.equal(ids(again.g), ids(g));
}
// メモが無ければ、自己判断 (指示にメモの文章が入らない)
{
  const { g, rng } = fresh(3);
  let sys = "";
  await aiMulligan(g, "opp", rng, async (s) => ((sys = s), { text: '{"keep": true}' }));
  assert.ok(!sys.includes("持ち主が書いたメモ"));
  assert.ok(g.log.includes("相手はキープした"));
}
// AI が、いつもマリガンと言っても、上限 (CPU_MAX_MULLIGANS) で、キープ
{
  const { g, rng } = fresh(5);
  const r = await aiMulligan(g, "opp", rng, async (_s, u) => (u.includes("底に置くカード") ? { text: "{}" } : { text: '{"keep": false}' }));
  assert.equal(r.count, CPU_MAX_MULLIGANS);
  assert.equal(g.hands["opp"].length, 7 - CPU_MAX_MULLIGANS, "底の指定が無ければ、雑魚 CPU の決まりで選ぶ");
}
// 通信の失敗: 雑魚 CPU の決まりで済ませる (落ちない)
{
  const { g, rng } = fresh(9);
  const r = await aiMulligan(g, "opp", rng, async () => { throw new Error("通信の失敗"); });
  assert.ok(r.count >= 0 && g.hands["opp"].length === 7 - r.count);
  const again = fresh(9);
  applyMulligan(again.g, "opp", again.rng, r);
  assert.equal(ids(again.g), ids(g), "失敗したときの結果も、リプレイで再現できる");
}
console.log("aimulligan ok");
