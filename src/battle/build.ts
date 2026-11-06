import { Msg } from "./claude";
import { buildPrompt, parseSelection, selectPrompt, selectSystem } from "./prompt";
import { checkCall, placementProblem, refProblems, structureProblem } from "./registry";
import { RuleParseError, parseRule } from "./ruleMd";

export class BuildError extends Error {
  constructor(message: string, public problems: string[]) {
    super(message);
  }
}

// 返事から md を取り出す: ```md の囲み、無ければ ``` の囲み、無ければ全体
const extract = (reply: string): string => {
  const m = reply.match(/```md\n([\s\S]*?)```/) ?? reply.match(/```\n?([\s\S]*?)```/);
  return m ? m[1] : reply.trim() + "\n";
};

// 読み込み (parseRule)・カード名の一致・全ノード呼び出しの検証 (checkCall)。問題が無ければ空
export function problemsOf(md: string, card: string): string[] {
  try {
    const rule = parseRule(md);
    if (rule.card !== card) return [`card: が "${rule.card}" になっている。"${card}" にする`];
    return rule.abilities.flatMap((a) => {
      const sp = structureProblem(a);
      return [
        ...(sp ? [`${a.body[0].line ?? "?"} 行目: ${sp}`] : []),
        ...refProblems(a).map((r) => `${a.body[r.node].line ?? "?"} 行目: ${r.message}`),
        ...a.body.flatMap((c) => {
          const why = checkCall(c) ?? placementProblem(a.kind, c);
          return why ? [`${c.line ?? "?"} 行目: ${why}`] : [];
        }),
      ];
    });
  } catch (e) {
    if (e instanceof RuleParseError) return [e.message];
    throw e;
  }
}

// AI にカードの md を作らせる。検証を通ったものだけを返す。通らなければ、問題を渡して1回だけやり直させる。通信のエラーはそのまま投げる
export async function buildRule(o: { card: string; oracle: string; ruling?: string; glossary?: string; nodes?: ReadonlySet<string>; hints?: boolean; ask: (system: string, messages: Msg[]) => Promise<string> }): Promise<{ md: string; attempts: number }> {
  const { system, user } = buildPrompt(o.card, o.oracle, o.ruling, o.glossary, o.nodes, o.hints ?? true);
  const messages: Msg[] = [{ role: "user", content: user }];
  let problems: string[] = [];
  for (let attempts = 1; attempts <= 2; attempts++) {
    const reply = await o.ask(system, messages);
    const md = extract(reply);
    problems = problemsOf(md, o.card);
    if (!problems.length) return { md, attempts };
    messages.push({ role: "assistant", content: reply }, { role: "user", content: `次の問題がある。直して、md だけを返して。\n${problems.map((p) => `- ${p}`).join("\n")}` });
  }
  throw new BuildError(`${o.card}: AI の返事が検証を通らなかった (${problems.join(" / ")})`, problems);
}

// 書けなかった効果の行 (`## 未対応` の見出しの下の、箇条書き)
export function unsupportedLines(md: string): string[] {
  const m = md.match(/^## 未対応\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  return m ? m[1].split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean) : [];
}

// 書けなかった効果が残っているか (`## 未対応` の見出しがある)
const hasUnsupported = (md: string): boolean => /^## 未対応\s*$/m.test(md);

export interface TwoStageResult {
  md: string;
  attempts: number;
  selected?: string[]; // 1段目で選んだノード (選ばなかった・使えなかったときは、無し: 全ノードを渡した)
  missing: string[]; // 1段目が、「一覧のノードでは、書けなさそう」と答えた効果 (次に作るノードの手がかり)
  fallback: boolean; // 「未対応」が残ったので、全ノードで、やり直した
}

// ルールを書かせる、2段階。1段目 (askSelect): カードの効果から、使いそうなノードを選ばせる (安い AI で足りる)。2段目 (ask): 中心のノード + 選んだノードだけを渡して、書かせる。
// 取りこぼしの保険: 2段目の結果に「未対応」が残ったら、全ノードで、もう1回だけ、やり直す (選び漏れで、書けるものを、未対応にしないため)。1段目が使えない・返事が読めないときは、最初から、全ノード。askSelect が無ければ、1段目は飛ばす
export async function buildRuleTwoStage(o: { card: string; oracle: string; ruling?: string; glossary?: string; ask: (system: string, messages: Msg[]) => Promise<string>; askSelect?: (system: string, user: string) => Promise<string>; askSelectCard?: (card: string, oracle: string, ruling?: string) => Promise<string>; hints?: boolean }): Promise<TwoStageResult> {
  let selection: ReturnType<typeof parseSelection>;
  if (o.askSelect || o.askSelectCard) {
    try {
      // askSelectCard = カードの情報だけを渡す形 (Jev: ノードごとに「要るか」を聞く)。askSelect = 一覧つきの文章を渡す形 (LLM)
      const text = o.askSelectCard ? await o.askSelectCard(o.card, o.oracle, o.ruling) : await o.askSelect!(selectSystem(), selectPrompt(o.card, o.oracle, o.ruling));
      selection = parseSelection(text);
    } catch {
      selection = undefined; // 1段目の失敗は、全ノードで、続ける
    }
  }
  const base = { card: o.card, oracle: o.oracle, ruling: o.ruling, glossary: o.glossary, ask: o.ask, hints: o.hints };
  if (!selection) return { ...(await buildRule(base)), missing: [], fallback: false };
  const first = await buildRule({ ...base, nodes: selection.ids });
  const selected = [...selection.ids];
  if (!hasUnsupported(first.md)) return { ...first, selected, missing: selection.missing, fallback: false };
  try {
    const full = await buildRule(base);
    return { md: full.md, attempts: first.attempts + full.attempts, selected, missing: selection.missing, fallback: true };
  } catch {
    return { ...first, selected, missing: selection.missing, fallback: false }; // やり直しが、検証を通らなくても、最初の結果は、使える
  }
}
