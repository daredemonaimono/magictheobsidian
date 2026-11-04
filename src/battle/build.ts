import { Msg } from "./claude";
import { buildPrompt } from "./prompt";
import { checkCall, placementProblem, structureProblem } from "./registry";
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
function problemsOf(md: string, card: string): string[] {
  try {
    const rule = parseRule(md);
    if (rule.card !== card) return [`card: が "${rule.card}" になっている。"${card}" にする`];
    return rule.abilities.flatMap((a) => {
      const sp = structureProblem(a);
      return [
        ...(sp ? [`${a.body[0].line ?? "?"} 行目: ${sp}`] : []),
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
export async function buildRule(o: { card: string; oracle: string; ruling?: string; glossary?: string; ask: (system: string, messages: Msg[]) => Promise<string> }): Promise<{ md: string; attempts: number }> {
  const { system, user } = buildPrompt(o.card, o.oracle, o.ruling, o.glossary);
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
