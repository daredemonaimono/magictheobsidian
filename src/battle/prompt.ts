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

数の条件: \`if=<場所>:<型>:<数>\` の形(場所は graveyard / hand / library / battlefield。自分のもの。型は型行に含まれる語で、すべてなら any。数の後ろの + は以上、- は以下、無印はちょうど)。
(例: 「あなたの墓地に講義が3枚以上あるなら」は \`if=graveyard:lesson:3+\`。否定は \`if=!graveyard:lesson:3+\`)

## モード・複数の対象・リスト
- 「以下から選ぶ」は、\`## 呪文能力\` の最初に \`modes count=<モードの数> min=<最少> max=<最多>\`(「1つ」は min=1 max=1、「1つまたは両方」は min=1 max=2)と書き、各モードのノード(\`target\` も)に \`if=mode1\`, \`if=mode2\` … を付ける。
- 「N体を対象とする」「最大N」は、\`target\` の \`min\` / \`max\`(既定は1)。対象や \`select\` / \`look\` / \`choose\` の出力は、複数の id のリストで、\`tap\` / \`bounce\` / \`move\` などはリスト全部に効く。
- 「すべての〜」は、対象を取らない \`select\`(絞り込みは \`target\` と同じ。攻撃中は \`attacking=true\`)。
- 「ライブラリーの上からN枚を見て、1枚を手札に、残りを底に」は、\`look\` → \`choose\` → \`move cards=$選んだ to=hand\` と \`move cards=$見た except=$選んだ to=bottom\`。

## 規則
- カード専用のノードは作らない。違いは、汎用ノードの引数で表す。
- ノードで表せない部分は、ノードを作らずに、末尾の \`## 未対応\` の下に、箇条書き1行ずつ、元のテキストのまま書く。
- 起動型能力(「コスト: 効果」の形)は \`## 起動型能力\` の最初のノードに \`cost\` を書く(例: 「{T}: マナを加える」は \`- cost tap=true\` と \`- addMana amount=1\`。「{1}{U}, 生け贄に捧げる: …」は \`- cost mana=2 sacrifice=true\`)。
- 誘発型能力(「〜したとき」「〜するたび」)は \`## 誘発型能力\` の最初のノードに \`when\` を書き、その後ろに効果のノードを書く(例: 「対戦相手のターン中に、あなたが呪文を唱えるたび、このクリーチャーの上に +1/+1 カウンターを1個置く」は \`- when event=cast who=you turn=opponents\` / \`- self as=s\` / \`- addCounter target=$s kind=+1/+1 count=1\`。「戦場に出たとき」は \`when event=enters self=true\`、「戦場を離れたとき」は \`when event=leaves self=true\`。「このパーマネント」は \`self\` ノードを as= で受けて target に渡す。「果敢」のようなキーワード能力は、その中身を誘発型能力で書く)。誘発型能力は、誘発したときに対象を選べない。
- 瞬速などのキーワード能力は、\`## 常在型能力\` に \`- keyword name=flash\` と書く(瞬速は、インスタントのタイミングで唱えられる)。ほかのキーワードは、戦場に出たときに得る。
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
