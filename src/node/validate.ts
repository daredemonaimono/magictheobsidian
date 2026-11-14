import { pick, t } from "../i18n";
import { ACTIONS, CONDITIONS } from "./actions";
import { Callable, isMana } from "./params";
import { kindOf, timingOf } from "./kinds";
import { Call, NodeData } from "./md";
import { TARGETS, keywordOf, targetOf } from "./slots";

// 問題の一覧 (空なら、保存してよい。文は、設定の言語)。getNode = ほかのノード (参照の確認用。無ければ undefined)
// hasCard = 登録してあるカードか (card の引数の確認用。無ければ、確認しない)
export function validate(n: NodeData, getNode: (name: string) => NodeData | undefined, hasCard?: (name: string, filter?: string) => boolean): string[] {
  const out: string[] = [];
  if (!n.name.trim() || /[\r\n]|\[\[|\]\]/.test(n.name)) out.push(t("badName"));
  const kind = kindOf(n.kind);
  if (!kind) out.push(t("badKind", n.kind));
  else if (!timingOf(n.kind, n.timing)) out.push(t("badTiming", n.timing, pick(kind.label)));
  const check = (c: Call, defs: Callable[], what: string) => {
    const d = defs.find((x) => x.id === c.id);
    if (!d) return void out.push(t("unknownDef", what, c.id));
    const label = pick(d.label);
    if (d.only && !d.only.includes(n.kind)) out.push(t("onlyFor", what, label, d.only.map((k) => pick(kindOf(k)!.label)).join(" / ")));
    for (const p of d.params) {
      const v = c.args[p.id];
      const pl = pick(p.label);
      if (p.optional && (v === undefined || v === "")) continue; // 無くてもよい引数
      if (v === undefined) out.push(t("missingParam", what, label, pl));
      else if (p.type === "mana" && !isMana(v)) out.push(t("notMana", what, label, pl, v));
      else if (p.type === "card" && !v) out.push(t("missingParam", what, label, pl));
      else if (p.type === "card" && hasCard && !hasCard(v, p.filter)) out.push(t("noCard", v));
      else if (p.type === "number" && !/^-?\d+$/.test(v)) out.push(t("notInteger", what, label, pl, v));
      else if (p.type === "multi" && (!v || !v.split("|").every((x) => p.choices!.some((c) => c.id === x)))) out.push(t("notChoice", what, label, pl, p.choices!.map((x) => pick(x.label)).join(" / "), v));
      else if (p.type === "choice" && !p.choices!.some((x) => x.id === v)) out.push(t("notChoice", what, label, pl, p.choices!.map((x) => pick(x.label)).join(" / "), v));
    }
    for (const k of Object.keys(c.args)) if (!d.params.some((p) => p.id === k)) out.push(t("unknownParam", what, label, k));
  };
  if (n.condition) check(n.condition, CONDITIONS, t("wordCondition"));
  // 忠誠度能力 (606): 忠誠度のコストと、タイミング「忠誠度能力」は、組で持つ。起動型でだけ
  if (n.loyalty !== undefined && !/^[+-]?\d+$/.test(n.loyalty)) out.push(t("badLoyalty", n.loyalty));
  if (n.loyalty !== undefined && n.kind !== "activated") out.push(t("loyaltyOnlyActivated"));
  if (n.kind === "activated" && (n.timing === "loyalty") !== (n.loyalty !== undefined)) out.push(t("loyaltyTiming"));
  // 「それら」= この能力で生成したトークン: 生成する手順がないと、指すものがない
  if (n.target === "created-tokens" && !n.steps.some((s) => !s.node && s.id === "create-token")) out.push(t("needTokenStep"));
  // もう 1 つ以降の対象 (115.3): 対象を取るものだけ。最初の対象が要る
  if (n.alsoTargets?.length) {
    if (!n.target) out.push(t("alsoNeedsTarget"));
    for (const c of n.alsoTargets) {
      const td = targetOf(c.id);
      if (!td) out.push(t("unknownDef", t("wordTarget"), c.id));
      else {
        if (!td.targets) out.push(t("alsoNotTargeting"));
        if (td.params.length) check(c, TARGETS, t("wordTarget"));
      }
    }
  }
  if (n.steps.some((s) => !s.node && s.id === "exchange-control") && !(n.target && n.alsoTargets?.length)) out.push(t("needTwoTargets"));
  if (n.target) {
    const td = targetOf(n.target);
    if (!td) out.push(t("unknownDef", t("wordTarget"), n.target));
    else if (td.params.length) check({ id: n.target, args: n.targetArgs ?? {} }, TARGETS, t("wordTarget")); // 「各〜」の引数
  }
  if (n.keyword && !keywordOf(n.keyword)) out.push(t("unknownDef", t("wordKeyword"), n.keyword));
  if (!n.steps.length && !n.keyword) out.push(t("noSteps"));
  for (const s of n.steps) if (!s.node) check(s, ACTIONS, t("wordAction"));
  // コスト (起動型): コストの動作だけ。起動型には、コスト (または、忠誠度のコスト) が要る (602.1)
  if (n.cost?.length) {
    if (n.kind !== "activated") out.push(t("costOnlyActivated"));
    for (const c of n.cost) {
      check(c, ACTIONS, t("wordCost"));
      const d = ACTIONS.find((x) => x.id === c.id);
      if (d && !d.cost) out.push(t("notCost", pick(d.label)));
    }
  }
  if (n.kind === "activated" && n.loyalty === undefined && !n.cost?.length) out.push(t("needCost"));
  // コストの動作は、コストの欄か、代替コストの手順でだけ
  for (const s of n.steps) {
    const d = !s.node ? ACTIONS.find((x) => x.id === s.id) : undefined;
    if (d?.cost && n.timing !== "alternative-cost") out.push(t("costInSteps", pick(d.label)));
  }
  // 遅延誘発の後ろには、あとで行う手順が要る
  if (n.steps.length && !n.steps[n.steps.length - 1].node && (n.steps[n.steps.length - 1] as Call).id === "delayed-trigger") out.push(t("delayEmpty"));
  // 「支払ってもよい。そうしたなら」の後ろには、支払ったときに行う手順が要る (118.12)
  if (n.steps.length && !n.steps[n.steps.length - 1].node && (n.steps[n.steps.length - 1] as Call).id === "may-pay") out.push(t("mayPayEmpty"));
  // 「してもよい。そうしたなら」の後ろにも、行う手順が要る (118.12)
  if (n.steps.length && !n.steps[n.steps.length - 1].node && (n.steps[n.steps.length - 1] as Call).id === "may-do") out.push(t("mayDoEmpty"));
  // 参照: 無いノード・循環
  const walk = (cur: NodeData, path: string[]) => {
    for (const s of cur.steps) {
      if (!s.node) continue;
      if (path.includes(s.id)) { out.push(t("cycle", [...path, s.id].join(" → "))); continue; }
      const target = getNode(s.id);
      if (!target) out.push(t("noNode", s.id));
      else walk(target, [...path, s.id]);
    }
  };
  walk(n, [n.name]);
  return [...new Set(out)];
}
