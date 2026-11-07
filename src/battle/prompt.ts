import { aiParse } from "./ai";
import { ParamDef } from "./node";
import { withShared } from "./agentRules";
import { DEFAULT_GLOSSARY } from "./glossary";
import { allConditions, allNodes } from "./registry";
import { SAMPLE_RULES } from "./samples";

// AI への指示文。使えるノードの一覧は、レジストリ (NodeDef) から作る。ノードを足せば、指示文にも出る
const param = (name: string, p: ParamDef) => `${name}(${p.type}${p.required ? "・必須" : ""}${p.choices ? `・選べる値: ${p.choices.join(" / ")}` : ""})`;

const nodeList = (only?: ReadonlySet<string>) =>
  allNodes()
    .filter((n) => !only || n.core || only.has(n.id))
    .map((n) => `- ${n.id} (${n.title}): ${n.summary}\n  引数: ${Object.entries(n.params).map(([k, p]) => param(k, p)).join(", ") || "なし"}${Object.keys(n.outputs).length ? `\n  as= を付けると、出力 ${Object.keys(n.outputs).join(", ")} を $名前 で後のノードの ref 引数に渡せる` : ""}`)
    .join("\n");

const conditionList = () => allConditions().map((c) => `- ${c.id} (${c.title}): ${c.summary}`).join("\n");

