import { pick, t } from "../i18n";
import { ACTIONS, CONDITIONS, Def } from "./actions";
import { kindOf, timingOf } from "./kinds";
import { Call, NodeData } from "./md";
import { keywordOf, targetOf } from "./slots";

// 問題の一覧 (空なら、保存してよい。文は、設定の言語)。getNode = ほかのノード (参照の確認用。無ければ undefined)
export function validate(n: NodeData, getNode: (name: string) => NodeData | undefined): string[] {
  const out: string[] = [];
  if (!n.name.trim() || /[\r\n]|\[\[|\]\]/.test(n.name)) out.push(t("badName"));
  const kind = kindOf(n.kind);
  if (!kind) out.push(t("badKind", n.kind));
  else if (!timingOf(n.kind, n.timing)) out.push(t("badTiming", n.timing, pick(kind.label)));
  const check = (c: Call, defs: Def[], what: string) => {
    const d = defs.find((x) => x.id === c.id);
    if (!d) return void out.push(t("unknownDef", what, c.id));
    const label = pick(d.label);
    if (d.only && !d.only.includes(n.kind)) out.push(t("onlyFor", what, label, d.only.map((k) => pick(kindOf(k)!.label)).join(" / ")));
    for (const p of d.params) {
      const v = c.args[p.id];
      const pl = pick(p.label);
      if (v === undefined) out.push(t("missingParam", what, label, pl));
      else if (p.type === "number" && !/^-?\d+$/.test(v)) out.push(t("notInteger", what, label, pl, v));
      else if (p.type === "multi" && (!v || !v.split("|").every((x) => p.choices!.some((c) => c.id === x)))) out.push(t("notChoice", what, label, pl, p.choices!.map((x) => pick(x.label)).join(" / "), v));
      else if (p.type === "choice" && !p.choices!.some((x) => x.id === v)) out.push(t("notChoice", what, label, pl, p.choices!.map((x) => pick(x.label)).join(" / "), v));
    }
    for (const k of Object.keys(c.args)) if (!d.params.some((p) => p.id === k)) out.push(t("unknownParam", what, label, k));
  };
  if (n.condition) check(n.condition, CONDITIONS, t("wordCondition"));
  if (n.target && !targetOf(n.target)) out.push(t("unknownDef", t("wordTarget"), n.target));
  if (n.keyword && !keywordOf(n.keyword)) out.push(t("unknownDef", t("wordKeyword"), n.keyword));
  if (!n.steps.length && !n.keyword) out.push(t("noSteps"));
  for (const s of n.steps) if (!s.node) check(s, ACTIONS, t("wordAction"));
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
