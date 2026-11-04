import { ParamDef } from "./node";
import { allConditions, allNodes } from "./registry";
import { SAMPLE_RULES } from "./samples";

// AI への指示文。使えるノードの一覧は、レジストリ (NodeDef) から作る。ノードを足せば、指示文にも出る
const param = (name: string, p: ParamDef) => `${name}(${p.type}${p.required ? "・必須" : ""}${p.choices ? `・選べる値: ${p.choices.join(" / ")}` : ""})`;

const nodeList = () =>
  allNodes()
    .map((n) => `- ${n.id} (${n.title}): ${n.summary}\n  引数: ${Object.entries(n.params).map(([k, p]) => param(k, p)).join(", ") || "なし"}${Object.keys(n.outputs).length ? `\n  as= を付けると、出力 ${Object.keys(n.outputs).join(", ")} を $名前 で後のノードの ref 引数に渡せる` : ""}`)
    .join("\n");

const conditionList = () => allConditions().map((c) => `- ${c.id} (${c.title}): ${c.summary}`).join("\n");

export function buildPrompt(card: string, oracle: string, ruling?: string): { system: string; user: string } {
  const system = `あなたは Magic: The Gathering のカードのテキストを、汎用のノードの組み合わせ (Obsidian のノート) に直す役です。

## 書式
- フロントマターに card: "[[カード名]]" を書く。
- 見出しは能力の4分類: ## 呪文能力 / ## 起動型能力 / ## 誘発型能力 / ## 常在型能力。1つの見出し = 1つの能力。同じ見出しを何度書いてもよい。
- 箇条書き1行 = ノード1つ: \`- <ノードid> [as=<名前>] <引数>=<値> ...\`。値は $名前 (前のノードの as を参照)、整数、true / false、それ以外は文字列 (空白を含むときは "..." で囲む)。

## 使えるノード (これだけ。ここに無いノードは使わない)
${nodeList() || "(まだ無い)"}

## 条件 (ノードの if=)
ノードに \`if=<条件>\` を付けると、その条件のときだけ実行される。\`if=!<条件>\` は否定。「〜なら」「代わりに」は、条件と否定のノードを並べて表す
(例: \`- counter target=$t unlessPay=4 if=teamwork\` と \`- counter target=$t unlessPay=2 if=!teamwork\`)。
${conditionList() || "(まだ無い)"}

## 規則
- カード専用のノードは作らない。違いは、汎用ノードの引数で表す。
- ノードで表せない部分は、ノードを作らずに、末尾の \`## 未対応\` の下に、箇条書き1行ずつ、元のテキストのまま書く。
- 起動型能力(「コスト: 効果」の形)は \`## 起動型能力\` の最初のノードに \`cost\` を書く(例: 「{T}: マナを加える」は \`- cost tap=true\` と \`- addMana amount=1\`。「{1}{U}, 生け贄に捧げる: …」は \`- cost mana=2 sacrifice=true\`)。
- キッカー・チームワークなど、呪文を唱えるときに払ってもよい追加コストは、\`## 呪文能力\` の最初に \`additionalCost flag=kicked mana=2\` / \`additionalCost flag=teamwork tapCreatures=2\` と書く。払ったときだけ実行するノードには \`if=kicked\` / \`if=teamwork\` を付ける。
- 「裁定後のテキスト」が付いているときは、それを正しいテキストとして組む(カードのテキストが古いか、裁定で変わったため)。
- 返事は md 1つだけを \`\`\`md の囲みで返す。説明は書かない。

## 例
\`\`\`md
${SAMPLE_RULES["Negate"]}\`\`\``;
  const r = ruling?.trim();
  const user = r ? `カード名: ${card}\n\n現在のカードのテキスト:\n${oracle}\n\n裁定後のテキスト(こちらが正しい。これに合わせてノードを組む):\n${r}` : `カード名: ${card}\n\nオラクルテキスト:\n${oracle}`;
  return { system, user };
}