// only = カードごとに選んだノードの id (あれば、中心のノード (core) + これだけを、指示に入れる。無ければ、全部)
export function buildPrompt(card: string, oracle: string, ruling?: string, glossary?: string, only?: ReadonlySet<string>, shared?: string): { system: string; user: string } {
  const base = `あなたは Magic: The Gathering のカードのテキストを、汎用のノードの組み合わせ (Obsidian のノート) に直す役です。

## 書式
- フロントマターに card: "[[カード名]]" を書く。
- 見出しは能力の5分類: ## 呪文能力 / ## 起動型能力 / ## 誘発型能力 / ## 常在型能力 / ## 準備呪文(準備呪文を持つクリーチャーだけ)。1つの見出し = 1つの能力。同じ見出しを何度書いてもよい。
- 箇条書き1行 = ノード1つ: \`- <ノードid> [as=<名前>] <引数>=<値> ...\`。値は $名前 (前のノードの as を参照)、整数、true / false、それ以外は文字列 (空白を含むときは "..." で囲む)。

## Glossary (basic definitions; follow these when unsure)
${glossary?.trim() || DEFAULT_GLOSSARY}

## 使えるノード (これだけ。ここに無いノードは使わない)
${nodeList(only) || "(まだ無い)"}${only ? "\n(カードの効果に関係しそうなノードだけを、選んである。必要なノードが、ここに無いときは、無理に近いノードを使わず、`## 未対応` に書く)" : ""}

## 「A または B」の誘発
\`when\` は、1 つの誘発の条件を 1 つだけ表す。「A または B のとき」の誘発 (例: 「墓地から戦場に出た、または、墓地から唱えた」) は、同じ効果の誘発型能力を、条件ごとに 2 つ書く (\`when event=enters from=graveyard\` と \`when event=enters castFrom=graveyard\`)。両方に当てはまることが無い条件なら、二重には誘発しない。書けない部分だけを、\`## 未対応\` に残すのではなく、この形で、書き切る。

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
- 「対戦相手の手札を見て、(クリーチャーでも土地でもない)1枚を選んで、捨てさせる」は、\`lookHand player=opponents as=h\` → \`filter from=$h notType=creature|land as=f\` → \`choose from=$f count=1 as=c\` → \`move cards=$c to=graveyard\`。手札を公開させるだけなら、\`lookHand\` だけ。
- フェッチランドは、\`cost tap=true sacrifice=true life=1\` → \`search type=Forest|Island to=battlefield\`(探して、戦場に出して、切る。タップ状態で出すなら \`tapped=true\`。手札に加えるなら \`to=hand\`)。「土地を破壊する」(Wasteland・Strip Mine)は、\`cost tap=true sacrifice=true\` → \`target as=t zone=battlefield kind=permanent type=land notType=basic\`(基本でない土地) → \`destroy target=$t\`。\n- 「手札から N 枚を選んで、ライブラリーの上に好きな順で置く」(Brainstorm) は、自分の手札を \`lookHand player=you as=h\` で渡して、\`choose from=$h count=N as=c\` → \`move cards=$c to=top\`。「上の N 枚を見て、好きな順で戻す。切ってもよい」(Ponder) は、\`look player=you count=N as=l\` → \`move cards=$l to=top\` → \`shuffle player=you optional=true\`(「切ってもよい」は optional=true)。\n- 「ライブラリーの上からN枚を見て、1枚を手札に、残りを底に」は、\`look\` → \`choose\` → \`move cards=$選んだ to=hand\` と \`move cards=$見た except=$選んだ to=bottom\`。

## 規則
- カード専用のノードは作らない。違いは、汎用ノードの引数で表す。
- ノードで表せない部分は、ノードを作らずに、末尾の \`## 未対応\` の下に、箇条書き1行ずつ、元のテキストのまま書く。
- 起動型能力(「コスト: 効果」の形)は \`## 起動型能力\` の最初のノードに \`cost\` を書く(例: 「{T}: {U} を加える」は \`- cost tap=true\` と \`- addMana amount=1 color=U\`。「{1}{U}, 生け贄に捧げる: …」は \`- cost manaCost="{1}{U}" sacrifice=true\`。色のないコスト {N} は \`mana=N\` でもよい)。
- 誘発型能力(「〜したとき」「〜するたび」)は \`## 誘発型能力\` の最初のノードに \`when\` を書き、その後ろに効果のノードを書く(例: 「対戦相手のターン中に、あなたが呪文を唱えるたび、このクリーチャーの上に +1/+1 カウンターを1個置く」は \`- when event=cast who=you turn=opponents\` / \`- self as=s\` / \`- addCounter target=$s kind=+1/+1 count=1\`。「戦場に出たとき」は \`when event=enters self=true\`、「戦場を離れたとき」は \`when event=leaves self=true\`。「このパーマネント」は \`self\` ノードを as= で受けて target に渡す。果敢(prowess)は誘発型能力で書かず、常在型能力に \`keyword name=prowess\` と書く。エンジンが誘発させる)。誘発型能力の対象は、誘発したときに自動で選ばれる(合法な対象が無ければ、能力は使われない)。
- 継続効果(「装備しているクリーチャーは +1/+2」「エンチャントしているクリーチャーは〜になる」「あなたのクリーチャーは〜」)は、\`## 常在型能力\` の最初のノードに \`affect who=attached\`(付いているもの。装備・オーラ。ほかに self / yours / all と、type・notType の絞り込み)を書き、その後ろに効果のノードを並べる。効果のノード: \`staticModify power= toughness=\`(+X/+Y)、\`staticGrant keyword=\`(キーワードを与える。果敢は prowess)、\`loseAbilities\`(すべての能力を失う)、\`setBaseStats power= toughness=\`(基本のパワー・タフネス)、\`setTypes types="Creature — Citizen"\`、\`setColors colors="G W"\`、\`setName name=\`、\`extraTriggers amount=1\`(誘発の追加)。
- 装備: 「装備 {N}」は \`## 起動型能力\` に \`timing sorcery=true\`、\`cost mana=N\`、\`target ...\`(例: type=creature controller=you)、\`attach target=$t\` と書く。「戦場に出たとき、〜に付ける」は誘発型能力の \`target\` と \`attach\`。
- オーラ(Aura): \`## 呪文能力\` に \`target ...\`(Enchant の対象)と \`attach target=$t\`、効果は \`## 常在型能力\` の \`affect who=attached\` と効果のノード。
- 「他のプレイヤーのアンタップ・ステップに、これをアンタップする」は、\`## 常在型能力\` に \`untapDuring who=opponents\`(affect は要らない)。
- 「攻撃するたび」「ブロックしたとき」は、\`## 誘発型能力\` の \`when event=attacks self=true\` / \`when event=blocks self=true\`(who=you・opponents、type・notType で絞れる)。戦闘そのもの (攻撃・ブロック・戦闘ダメージ・先制攻撃・二段攻撃・接死・絆魂・トランプル・飛行・到達・威嚇・警戒・防衛・速攻) は、エンジンが処理するので、ノードは書かない (キーワードは \`keyword name=…\`)。
- 準備呪文(prepare)を持つクリーチャー(カード名が "A // B" で、表がクリーチャー、裏が Instant か Sorcery): 裏面の呪文は \`## 準備呪文\` に、最初のノード \`prepareSpell name=<裏面の名前> type=Instant|Sorcery manaCost="{U}"\` のあとに、呪文の効果のノードを書く。「準備済状態で戦場に出る」は \`## 常在型能力\` に \`entersPrepared\`。「準備済状態になる」は効果のノード \`prepare\`。「墓地のカードを N 枚追放してもよい。そうしたなら〜」は \`exile zone=graveyard count=N optional=true as=e\` のあと、次のノードに \`if=$e\`(「そうしたなら」)を付ける。
- 護法 {N}(Ward)は \`## 常在型能力\` に \`ward amount=N\`(affect は要らない。{N} は汎用のマナの数)。
- ライフ: \`gainLife player=you amount=N\` / \`loseLife player=opponents amount=N\`。ダメージ: \`target zone=any kind=any as=t\`(プレイヤー・クリーチャー・プレインズウォーカー) のあとに \`damage target=$t amount=N\`。クリーチャーだけ・プレイヤーだけなら、\`zone=battlefield kind=permanent type=creature\` や \`zone=player kind=player\` の target に \`damage\` を使う。
- コスト軽減(「〜の呪文のコストは {N} 少なくなる」)は、\`## 常在型能力\` に \`reduceCost amount=N who=you notType=creature\`(affect は要らない)。
- プレインズウォーカーの忠誠度能力(「+N:」「−N:」「−X:」)は、\`## 起動型能力\` に \`cost loyalty=N\`(+1 は loyalty=1、−2 は loyalty=-2。−X は \`cost loyaltyX=true\`)と書く(ソーサリーのタイミングで1ターンに1回は、エンジンが守る)。X は効果の中で \`count=$X\` のように参照する。数の引数には、\`countCards\`(枚数を数える。as= で受ける)の出力も \`count=$名前\` で渡せる。
- 諜報(Surveil N)は、\`look player=you count=N as=l\` → \`choose from=$l count=N atMost=true as=c\`(0〜N 枚を選ぶ)→ \`move cards=$c to=graveyard\`。「墓地に置いたら〜」は、\`filter from=$c notType=creature|land as=f\` のように絞って、続ける。型の指定の | は「または」(type=artifact|creature)で、notType=creature|land は「どちらでもない」。
- トークンを作る: \`createToken name=Illusion types="Creature — Illusion" power=1 toughness=1 colors=U\`。
- 紋章(emblem)を得る: \`createEmblem name=<名前>\`。紋章の能力は、同じカードのルールの中に、\`## 誘発型能力\` として \`emblem name=<同じ名前>\` と \`when …\` の順に書く。紋章の常在型能力 (static) は未対応なので、\`## 未対応\` に書く。
- 「ステップの開始時に」は \`when event=step step=draw who=opponents\`(who は、そのターンのプレイヤー)。
- マナの色: \`addMana color=W|U|B|R|G\`(その色)、無色は color を書かないか \`color=C\`、「好きな色1色」は \`color=any\`。コストの色は \`manaCost="{1}{U}"\` と書く(混成 {W/U} も書ける)。
- 「{G}、{W}、{U} のどれか1色」は \`addMana amount=1 colors=GWU\`。「単独で攻撃するたび」は \`when event=attacks who=you alone=true\` と、攻撃したクリーチャーを指す \`eventPerm as=c\`(「そのクリーチャーは +1/+1」は \`modify target=$c power=1 toughness=1 duration=endOfTurn\`)。
- 「マナコストを支払うかわりに、〜してもよい」(Force of Will など)は、\`## 呪文能力\` の最初に \`altCost exile=1 exileColor=U life=1\`(自分のターンでないときだけは \`notYourTurn=true\`。追放するカードのマナ総量が X なら \`exileX=true\`、相手が N 個以上呪文を唱えたときだけなら \`oppSpells=N\`)。Evoke (別のコストで唱えたら、出たとき生け贄) は、\`altCost\` と、出たときの誘発に \`if=alt\` の \`sacrifice\`。別のコストで唱えたときだけの効果は \`if=alt\`(召喚者の「出たら生け贄」は \`sacrifice target=$s if=alt\`)。打ち消した呪文を追放するなら \`counter target=$t exile=true\`。
- X の値は、効果の中で \`$X\` で読める (呪文の {X}・altCost exileX=true)。X を負にするには \`math a=$X op=mul b=-1 as=m\`。「対象のクリーチャーは −X/−X の修整を受ける」は、\`target\` → \`math\` → \`modify target=$t power=$m toughness=$m duration=endOfTurn\`。
- Delve は \`## 呪文能力\` の最初に \`delve\`、Storm は \`storm\`(どちらも引数なし)。ファイレクシア・マナ {U/P} と {X} は、カードのマナコストにそのまま書いてあれば、エンジンが扱うので、ノートには書かない。「払ったマナの色の数」は \`spentColors as=n\`、数の比較は \`compare a=$m b=$n op=le as=ok\` と \`if=$ok\`(収束)。スタックの呪文のコピーは \`copySpell target=$t count=1\`。
- 「〜できない」の常在型能力は、affect の無い常在型能力に書く: \`castLimit amount=1\`(1ターンに唱えられる呪文の数)、\`cantCast who=opponents notType=creature mvOverLands=true\`(唱えられない呪文)、\`cantActivate type=artifact\`(起動できない能力)、\`entersTapped who=opponents type=land notType=Basic\`(タップ状態で出る)、\`cantEnter from=graveyard|library type=creature\`(墓地・ライブラリーから戦場に出られない)。「アップキープの開始時に、{N} を支払わないかぎり、生け贄(破壊)」は \`upkeepTax type=artifact mana=2 else=sacrifice\`。「マナを使わずに唱えた呪文を打ち消す」は \`when event=cast who=opponents\` と \`eventPerm as=s\` と \`counter target=$s if=noManaSpent\`。
- 「追加のターンを得る」は \`extraTurn\`。「〜になる(型・色・パワー・タフネス・能力を失う)」は \`becomes target=$t types=\"Creature — Elk\" colors=G power=3 toughness=3 loseAbilities=true duration=forever\`。「コントロールを交換する」は \`exchangeControl a=$a b=$b\`(対象に「パワー N 以下」は \`maxPower=N\`)。「墓地のカードをライブラリーの一番下にランダムな順で」は \`zoneCards zone=graveyard player=target target=$p as=g\` と \`move cards=$g to=bottom random=true\`。「追加で引いてもよい。そうしたなら、このターンに引いたカードから選び、ライフを払うか一番上に置く」は \`draw count=2 optional=true as=n\`、\`drawnCards as=d if=$n\`、\`choose from=$d count=2 as=c if=$n\`、\`payOrMove cards=$c life=4 to=top if=$n\`。トークンの能力(Food など)は、トークンの名前のルールノート(\`Rules/Food.md\`)に書く。
- 「このマナは、〜を唱えるためにしか使えない」は \`addMana amount=1 spellNotType=creature\`(spellType はその型だけ)。
- 瞬速などのキーワード能力は、\`## 常在型能力\` に \`- keyword name=flash\` と書く(瞬速は、インスタントのタイミングで唱えられる)。ほかのキーワードは、戦場に出たときに得る。
- キッカー・チームワークなど、呪文を唱えるときに払ってもよい追加コストは、\`## 呪文能力\` の最初に \`additionalCost flag=kicked manaCost="{1}{U}"\`(色のないコストなら \`mana=2\`) / \`additionalCost flag=teamwork tapCreatures=2\` と書く。払ったときだけ実行するノードには \`if=kicked\` / \`if=teamwork\` を付ける。
- 「裁定後のテキスト」が付いているときは、それを正しいテキストとして組む(カードのテキストが古いか、裁定で変わったため)。
- 返事は md 1つだけを \`\`\`md の囲みで返す。説明は書かない。

## 例
\`\`\`md
${SAMPLE_RULES["Negate"]}\`\`\``;
  const r = ruling?.trim();
  const user = r ? `カード名: ${card}\n\n現在のカードのテキスト:\n${oracle}\n\n裁定後のテキスト(こちらが正しい。これに合わせてノードを組む):\n${r}` : `カード名: ${card}\n\nオラクルテキスト:\n${oracle}`;
  return { system: withShared(base, shared), user };
}

