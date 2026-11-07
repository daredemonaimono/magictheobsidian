import { Http } from "./claude";
import { JevAnswer, askJev } from "./jev";
import { Criteria, DEFAULT_CRITERIA, QuestionDef, chunkQuestions, toJevQuestions } from "./jevCriteria";
import { JevFacts } from "./jevFacts";

// Jev に判断の基準 (jev-criteria.json) を聞いて、答えを、AI に渡す文章にする。AI が最終判断する (Jev は、材料を出すだけ)
export type Decision = "attack" | "block" | "act";
export interface Judged {
  text: string; // AI への指示に添える文章
  input: number;
  output: number;
  ms: number;
}

const pct = (n: number | undefined) => (n ?? 0).toFixed(2);

// 答え → 1 行ずつの文章。once は 1 行、each は対象ごとに 1 行
export function renderJudgments(decision: Decision, answers: Record<string, JevAnswer>, items: { id: string; label: string }[], criteria: Criteria = DEFAULT_CRITERIA): string {
  const lines: string[] = [];
  for (const q of criteria.decisions[decision]?.questions ?? []) {
    const targets = q.scope === "once" ? [{ key: q.id, label: "" }] : items.map((it, i) => ({ key: `${q.id}_${i}`, label: it.label }));
    for (const t of targets) {
      const a = answers[t.key];
      if (!a) continue;
      const head = `${q.title ?? q.id}${t.label ? ` (${t.label})` : ""}`;
      lines.push(`- ${head}: ${describe(q, a)}`);
    }
  }
  return `## Jev の判断 (参考)\nコードが計算した事実から、Jev (分類器) が機械的に分類したものです。違うと思ったら、従わなくてかまいません。\n${lines.join("\n") || "(判断なし)"}`;
}
function describe(q: QuestionDef, a: JevAnswer): string {
  if (q.type === "score") {
    const levels = q.criteria as string[];
    const s = a.score ?? 0;
    return `${levels[Math.min(levels.length - 1, Math.max(0, Math.round(s)))]} (段階 ${s.toFixed(1)} / ${levels.length - 1})`;
  }
  if (q.type === "choice") {
    const opts = q.criteria as Record<string, string | null>;
    return `${a.choice ?? "?"}${a.choice && opts[a.choice] ? ` — ${opts[a.choice]}` : ""} (自信 ${pct(a.confidence)})`;
  }
  return `はい ${pct(a.noul)}`;
}

// 判断 (attack / block / act) の質問を、事実を state にして、Jev に聞く。items = 攻撃クリーチャー・ブロッカー (each の質問の対象)。10 個を超えるときは、リクエストを分ける
export async function jevJudge(o: { apiKey: string; model: string; http: Http; decision: Decision; facts: JevFacts; items?: { id: string; label: string }[]; criteria?: Criteria }): Promise<Judged> {
  const criteria = o.criteria ?? DEFAULT_CRITERIA;
  const items = o.items ?? [];
  const qs = toJevQuestions(criteria.decisions[o.decision].questions, items);
  const results = await Promise.all(chunkQuestions(qs).map((chunk) => askJev({ apiKey: o.apiKey, model: o.model, state: o.facts as unknown as Record<string, unknown>, questions: chunk, http: o.http })));
  const answers = Object.assign({}, ...results.map((r) => r.answers)) as Record<string, JevAnswer>;
  const f = o.facts;
  const factsLine = `計算済みの事実: ライフ差 ${f.lifeDiff >= 0 ? "+" : ""}${f.lifeDiff} / 相手を倒すまで ${f.turnsToKillOpp ?? "倒せない"} ターン / 自分が倒されるまで ${f.turnsToKillMe ?? "倒されない"} ターン / 使えるマナ ${f.availableMana} / 相手のアンタップの土地 ${f.oppUntappedMana}`;
  return { text: `${renderJudgments(o.decision, answers, items, criteria)}\n${factsLine}`, input: results.reduce((a, r) => a + r.input, 0), output: results.reduce((a, r) => a + r.output, 0), ms: Math.max(0, ...results.map((r) => r.ms)) };
}

// ---- カードの分類 (cards の質問): 1 枚につき 1 回だけ聞いて、結果は保存して使い回す
export type CardTags = Record<string, number>; // 質問の id → はい の確率
export const TAG_THRESHOLD = 0.6;
export const tagNames = (t: CardTags | undefined, threshold = TAG_THRESHOLD): string[] => Object.entries(t ?? {}).filter(([, p]) => p >= threshold).map(([id]) => id);

export async function cardTagsOf(o: { apiKey: string; model: string; http: Http; cards: { name: string; typeLine?: string; text: string }[]; criteria?: Criteria }): Promise<Record<string, CardTags>> {
  const criteria = o.criteria ?? DEFAULT_CRITERIA;
  const questions = Object.fromEntries(
    criteria.cards.questions.map((q) => [q.id, { type: q.type, instructions: q.instructions, ...(q.criteria !== undefined ? { criteria: q.criteria } : {}) }]),
  ) as Parameters<typeof askJev>[0]["questions"];
  const out: Record<string, CardTags> = {};
  await Promise.all(
    o.cards.map(async (c) => {
      const r = await askJev({ apiKey: o.apiKey, model: o.model, state: { name: c.name, ...(c.typeLine ? { type: c.typeLine } : {}), text: c.text }, questions, http: o.http });
      out[c.name] = Object.fromEntries(Object.entries(r.answers).map(([id, a]) => [id, a.noul ?? 0]));
    }),
  );
  return out;
}
