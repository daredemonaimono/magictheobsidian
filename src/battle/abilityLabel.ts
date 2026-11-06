import { getNode } from "./registry";
import { StackItem } from "./state";

// スタックの能力の説明: 忠誠度能力なら「+1: 〜」「−2: 〜」、誘発型なら「誘発: 〜」、それ以外は「起動: 〜」。〜は、効果のノードの名前 (コスト・タイミング・対象は除く)
export function abilityLabel(s: StackItem): string | undefined {
  if (!s.ability || !s.body) return undefined;
  const loyalty = s.loyalty;
  const what = s.body.filter((c) => !["cost", "timing", "when", "target", "self"].includes(c.node)).map((c) => getNode(c.node)?.title ?? c.node).join("、");
  const head = s.loyaltyX ? `−X (X=${s.x ?? 0})` : loyalty !== undefined ? (loyalty >= 0 ? `+${loyalty}` : `−${-loyalty}`) : s.body.some((c) => c.node === "when") ? "誘発" : "起動";
  return what ? `${head}: ${what}` : head;
}
