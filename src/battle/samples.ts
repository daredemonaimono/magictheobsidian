import { RuleError, castSpell, passPriority } from "./engine";
import { CardRule } from "./node";
import { registerBuiltinNodes } from "./nodes";
import { GameCard, RuleBook, createGame } from "./state";

// 打ち消し3種の Rules/*.md の本文 (「Battle: create sample rules」と、テストが使う)。
// 3枚とも同じ2つのノードで、違いは「対象」の条件だけ (カード専用のノードは作らない)
const counterspell = (card: string, condition: string) => `---
mtg: rule
card: "[[${card}]]"
---

## 呪文能力

- target as=t zone=stack kind=spell ${condition}
- counter target=$t
`;

export const SAMPLE_RULES: Record<string, string> = {
  Negate: counterspell("Negate", "notType=creature"),
  "Essence Scatter": counterspell("Essence Scatter", "type=creature"),
  "Spell Snare": counterspell("Spell Snare", "mv=2"),
};

// 最小シナリオ: 打ち消しが、条件に合う呪文を打ち消し、合わない呪文は対象にできないこと。coverage が「動いた記録」にする
export type Scenario = (rule: CardRule) => void; // vault の md から読んだルールを実行する (内蔵サンプルではなく)

const must = (ok: boolean, msg: string) => {
  if (!ok) throw new Error(msg);
};

function counterScenario(name: string, good: GameCard, bad: GameCard): Scenario {
  return (rule) => {
    registerBuiltinNodes();
    const rules = new Map<string, CardRule>([[name, rule]]);
    for (const c of [good, bad]) rules.set(c.name, { card: c.name, abilities: [{ kind: "spell", body: [] }] }); // 効果の無い呪文
    const book: RuleBook = { get: (c) => rules.get(c) };

    const g = createGame(["A", "B"]);
    g.hands["A"].push(good, bad);
    g.hands["B"].push({ id: "counter", name, typeLine: "Instant", mv: 2, owner: "B" });
    // 2つとも積んでから応答する。クリーチャー (ソーサリーのタイミング) を先に唱え、インスタントを上に重ねる
    const isInstant = (c: GameCard) => /\bInstant\b/.test(c.typeLine);
    for (const c of [good, bad].sort((a, b) => Number(isInstant(a)) - Number(isInstant(b)))) castSpell(g, "A", c.id, {}, book);
    passPriority(g, "A", book);
    let refused = false;
    try {
      castSpell(g, "B", "counter", { t: bad.id }, book);
    } catch (e) {
      refused = e instanceof RuleError;
    }
    must(refused, `${name}: 条件に合わない呪文を対象にできてしまった`);
    castSpell(g, "B", "counter", { t: good.id }, book);
    passPriority(g, "B", book);
    passPriority(g, "A", book);
    must(!g.stack.some((s) => s.id === good.id), `${name}: 対象が打ち消されていない`);
    must(g.graveyards["A"].some((c) => c.id === good.id), `${name}: 打ち消された呪文が墓地に無い`);
  };
}

const spell = (name: string, typeLine: string, mv: number): GameCard => ({ id: name, name, typeLine, mv, owner: "A" });
const bolt = spell("bolt", "Instant", 1);
const bears = spell("bears", "Creature — Bear", 2);
const ritual = spell("ritual", "Instant", 3);

export const SCENARIOS: Record<string, Scenario> = {
  Negate: counterScenario("Negate", bolt, bears),
  "Essence Scatter": counterScenario("Essence Scatter", bears, bolt),
  "Spell Snare": counterScenario("Spell Snare", bears, ritual),
};
