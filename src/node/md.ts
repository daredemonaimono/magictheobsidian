import { Def } from "./actions";

// ノード = Nodes/<名前>.md。形:
//   ---\n mtg: node\n kind: 誘発型能力\n timing: 攻撃したとき\n ---
//   # 名前
//   条件: <条件> key=値      (任意)
//   ## 手順
//   - <動作> key=値 ...      または   - [[別のノード]]
export interface Call {
  id: string;
  args: Record<string, string>;
}
export type Step = ({ node: false } & Call) | { node: true; id: string };
export interface NodeData {
  name: string;
  kind: string;
  timing: string;
  condition?: Call;
  steps: Step[];
}

const fmtVal = (v: string) => (/[\s"]/.test(v) || v === "" ? `"${v.replace(/"/g, "'")}"` : v);
const fmtCall = (c: Call) => [c.id, ...Object.entries(c.args).map(([k, v]) => `${k}=${fmtVal(v)}`)].join(" ");

export function toMd(n: NodeData): string {
  const out = ["---", "mtg: node", `kind: ${n.kind}`, `timing: ${n.timing}`, "---", `# ${n.name}`, ""];
  if (n.condition) out.push(`条件: ${fmtCall(n.condition)}`, "");
  out.push("## 手順", ...n.steps.map((s) => (s.node ? `- [[${s.id}]]` : `- ${fmtCall(s)}`)), "");
  return out.join("\n");
}

export function parseCall(text: string): Call {
  const t = text.trim();
  const m = /\s[^\s=]+=/.exec(t);
  const id = (m ? t.slice(0, m.index) : t).trim();
  const args: Record<string, string> = {};
  const rest = m ? t.slice(m.index) : "";
  for (const x of rest.matchAll(/([^\s=]+)=(?:"([^"]*)"|(\S*))/g)) args[x[1]] = x[2] ?? x[3];
  return { id, args };
}

export function parseMd(md: string): NodeData {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!fm) throw new Error("先頭の --- ... --- が読めない");
  const meta = (k: string) => new RegExp(`^${k}: *(.*)$`, "m").exec(fm[1])?.[1].trim() ?? "";
  if (meta("mtg") !== "node") throw new Error("mtg: node ではない");
  const body = md.slice(fm[0].length);
  const name = /^# (.+)$/m.exec(body)?.[1].trim();
  if (!name) throw new Error("見出し (# 名前) が無い");
  const cond = /^条件: *(.+)$/m.exec(body)?.[1];
  const steps: Step[] = [];
  const sec = /^## 手順\n([\s\S]*)$/m.exec(body)?.[1] ?? "";
  for (const line of sec.split("\n")) {
    const m = /^- (.+)$/.exec(line);
    if (!m) continue;
    const ref = /^\[\[(.+)\]\]$/.exec(m[1].trim());
    steps.push(ref ? { node: true, id: ref[1] } : { node: false, ...parseCall(m[1]) });
  }
  return { name, kind: meta("kind"), timing: meta("timing"), ...(cond ? { condition: parseCall(cond) } : {}), steps };
}

export const defaults = (d: Def): Record<string, string> => Object.fromEntries(d.params.map((p) => [p.label, p.default]));
