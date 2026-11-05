import { ParamDef } from "./node";
import { allConditions, allNodes } from "./registry";

// ノードの一覧 (docs/nodes.md) を、レジストリ (NodeDef) から作る。手で書かない: ノードを足すと、npm run docs:nodes で、この一覧が更新される (テストが、更新し忘れを見つける)
const param = (name: string, p: ParamDef) => `\`${name}\`(${p.type}${p.required ? "・必須" : ""}${p.choices ? `・${p.choices.join(" / ")}` : ""})`;

export function nodeDocs(): string {
  const nodes = allNodes();
  const cats = [...new Set(nodes.map((n) => n.category))];
  const out = [
    "# ノードの一覧",
    "",
    "> このファイルは、自動で作られます (`src/battle/nodeDocs.ts`)。直接は書き換えません。ノードを足したら、`npm run docs:nodes` で更新します。ノードは、`src/battle/nodes/` の、カテゴリーごとのファイルにあります。",
    "",
    `全 ${nodes.length} 個のノード、${allConditions().length} 個の条件。`,
    "",
    "目次: " + cats.map((c) => `[${c}](#${c})`).join(" / "),
  ];
  for (const cat of cats) {
    const ns = nodes.filter((n) => n.category === cat);
    out.push("", `## ${cat} (${ns.length} 個)`);
    for (const n of ns) {
      out.push("", `### \`${n.id}\` ${n.title}`, "", n.summary);
      const ps = Object.entries(n.params).map(([k, p]) => param(k, p));
      out.push("", `- 引数: ${ps.join("、") || "なし"}`);
      if (Object.keys(n.outputs).length) out.push(`- 出力: ${Object.entries(n.outputs).map(([k, t]) => `\`${k}\`(${t})`).join("、")} (\`as=名前\` で受けて、\`$名前\` で渡す)`);
      if (n.only) out.push(`- 書ける能力: ${n.only.join(" / ")}`);
      if (n.declaration) out.push("- 宣言のノード (エンジンが読む。`if=` は付けられない)");
      if (n.core) out.push("- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)");
    }
  }
  out.push("", "## 条件 (`if=`)", "");
  for (const c of allConditions()) out.push(`- \`${c.id}\` ${c.title}: ${c.summary}`);
  out.push("", "数の条件 `graveyard:lesson:3+` (場所:型:数。`+` 以上 / `-` 以下)、`$名前` (前のノードの出力が、0・偽・空でないとき)。否定は `!` を前に付ける。", "");
  return out.join("\n");
}
