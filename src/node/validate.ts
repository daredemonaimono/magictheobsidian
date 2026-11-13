import { ACTIONS, CONDITIONS, Def } from "./actions";
import { kindOf, timingOf } from "./kinds";
import { Call, NodeData } from "./md";

// 問題の一覧 (空なら、保存してよい)。getNode = ほかのノード (参照の確認用。無ければ undefined)
export function validate(n: NodeData, getNode: (name: string) => NodeData | undefined): string[] {
  const out: string[] = [];
  if (!n.name.trim() || /[\\/:*?"<>|[\]#^]/.test(n.name)) out.push("名前が空か、使えない文字 (\\ / : * ? \" < > | [ ] # ^) を含む");
  if (!kindOf(n.kind)) out.push(`種類 "${n.kind}" は、定義にない`);
  else if (!timingOf(n.kind, n.timing)) out.push(`タイミング "${n.timing}" は、${n.kind}にない`);
  const check = (c: Call, defs: Def[], what: string) => {
    const d = defs.find((x) => x.id === c.id);
    if (!d) return void out.push(`${what} "${c.id}" は、定義にない`);
    if (d.only && !d.only.includes(n.kind)) out.push(`${what} "${c.id}" は、${d.only.join("・")}でだけ使える`);
    for (const p of d.params) {
      const v = c.args[p.label];
      if (v === undefined) out.push(`${what} "${c.id}": ${p.label} が無い`);
      else if (p.type === "number" && !/^-?\d+$/.test(v)) out.push(`${what} "${c.id}": ${p.label} は整数 (${v})`);
      else if (p.type === "choice" && !p.choices!.includes(v)) out.push(`${what} "${c.id}": ${p.label} は ${p.choices!.join(" / ")} のどれか (${v})`);
    }
    for (const k of Object.keys(c.args)) if (!d.params.some((p) => p.label === k)) out.push(`${what} "${c.id}": ${k} は、引数にない`);
  };
  if (n.condition) check(n.condition, CONDITIONS, "条件");
  if (!n.steps.length) out.push("手順が空");
  for (const s of n.steps) if (!s.node) check(s, ACTIONS, "動作");
  // 参照: 無いノード・循環
  const walk = (cur: NodeData, path: string[]) => {
    for (const s of cur.steps) {
      if (!s.node) continue;
      if (path.includes(s.id)) { out.push(`循環: ${[...path, s.id].join(" → ")}`); continue; }
      const t = getNode(s.id);
      if (!t) out.push(`ノード [[${s.id}]] が無い`);
      else walk(t, [...path, s.id]);
    }
  };
  walk(n, [n.name]);
  return [...new Set(out)];
}
