import { CardRule } from "./node";
import { checkCall, getNode, placementProblem } from "./registry";
import { parseRule } from "./ruleMd";
import { SCENARIOS } from "./samples";

// カードごとの状況。「動くはず」ではなく、実際に動いた記録 (最小シナリオの合格) だけを ok の根拠にする
export type Status = "ok" | "partial" | "unbuilt";
export interface CardStatus {
  card: string;
  status: Status;
  reasons: string[];
}

export const NO_RULE = "ルールのノートが無い";
export const NO_NODES = "ノードが未設定"; // md はあるが、ノードが1つも無い (## 未対応 だけ、など)。ノートが無いのと同じ未設定扱い

const unbuilt = (card: string, reasons: string[]): CardStatus => ({ card, status: "unbuilt", reasons });

// md が無い・読めない・未知のノードや引数の誤り = unbuilt (組めていない)。
// 組めているが、実装の無いノードがある・シナリオが無い・シナリオが失敗する = partial。すべて動いたら ok
export function cardStatus(card: string, md: string | undefined): CardStatus {
  if (md === undefined) return unbuilt(card, [NO_RULE]);
  let rule: CardRule;
  try {
    rule = parseRule(md);
  } catch (e) {
    return unbuilt(card, [(e as Error).message]);
  }
  if (rule.card !== card) return unbuilt(card, [`card: が "${rule.card}" で、ファイル名 (${card}) と合わない`]);
  const calls = rule.abilities.flatMap((a) => a.body);
  if (!calls.length) return unbuilt(card, [NO_NODES, ...(rule.unsupported ?? []).map((u) => `未対応: ${u}`)]);
  const bad = rule.abilities.flatMap((ab) => ab.body.map((c) => ({ c, why: checkCall(c) ?? placementProblem(ab.kind, c) }))).filter((x) => x.why);
  if (bad.length) return unbuilt(card, bad.map((x) => `${x.c.line ?? "?"} 行目: ${x.why}`));

  if (rule.unsupported?.length) return { card, status: "partial", reasons: rule.unsupported.map((u) => `未対応: ${u}`) };
  const missing = [...new Set(calls.filter((c) => !getNode(c.node)!.run).map((c) => `未実装: ${c.node}`))];
  if (missing.length) return { card, status: "partial", reasons: missing };
  const scenario = SCENARIOS[card];
  if (!scenario) return { card, status: "partial", reasons: ["シナリオが無い (動いた記録が無い)"] };
  try {
    scenario(rule);
  } catch (e) {
    return { card, status: "partial", reasons: [`シナリオが失敗: ${(e as Error).message}`] };
  }
  return { card, status: "ok", reasons: [] };
}

// そのノードを使うカード (ノードを直したとき、影響を受ける範囲)
export const nodeUsers = (rules: CardRule[], nodeId: string): string[] => rules.filter((r) => r.abilities.some((a) => a.body.some((c) => c.node === nodeId))).map((r) => r.card);

export const report = (cards: CardStatus[]): string => `| カード | 状況 | 理由 |\n|---|---|---|\n${cards.map((c) => `| ${c.card} | ${c.status} | ${c.reasons.join("; ")} |`).join("\n")}\n`;
