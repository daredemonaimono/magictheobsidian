import { getLang, pick, t, tAny } from "../i18n";
import { ACTIONS, CONDITIONS, Def, ParamDef } from "./actions";
import { KINDS, kindOf } from "./kinds";

// ノード = Nodes/<名前>.md。内部は id、書き出しは、設定の言語のラベル (読むときは、どちらの言語でも読める)。形 (日本語):
//   ---\n mtg: node\n lang: ja\n 種類: 誘発型\n タイミング: 攻撃したとき\n ---
//   # 名前
//   条件: <条件>: キー=値, キー=値     (任意。引数が無ければ、": ..." は付けない)
//   ## 手順
//   - <動作>: キー=値, キー=値         または   - [[別のノード]]
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

const choiceLabel = (p: ParamDef, v: string) => { const c = p.choices?.find((x) => x.id === v); return c ? pick(c.label) : v; };
function fmtCall(c: Call, defs: Def[]): string {
  const d = defs.find((x) => x.id === c.id);
  const args = Object.entries(c.args).map(([k, v]) => { const p = d?.params.find((x) => x.id === k); return `${p ? pick(p.label) : k}=${p ? choiceLabel(p, v) : v}`; });
  return (d ? pick(d.label) : c.id) + (args.length ? `: ${args.join(", ")}` : "");
}

export function toMd(n: NodeData): string {
  const k = kindOf(n.kind);
  const tm = k?.timings.find((x) => x.id === n.timing);
  const out = ["---", "mtg: node", `lang: ${getLang()}`, `${t("mdKind")}: ${k ? pick(k.label) : n.kind}`, `${t("mdTiming")}: ${tm ? pick(tm.label) : n.timing}`, "---", `# ${n.name}`, ""];
  if (n.condition) out.push(`${t("mdCondition")}: ${fmtCall(n.condition, CONDITIONS)}`, "");
  out.push(`## ${t("mdSteps")}`, ...n.steps.map((s) => (s.node ? `- [[${s.id}]]` : `- ${fmtCall(s, ACTIONS)}`)), "");
  return out.join("\n");
}

const is = (x: { id: string; label: { ja: string; en: string } }, v: string) => x.id === v || x.label.ja === v || x.label.en === v;

function parseCall(text: string, defs: Def[]): Call {
  const i = text.indexOf(": ");
  const name = (i < 0 ? text : text.slice(0, i)).trim();
  const def = defs.find((d) => is(d, name));
  const args: Record<string, string> = {};
  if (i >= 0) {
    for (const pair of text.slice(i + 2).split(/,\s*(?=[^,=]+=)/)) {
      const e = pair.indexOf("=");
      if (e < 0) continue;
      const key = pair.slice(0, e).trim();
      const val = pair.slice(e + 1).trim();
      const p = def?.params.find((x) => is(x, key));
      args[p?.id ?? key] = p?.type === "choice" ? p.choices!.find((c) => is(c, val))?.id ?? val : val;
    }
  }
  return { id: def?.id ?? name, args };
}

export function parseMd(md: string): NodeData {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!fm) throw new Error(t("mdErrFront"));
  const meta = (keys: string[]) => keys.map((k) => new RegExp(`^${k}: *(.*)$`, "m").exec(fm[1])?.[1].trim()).find((v) => v !== undefined) ?? "";
  if (meta(["mtg"]) !== "node") throw new Error(t("mdErrType"));
  const body = md.slice(fm[0].length);
  const name = /^# (.+)$/m.exec(body)?.[1].trim();
  if (!name) throw new Error(t("mdErrTitle"));
  const kindText = meta(tAny("mdKind"));
  const kind = KINDS.find((k) => is(k, kindText));
  const timingText = meta(tAny("mdTiming"));
  const timing = kind?.timings.find((x) => is(x, timingText));
  const cond = new RegExp(`^(?:${tAny("mdCondition").join("|")}): *(.+)$`, "m").exec(body)?.[1];
  const sec = new RegExp(`^## (?:${tAny("mdSteps").join("|")})\\n([\\s\\S]*)$`, "m").exec(body)?.[1] ?? "";
  const steps: Step[] = [];
  for (const line of sec.split("\n")) {
    const m = /^- (.+)$/.exec(line);
    if (!m) continue;
    const ref = /^\[\[(.+)\]\]$/.exec(m[1].trim());
    steps.push(ref ? { node: true, id: ref[1] } : { node: false, ...parseCall(m[1], ACTIONS) });
  }
  return { name, kind: kind?.id ?? kindText, timing: timing?.id ?? timingText, ...(cond ? { condition: parseCall(cond, CONDITIONS) } : {}), steps };
}

export const defaults = (d: Def): Record<string, string> => Object.fromEntries(d.params.map((p) => [p.id, p.default]));