// ---- ノードを選ぶ (ルールを書かせる前の、1段目)。短い一覧 (id・名前・説明の最初の部分) から、カードの効果に要りそうなノードを選ばせる。中心のノード (core) は、いつも渡すので、一覧に出さない
const firstClause = (s: string, n = 46) => {
  const t = s.split(/[。]/)[0];
  return t.length > n ? t.slice(0, n) + "…" : t;
};
export const catalog = (): string =>
  allNodes()
    .filter((n) => !n.core)
    .map((n) => `- ${n.id}: ${n.title} — ${firstClause(n.summary)}${n.keys?.length ? ` (言い方: ${n.keys.slice(0, 4).join("・")})` : ""}`)
    .join("\n");

// 一覧は、ノードが登録されてから作る (読み込みの時点では、まだ空)
export const selectSystem = (shared?: string): string => withShared(`あなたは、Magic: The Gathering のカードの効果を、汎用のノードの組み合わせに直す前に、使いそうなノードを選ぶ助手です。
下の「ノードの一覧」から、このカードの効果を書くのに要りそうなノードの id を選んでください。迷うものは、含めます (足りないより、多いほうがよい)。一覧に無いと、必要な効果 (一覧のノードでは、書けなさそうなもの) は、missing に、短く書きます。
返事は、JSON のオブジェクト1つだけ: {"nodes": ["id", ...], "missing": ["書けなさそうな効果", ...]}

## ノードの一覧
${catalog()}`, shared);

export const selectPrompt = (card: string, oracle: string, ruling?: string): string => `カード: ${card}\n\nテキスト:\n${oracle}${ruling ? `\n\n裁定:\n${ruling}` : ""}`;

// 返事から、選ばれたノードの id (レジストリにあるものだけ) と、書けなさそうな効果を読む。JSON として読めなければ undefined (全ノードを渡す)
export function parseSelection(text: string): { ids: Set<string>; missing: string[] } | undefined {
  const v = aiParse(text);
  if (!v || !Array.isArray(v.nodes)) return undefined;
  const valid = new Set(allNodes().map((n) => n.id));
  return { ids: new Set((v.nodes as unknown[]).filter((x): x is string => typeof x === "string" && valid.has(x))), missing: Array.isArray(v.missing) ? (v.missing as unknown[]).filter((x): x is string => typeof x === "string") : [] };
}
