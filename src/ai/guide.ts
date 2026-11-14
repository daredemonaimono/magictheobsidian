import { ACTIONS, CONDITIONS } from "../node/actions";
import { abilityBlock } from "../node/card";
import { CARD_TYPES } from "../node/cardtypes";
import { KINDS } from "../node/kinds";
import { Callable, ParamDef } from "../node/params";
import { KEYWORDS, TARGETS } from "../node/slots";
import { EXAMPLES } from "./examples";

// AI への手引き (docs/ai-guide.md) の、定義から作る部分。手書きの部分 (組み方・ルール・URL) は、md に書く。
// md の中の <!-- BEGIN:名前 --> と <!-- END:名前 --> の間を、ここで作った文章に差し替える (npm run guide)。
const both = (l: { ja: string; en: string }) => `${l.ja} / ${l.en}`;
const param = (p: ParamDef): string => {
  const kind = p.type === "choice" ? `選択: ${p.choices!.map((c) => `\`${c.id}\` (${c.label.ja})`).join(", ")}` : p.type === "multi" ? `複数選択 (id を \`|\` でつなぐ): ${p.choices!.map((c) => `\`${c.id}\``).join(", ")}` : p.type === "number" ? "整数" : p.filter === "token" ? "登録済みのトークンのカード名" : "登録済みのカード名";
  return `\`${p.id}\` (${p.label.ja}: ${kind}${p.default ? `。初期値 \`${p.default}\`` : ""})`;
};
const callable = (c: Callable & { cr: string; help?: { ja: string; en: string } }): string => {
  const head = `- \`${c.fn ?? c.id}(${c.params.map((p) => `${p.id}=…`).join(", ")})\` — id \`${c.id}\`、${c.label.ja} (CR ${c.cr})`;
  const lines = [head];
  if (c.help) lines.push(`  - 説明: ${c.help.ja}`);
  if (c.only) lines.push(`  - 使える種類: ${c.only.map((k) => `\`${k}\``).join(", ")}`);
  for (const p of c.params) lines.push(`  - 引数 ${param(p)}`);
  return lines.join("\n");
};

export const reference = (): string => [
  "### 能力の種類 (`kind`) とタイミング (`timing`)",
  "",
  ...KINDS.flatMap((k) => [`- \`${k.id}\` — ${both(k.label)} (CR ${k.cr})。初期のタイミング \`${k.defaultTiming}\``, ...k.timings.map((t) => `  - timing \`${t.id}\` — ${both(t.label)} (CR ${t.cr})`)]),
  "",
  "### 動作 (`steps` に書く関数)",
  "",
  ...ACTIONS.map((a) => callable(a)),
  "",
  "### 条件 (`condition` に書く関数)",
  "",
  ...CONDITIONS.map((c) => callable(c)),
  "",
  "### 対象 (`target`)",
  "",
  ...TARGETS.map((x) => (x.params.length ? callable({ ...x, help: undefined }) : `- \`${x.id}\` — ${both(x.label)} (CR ${x.cr})`)),
  "",
  "### キーワード (`keyword`。キーワード能力の種類 `keyword` で使う)",
  "",
  ...KEYWORDS.map((k) => `- \`${k.id}\` — ${both(k.label)} (CR ${k.cr})${k.steps ? `。定義済み: steps に ${k.steps.map((s) => `\`${s.id}\``).join(", ")} を入れる` : "。手順の定義は、まだ無い (steps は空でよい)"}`),
  "",
  "### カードタイプ (カードの `type`。唱えられるタイミングは、カードタイプが決める)",
  "",
  ...CARD_TYPES.map((c) => `- \`${c.id}\` — ${both(c.label)} (CR ${c.cr})。唱えるタイミング: ${c.castTiming === "anytime" ? "優先権があれば、いつでも" : "自分のメイン・フェイズで、スタックが空のとき"}`),
].join("\n");

export const examples = (): string =>
  EXAMPLES.flatMap((e) => [`#### ${e.card}`, "", "原文: " + (e.node.source ?? e.node.name).split("\n").join(" / "), "", abilityBlock(e.node, true), ""]).join("\n");

const sections: Record<string, () => string> = { reference, examples };

// md の BEGIN/END の間を、作った文章に差し替える
export function renderGuide(md: string): string {
  return Object.entries(sections).reduce((s, [name, make]) => {
    const re = new RegExp(`(<!-- BEGIN:${name} -->)[\\s\\S]*?(<!-- END:${name} -->)`);
    if (!re.test(s)) throw new Error(`手引きに <!-- BEGIN:${name} --> が無い`);
    return s.replace(re, (_, a, b) => `${a}\n${make()}\n${b}`);
  }, md);
}
