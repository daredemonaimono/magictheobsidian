# AI 向け手引き: ノードの組み方 (Magic the Obsidian)

この文書は、**AI に、MTG のカードの能力を、このプラグインの「ノード」に組ませる**ための説明書です。
プラグインは、この文書をそのまま、AI への指示 (システム・プロンプト) として送ります。人間が読んでもよい文書です。

## 0. 共通ルール (人間も AI も守る)

1. **総合ルール (CR) に沿って組む。** 種類・タイミング・動作・条件・対象・キーワードは、すべて CR の番号を持つ。番号を、**記憶で書かない**。わからないときは、§5 の URL で、条文を確認する。
2. **使えるのは、§4 の部品だけ。** 一覧に無い id・関数・引数は、書かない (検証で、保存できなくなる)。組めない部分があれば、無理に近い部品で代用せず、ブロックの外に「未対応: …」と書く。
3. **省かない。** 原文の行の、**コスト (コロンより前) も、効果も、条件も、すべて**、組むか、「未対応: …」と書く。黙って、一部を省かない (例: 「{T}, Sacrifice this artifact: Add three mana of any one color.」の、生け贄のコストと、マナを加える効果の、両方)。
4. **原文を変えない。** 組むのは、原文の 1 行 (または、指定された行) だけ。ほかの行は、組まない。
5. **カード専用の部品を作らない。** 使い回せる部品 (動作・条件・対象・キーワード) の組み合わせで書く。足りない部品は、「未対応」として知らせる (部品を足すのは、人間の仕事)。
6. **ノードを組み終えたら、`src/ai/examples.ts` に追記する** (§6 の例になる)。追記したら、`npm run guide` で、この文書を更新する。AI が組んだ結果も、人間が確認して、よければ、追記する。

## 1. 三層

- **動作** (コードで固定。少数): 「カードを引く」「修整を与える」など。§4 の関数。
- **ノード** (能力 1 つ): 種類・タイミング・条件・対象・手順 (動作の並び) を組んだもの。カードのノートの中の、コードブロック (```` ```mtg-node ````) に書く。
- **カード**: ノードの集まり。`Cards/<カード名>.md` (英語)。

## 2. ノードの書式

能力 1 つを、次の形のコードブロックで書く。**答えには、この形のブロックを 1 つだけ**入れる。

````
```mtg-node
kind: triggered
timing: attacks
condition: controlsPowerAtLeast(n=4)
target: self
steps:
  modifyPT(power=2, toughness=2, duration=until-eot)
```
````

| 行 | 意味 | 必須 |
|---|---|---|
| `kind:` | 能力の種類の id (§4) | 必須 |
| `timing:` | その種類のタイミングの id (§4) | 必須 |
| `loyalty:` | 忠誠度能力のコスト (`+1`・`0`・`-2`)。忠誠カウンターを、置く・取り除く (CR 606.4)。`timing: loyalty` のときだけ。逆に、`timing: loyalty` のときは、必須 | 条件つき |
| `cost:` | 起動型 (`kind: activated`) のコスト。コストの動作 (`tapSelf()`・`payMana(mana={2}{R})`・`payLife(amount=2)`・`exileFromHand(…)`) を、1 行に 1 つ、2 字下げで。**起動型には、`cost:` か `loyalty:` が要る** (CR 602.1) | 起動型は必須 |
| `also-target:` | **2 つ目以降の対象** (原文に `target A and target B` と、対象が複数あるとき)。対象を取るもの (`targetObject(…)`・`target-creature` など) だけを、1 行に 1 つ、2 字下げで。`target:` が、最初の対象、`also-target:` が、対象 2・対象 3 … | 任意 |
| `condition:` | 条件の関数 (§4) 1 つ。誘発型では、「〜なら」(誘発したときと、解決するときに確かめる: CR 603.4) | 任意 |
| `target:` | 対象の id。引数を持つ対象 (「各〜」) は、関数の形 (`eachObject(controller=you, type=planeswalker, color=red)`) | 任意 |
| `keyword:` | キーワード能力 (`kind: keyword`) のとき、キーワードの id | 任意 |
| `steps:` | 動作の関数を、1 行に 1 つ、2 字下げで。上から順に行う | 必須 (キーワードだけの能力は、空でもよい) |

- 種類・タイミング・対象・キーワードは、**id** で書く (ラベルでも読めるが、id を使う)。引数の値も、id (`until-eot`、`flying` など)。
- `name:` と `source:` は、プラグインが付ける。**書かなくてよい。**
- 数は、整数。複数選べる引数 (キーワードなど) は、id を `|` でつなぐ (`flying|reach`)。複数選ぶと、それぞれが別々に扱われる (条件と効果の同じキーワードが対応する)。

## 3. 組み方の考え方

1. **種類を決める** (CR の定義に沿う)。
   - `When / Whenever / At the beginning of …` で始まる → 誘発型 `triggered` (CR 603)。誘発は、出来事のあとに起きる。
   - `[コスト]: [効果]` の形 → 起動型 `activated` (CR 602)。プレインズウォーカーの `+1:` `−2:` `0:` は、忠誠度能力 (CR 606)。
   - インスタント・ソーサリーの本文 → 呪文能力 `spell` (CR 113.3a)。
   - 「〜する間」「〜は…を持つ」など、常に働く記述 → 常在型 `static` (CR 604)。
   - キーワードだけの行 → キーワード能力 `keyword` (CR 702)。
2. **タイミングを決める。** 誘発型は、出来事 (攻撃したとき、戦場に出たとき…)。常在型は、`always` が基本。ただし、次の 2 つの書き方に注意する。
   - **「〜するなら、代わりに」は、置換効果** (CR 614.1)。誘発ではなく、**常在型**。置き換える出来事を、タイミングにする (例: `replace-draw`)。手順 = 代わりに起きること。置換は、出来事の前に働く。誘発にすると、無限に繰り返してしまう。
   - **「〜の代わりに、…を支払ってもよい」は、代替コスト** (CR 118.9)。常在型 + `timing: alternative-cost`。**手順 = 支払うコスト** (`payLife`・`exileFromHand`)。
3. **対象を決める。** 原文に、`target` が複数あるとき (例: `target artifact or creature you control and target creature an opponent controls`)、最初が `target:`、2 つ目以降が `also-target:` (CR 115.3)。「パワーが 3 以下」は `power-max=3`。コントロールの交換 `exchangeControl()` は、対象 1 と 対象 2 を使う (CR 701.12)。 対象を取るのは、原文に **「target」と書かれているときだけ** (CR 115.1): `targetObject(controller=…, zone=…, type=…, color=…, mana-value-max=…)` で、領域・タイプ・色・マナ総量 (mana value) を絞る (「墓地の、マナ総量 3 以下の、インスタントかソーサリーのカード 1 枚」= `zone=graveyard, type=instant|sorcery, mana-value-max=3`)。「each」「all」「you control」など、条件に合うものすべてに効くときは、対象を取らない: `eachObject(…)` (同じ絞り込みの引数)。「this creature」「this artifact」「~」(カード名) など、**自分自身は `self`** (クリーチャーとは限らない)。生成したトークンを指す「them」は `created-tokens`。
4. **条件**は、原文の `if …` / `as long as …` に当たる 1 つだけ。
5. **起動型のコスト**: 「[コスト]: [効果]」の、コロンの前が `cost:`、後ろが `steps:`。`{T}` は `tapSelf()` (CR 107.5)、マナは `payMana(mana={2}{R})`。マナを加えるだけの起動型 (対象を取らない) は、マナ能力 (CR 605): `steps` に `addMana(mana={C}{C}{C})`。
6. **「〜になる」(変身)**: 「すべての能力を失い、緑の 3/3 の大鹿・クリーチャーになる」のように、別のものになる効果は、`becomeToken(token=…, duration=…)` (CR 613.1)。何になるかは、**登録済みのトークンのカード名**で指す (渡された「登録済みのトークン」の一覧から選ぶ。タイプ・色・基本のパワー/タフネス・能力は、そのカードのもの)。期間の記述が無ければ `indefinite`。対象は、`targetObject(…)`。
7. **「支払ってもよい。そうしたなら、〜」** (CR 118.12): `mayPay(mana={4})` を、**区切り**として置く。これより後ろの手順は、支払ったときだけ行う。後ろが空ではいけない。
8. **手順**は、原文の順に、動作を並べる。
   - 1 つの能力の中で、対象は 1 つ。手順ごとに別の対象を指すことは、まだできない。
   - 「あとで行う」(次の終了ステップの開始時に…) は、遅延誘発 (CR 603.7)。動作 `delay(when=…)` を、**区切り**として置く。これより後ろの手順が、あとで行われる。後ろが空ではいけない。
   - トークンを作る動作は、登録済みのトークンのカード名を指す (`token=…`)。名前は、渡された「登録済みのトークン」の一覧から選ぶ。
9. **検証する。** 書いたら、§4 に照らして、id・引数・種類の制限 (`only`) が合っているか確かめる。合っていないと、保存できない。

### 答えの形

```
(短い説明は、ブロックの外に、1〜2 文まで)

```mtg-node
…
```

未対応: (組めなかった部分があれば。無ければ、この行は書かない)
```

## 4. 使える部品

プラグインのコード (`src/node/*`) の定義から作った一覧です。**CR の番号順**に並んでいます。更新は、`npm run guide`。

<!-- BEGIN:reference -->
### 能力の種類 (`kind`) とタイミング (`timing`)

- `spell` — 呪文能力 / Spell (CR 113.3a)。初期のタイミング `resolves`
  - timing `resolves` — 解決時 / On resolution (CR 608.2)
- `activated` — 起動型 / Activated (CR 602)。初期のタイミング `anytime`
  - timing `anytime` — いつでも (優先権があるとき) / Any time you have priority (CR 602.5d)
  - timing `sorcery-speed` — ソーサリー・タイミングのみ / Only as a sorcery (CR 602.5d)
  - timing `loyalty` — 忠誠度能力 (自分のメイン・フェイズ、スタックが空、1ターンに1回) / Loyalty ability (your main phase, empty stack, once per turn) (CR 606.3)
- `triggered` — 誘発型 / Triggered (CR 603)。初期のタイミング `enters`
  - timing `upkeep` — アップキープの開始時 / At the beginning of your upkeep (CR 503.1a)
  - timing `draw-step` — ドロー・ステップの開始時 / At the beginning of your draw step (CR 504.1)
  - timing `combat-begin` — 戦闘の開始時 / At the beginning of combat (CR 507.1)
  - timing `attacks` — 攻撃したとき / When it attacks (CR 508.1m)
  - timing `blocks` — ブロックしたとき / When it blocks (CR 509.1i)
  - timing `becomes-blocked` — ブロックされたとき / When it becomes blocked (CR 509.1i)
  - timing `combat-damage` — 戦闘ダメージを与えたとき / When it deals combat damage (CR 510.2)
  - timing `creature-combat-damage` — あなたのクリーチャーが、プレイヤーに戦闘ダメージを与えたとき / Whenever a creature you control deals combat damage to a player (CR 510.2)
  - timing `end-step` — 終了ステップの開始時 / At the beginning of the end step (CR 513.1a)
  - timing `cast-self` — このカードを唱えたとき (これ自身だけ) / When you cast this spell (CR 601.2i)
  - timing `cast` — 呪文を唱えたとき / When a spell is cast (CR 601.2i)
  - timing `graveyard-from-library` — ライブラリーから墓地に置かれたとき / When it is put into a graveyard from your library (CR 603.6)
  - timing `enters` — 戦場に出たとき / When it enters the battlefield (CR 603.6a)
  - timing `land-enters` — あなたのコントロールする土地が戦場に出たとき / Whenever a land you control enters (CR 603.6a)
  - timing `leaves` — 戦場を離れたとき / When it leaves the battlefield (CR 603.6c)
  - timing `dies` — 死亡したとき / When it dies (CR 603.6c)
  - timing `graveyard-from-anywhere` — どこからでも、墓地に置かれたとき (戦場を離れたとは、みなさない) / When it is put into a graveyard from anywhere (never a leaves-the-battlefield ability) (CR 603.6c)
- `static` — 常在型 / Static (CR 604)。初期のタイミング `always`
  - timing `alternative-cost` — 唱えるとき、マナ・コストの代わりに支払ってもよい / May be paid instead of the mana cost when casting (CR 118.9)
  - timing `always` — 戦場にいる間 / While on the battlefield (CR 604.1)
  - timing `replace-draw` — あなたがカードを1枚引くなら、代わりに / If you would draw a card, instead (CR 614.11)
- `keyword` — キーワード能力 / Keyword (CR 702)。初期のタイミング `always`
  - timing `upkeep` — アップキープの開始時 / At the beginning of your upkeep (CR 503.1a)
  - timing `draw-step` — ドロー・ステップの開始時 / At the beginning of your draw step (CR 504.1)
  - timing `combat-begin` — 戦闘の開始時 / At the beginning of combat (CR 507.1)
  - timing `attacks` — 攻撃したとき / When it attacks (CR 508.1m)
  - timing `blocks` — ブロックしたとき / When it blocks (CR 509.1i)
  - timing `becomes-blocked` — ブロックされたとき / When it becomes blocked (CR 509.1i)
  - timing `combat-damage` — 戦闘ダメージを与えたとき / When it deals combat damage (CR 510.2)
  - timing `creature-combat-damage` — あなたのクリーチャーが、プレイヤーに戦闘ダメージを与えたとき / Whenever a creature you control deals combat damage to a player (CR 510.2)
  - timing `end-step` — 終了ステップの開始時 / At the beginning of the end step (CR 513.1a)
  - timing `cast-self` — このカードを唱えたとき (これ自身だけ) / When you cast this spell (CR 601.2i)
  - timing `cast` — 呪文を唱えたとき / When a spell is cast (CR 601.2i)
  - timing `graveyard-from-library` — ライブラリーから墓地に置かれたとき / When it is put into a graveyard from your library (CR 603.6)
  - timing `enters` — 戦場に出たとき / When it enters the battlefield (CR 603.6a)
  - timing `land-enters` — あなたのコントロールする土地が戦場に出たとき / Whenever a land you control enters (CR 603.6a)
  - timing `leaves` — 戦場を離れたとき / When it leaves the battlefield (CR 603.6c)
  - timing `dies` — 死亡したとき / When it dies (CR 603.6c)
  - timing `graveyard-from-anywhere` — どこからでも、墓地に置かれたとき (戦場を離れたとは、みなさない) / When it is put into a graveyard from anywhere (never a leaves-the-battlefield ability) (CR 603.6c)
  - timing `always` — 戦場にいる間 / While on the battlefield (CR 702.1)

### 動作 (`steps` に書く関数)

- `loseGame()` — id `lose-game`、ゲームに敗北する (CR 104.3e)
  - 説明: プレイヤー (対象の欄) が、ゲームに敗北する
- `addMana(mana=…)` — id `add-mana`、マナを加える (CR 106.4)
  - 説明: マナを、マナ・プールに加える (マナ・シンボルの並び: {C}{C}{C} など)
  - 引数 `mana` (マナ: 登録済みのカード名。初期値 `{C}`)
- `addManaOfAnyOneColor(amount=…)` — id `add-mana-any-color`、好きな 1 色のマナを加える (CR 106.4)
  - 説明: 好きな 1 色を選んで、その色のマナを、指定の数だけ、加える (「any one color」。色を選ぶのは、解決のとき)
  - 引数 `amount` (数: 整数。初期値 `1`)
- `payMana(mana=…)` — id `pay-mana`、マナを支払う (CR 107.4)
  - 説明: マナ・コストを支払う (マナ・シンボルの並び: {2}{R} など)
  - 引数 `mana` (マナ: 登録済みのカード名。初期値 `{1}`)
- `tapSelf()` — id `tap-self`、このパーマネントをタップする ({T}) (CR 107.5)
  - 説明: コストの {T}: このパーマネントを、タップする (すでにタップ状態なら、払えない)
- `functionsFrom(zone=…)` — id `functions-from`、この能力が働く領域 (CR 113.6b)
  - 説明: この能力は、指定の領域でだけ働く (墓地から戻る能力・スタックで働く能力など。書かれていなければ、戦場。113.6k: 戦場から誘発できない誘発条件は、誘発できるすべての領域で働く)
  - 引数 `zone` (領域: 選択: `battlefield` (戦場), `stack` (スタック), `graveyard` (墓地), `hand` (手札), `library` (ライブラリー), `exile` (追放領域), `any` (すべての領域)。初期値 `graveyard`)
- `cantBeCountered()` — id `cant-be-countered`、打ち消されない (CR 113.6g)
  - 説明: このオブジェクトは、打ち消されない (スタックの上で働く能力。「できない」は、「できる」に優先する: 101.2)
  - 使える種類: `static`, `keyword`
- `createEmblem(emblem=…)` — id `create-emblem`、紋章を得る (CR 114.2)
  - 説明: 登録してある紋章のカード (Cards/。タイプ: 紋章) を指して、あなたが、その紋章を得る。紋章は、統率領域に置かれ、あなたが、持ち主でコントローラーになる (114.1・114.2)。紋章の能力は、紋章のカードに組む
  - 引数 `emblem` (紋章: 登録済みのカード名)
- `mayPay(mana=…, who=…)` — id `may-pay`、支払ってもよい。そうしたなら、ここから先の手順を行う (CR 118.12)
  - 説明: マナを支払ってもよい。支払ったなら、これより後ろの手順を、行う (支払わなければ、後ろは、行わない)
  - 引数 `mana` (マナ: 登録済みのカード名。初期値 `{1}`)
  - 引数 `who` (行う人: 選択: `you` (あなた), `target-player` (対象のプレイヤー), `controller-of-target` (対象のコントローラー (109.4)), `owner-of-target` (対象の持ち主 (108.3))。初期値 `you`)
- `mayDo(who=…)` — id `may-do`、してもよい。そうしたなら、ここから先の手順を行う (CR 118.12)
  - 説明: 次の手順は、行ってもよい。行ったなら、その後ろの手順を行う (行わなければ、後ろは行わない)。マナを支払う場合は、「支払ってもよい」。行う人の既定は、あなた
  - 引数 `who` (行う人: 選択: `you` (あなた), `target-player` (対象のプレイヤー), `controller-of-target` (対象のコントローラー (109.4)), `owner-of-target` (対象の持ち主 (108.3))。初期値 `you`)
- `gainLife(amount=…)` — id `gain-life`、ライフを得る (CR 119.3)
  - 説明: プレイヤー (既定: あなた) が、ライフを得る。ライフ総量が、その分だけ増える
  - 引数 `amount` (点数: 整数。初期値 `1`)
- `loseLife(amount=…)` — id `lose-life`、ライフを失う (CR 119.3)
  - 説明: プレイヤーが、ライフを失う (支払う = コストの「ライフを支払う」とは別)
  - 引数 `amount` (点数: 整数。初期値 `1`)
- `payLife(amount=…)` — id `pay-life`、ライフを支払う (CR 119.4)
  - 説明: ライフを支払う (コスト。ライフが、その点数以上のときだけ、支払える)
  - 引数 `amount` (点数: 整数。初期値 `1`)
- `dealDamage(amount=…)` — id `deal-damage`、ダメージを与える (CR 120.3)
  - 説明: ダメージを与える
  - 引数 `amount` (量: 整数。初期値 `1`)
- `draw(amount=…)` — id `draw`、カードを引く (CR 121.1)
  - 説明: ライブラリーの一番上から引く
  - 引数 `amount` (数: 整数。初期値 `1`)
- `addCounter(kind=…, amount=…)` — id `add-counter`、カウンターを置く (CR 122.1)
  - 説明: カウンター (残り続ける) を置く
  - 引数 `kind` (種類: 選択: `plus1` (+1/+1), `minus1` (-1/-1), `loyalty` (忠誠), `other` (その他)。初期値 `plus1`)
  - 引数 `amount` (数: 整数。初期値 `1`)
- `mayPlayLand(duration=…, from=…)` — id `may-play-land`、土地をプレイしてもよい (CR 305.1)
  - 説明: 対象の領域 (墓地など) の土地を、期間のあいだ、プレイしてもよい (許可を与える効果。土地のプレイは、特別な処理で、スタックを使わない。プレイできる回数などの他のルールは、そのまま)
  - 引数 `duration` (期間: 選択: `this-turn` (このターン)。初期値 `this-turn`)
  - 引数 `from` (どこから: 選択: `graveyard` (墓地), `hand` (手札), `library` (ライブラリーの一番上), `exile` (追放領域)。初期値 `graveyard`)
- `moveZone(to=…)` — id `move-zone`、領域を移す (CR 400.7)
  - 説明: 対象 (または、これ自身) を、別の領域へ移す。移ったものは、以前とは無関係の、新しいオブジェクトになる (400.7)。手札・追放は、持ち主の領域
  - 引数 `to` (移し先: 選択: `hand` (手札), `battlefield` (戦場), `graveyard` (墓地), `exile` (追放領域), `library-top` (ライブラリーの一番上), `library-bottom` (ライブラリーの一番下), `library-owner-choice` (ライブラリーの一番上か一番下 (持ち主が選ぶ))。初期値 `hand`)
- `extraTurn(count=…)` — id `extra-turn`、追加のターンを得る (CR 500.7)
  - 説明: このターンの直後に、追加のターンを、指定の数だけ加える (追加のターンは、1 つずつ加わる)
  - 引数 `count` (数: 整数。初期値 `1`)
- `doesNotUntap()` — id `does-not-untap`、アンタップ・ステップに、アンタップしない (CR 502.3)
  - 説明: アンタップ・ステップに、アンタップするパーマネントを決めるとき、これは、アンタップしない (常に働く)
  - 使える種類: `static`
- `mustAttack()` — id `must-attack`、毎戦闘、可能なら攻撃する (CR 508.1d)
  - 説明: 攻撃クリーチャーの指定のとき、攻撃しなければならない (可能なら)。「攻撃する要求」の 1 つ
  - 使える種類: `static`, `keyword`
- `blockRequirement(min-blockers=…)` — id `block-requirement`、ブロックの条件を課す (CR 509.1b)
  - 説明: このクリーチャーをブロックできる条件 (威迫: 2体以上)
  - 使える種類: `static`, `keyword`
  - 引数 `min-blockers` (最少のブロッカー数: 整数。初期値 `2`)
- `setMaxBlockers(max-blockers=…)` — id `max-blockers`、ブロックの上限を課す (CR 509.1b)
  - 説明: このクリーチャーをブロックできるクリーチャーの数の上限 (突進するサイ: 1体まで。「2体以上によってはブロックされない」)
  - 使える種類: `static`, `keyword`
  - 引数 `max-blockers` (最大のブロッカー数: 整数。初期値 `1`)
- `mayCast(duration=…)` — id `may-cast`、唱えてもよい (CR 601.3)
  - 説明: 対象 (いまある領域のカード) を、期間のあいだ、唱えてもよい (許可を与える効果。唱えるための他のルールは、そのまま)
  - 引数 `duration` (期間: 選択: `this-turn` (このターン)。初期値 `this-turn`)
- `delay(when=…)` — id `delayed-trigger`、ここから先の手順を、あとで行う (遅延誘発) (CR 603.7)
  - 説明: この手順より後ろの手順は、指定のタイミングに、1 回だけ行う (遅延誘発能力。解決中に作られ、次にそのタイミングが来たときだけ誘発する: 603.7a・603.7b)
  - 引数 `when` (タイミング: 選択: `upkeep` (次のアップキープの開始時), `combat-begin` (次の戦闘の開始時), `end-step` (次の終了ステップの開始時)。初期値 `end-step`)
- `onlyIf(condition=…, n=…)` — id `only-if`、ここから先は、条件が成り立つときだけ行う (CR 608.2c)
  - 説明: 手順の途中の条件 (「そのあと、〜なら」)。成り立たなければ、ここから先の手順は行わない。誘発型の「〜なら」(603.4) は、能力の条件の欄
  - 引数 `condition` (条件: 選択: `controls-power-at-least` (パワーがN以上のクリーチャーをコントロールしている), `graveyard-has-keyword-creature` (墓地に、そのキーワードを持つクリーチャー・カードがある), `is-tapped` (このパーマネントが、タップ状態である), `gained-life-at-least` (このターン、ライフを N 点以上得ている), `is-ring-bearer` (これが、あなたの指輪所持者である), `ring-tempted-at-least` (指輪が、このゲームで N 回以上、あなたを誘惑している), `my-turn` (自分のターン)。初期値 `controls-power-at-least`)
  - 引数 `n` (N (数のある条件のとき): 整数)
- `becomeToken(token=…, duration=…)` — id `become-token`、トークンのカードの特性になる (変身) (CR 613.1)
  - 説明: 対象は、登録してあるトークンのカード (Cards/) と同じ、タイプ・色・基本のパワーとタフネス・能力になる。元の能力は、すべて失う (層の規則で、重ねて決まる: 613.1d タイプ・613.1e 色・613.1f 能力・613.4b パワー/タフネスの設定)。例: 「すべての能力を失い、緑の 3/3 の大鹿・クリーチャーになる」
  - 引数 `token` (トークン: 登録済みのトークンのカード名)
  - 引数 `duration` (期間: 選択: `indefinite` (ずっと (期間の指定なし: ゲームの終わりまで)), `this-turn` (このターン)。初期値 `indefinite`)
- `grantKeyword(keyword=…)` — id `grant-keyword`、キーワード能力を与える (CR 613.1f)
  - 説明: 対象にキーワード能力を与える
  - 引数 `keyword` (キーワード: 複数選択 (id を `|` でつなぐ): `deathtouch`, `double-strike`, `first-strike`, `flying`, `haste`, `landwalk`, `lifelink`, `protection`, `reach`, `shroud`, `trample`, `vigilance`, `fear`, `changeling`, `annihilator`, `partner`, `tiered`。初期値 `flying`)
- `modifyPT(power=…, toughness=…, duration=…)` — id `modify-pt`、修整を与える (CR 613.4c)
  - 説明: パワー・タフネスを変える (カウンターではない。期間が終わると戻る)
  - 引数 `power` (パワー: 整数。初期値 `0`)
  - 引数 `toughness` (タフネス: 整数。初期値 `0`)
  - 引数 `duration` (期間: 選択: `until-eot` (ターン終了時まで), `while-applies` (このノードが適用される間)。初期値 `until-eot`)
- `exileInsteadOfGraveyard(duration=…)` — id `exile-instead-of-graveyard`、墓地に置かれるなら、代わりに追放する (CR 614.1a)
  - 説明: 対象が、期間のあいだ、墓地に置かれるなら、代わりに追放する (解決中に作られる置換効果。置き換えた出来事は、起こらない: 614.6)
  - 引数 `duration` (期間: 選択: `this-turn` (このターン)。初期値 `this-turn`)
- `counter()` — id `counter`、打ち消す (CR 701.6a)
  - 説明: 対象 (呪文・起動型能力・誘発型能力) を打ち消す。解決されず、呪文は持ち主の墓地に置かれる。何を打ち消すかは、対象の欄で選ぶ
- `createToken(count=…, token=…)` — id `create-token`、トークンを生成する (CR 701.7a)
  - 説明: 登録してあるトークンのカード (Cards/) を指して、その数だけ、戦場に出す。生成したプレイヤーが、コントローラーになる
  - 引数 `count` (数: 整数。初期値 `1`)
  - 引数 `token` (トークン: 登録済みのトークンのカード名)
- `destroy()` — id `destroy`、破壊する (CR 701.8a)
  - 説明: パーマネントを、戦場から、持ち主の墓地に置く。何を破壊するかは、対象の欄で選ぶ
- `exchangeControl()` — id `exchange-control`、コントロールを交換する (CR 701.12b)
  - 説明: 対象と、もう1つの対象の、コントロールを交換する (異なるプレイヤーがコントロールしていれば、互いに、相手のものを得る。交換を、すべて完了できなければ、何も起こらない: 701.12a・701.12b)。対象が 2 つ要る
- `exileFromHand(count=…, color=…)` — id `exile-from-hand`、手札のカードを追放する (CR 701.13)
  - 説明: 手札から、指定の色のカードを、指定の枚数、追放する (コスト)
  - 引数 `count` (枚数: 整数。初期値 `1`)
  - 引数 `color` (色: 選択: `any` (色を問わない), `white` (白), `blue` (青), `black` (黒), `red` (赤), `green` (緑)。初期値 `any`)
- `sacrifice()` — id `sacrifice`、生け贄に捧げる (CR 701.21a)
  - 説明: 戦場から、持ち主の墓地に置く。自分がコントロールする、戦場のパーマネントだけを、生け贄に捧げられる。何を捧げるかは、対象の欄で選ぶ
- `sacrificeCost(what=…, count=…)` — id `sacrifice-cost`、生け贄に捧げる (コスト) (CR 701.21a)
  - 説明: コストとして、自分がコントロールするパーマネントを、生け贄に捧げる (これ自身、または、指定のタイプのパーマネントを、枚数分)
  - 引数 `what` (何を: 選択: `self` (これ自身), `permanent` (パーマネント), `creature` (クリーチャー), `artifact` (アーティファクト), `enchantment` (エンチャント), `land` (土地)。初期値 `self`)
  - 引数 `count` (数 (これ自身のときは、不要): 整数)
- `sacrificeBy(who=…, count=…, what=…)` — id `sacrifice-by`、プレイヤーに、生け贄に捧げさせる (CR 701.21a)
  - 説明: 指定のプレイヤーが、自分のコントロールするパーマネントを、指定の数、生け贄に捧げる (何を捧げるかは、そのプレイヤーが選ぶ)
  - 引数 `who` (誰が: 選択: `you` (あなた), `defending-player` (防御プレイヤー), `target-player` (対象のプレイヤー), `controller-of-target` (対象のコントローラー (109.4)), `each-opponent` (各対戦相手), `each-player` (各プレイヤー)。初期値 `target-player`)
  - 引数 `count` (数: 整数。初期値 `1`)
  - 引数 `what` (何を: 選択: `permanent` (パーマネント), `creature` (クリーチャー), `artifact` (アーティファクト), `enchantment` (エンチャント), `land` (土地)。初期値 `permanent`)
- `shuffle(whose=…)` — id `shuffle`、ライブラリーを切り直す (CR 701.24a)
  - 説明: ライブラリーのカードを、順番が誰にも分からないよう、ランダムにする。「ライブラリーに加えて切り直す」は、領域を移す → 切り直す (701.24c)
  - 引数 `whose` (誰のライブラリー: 選択: `you` (あなた), `owner` (対象の持ち主)。初期値 `you`)
- `untap()` — id `untap`、アンタップする (CR 701.26b)
  - 説明: 対象をアンタップする (タップ状態のものだけ)
- `ringTempts()` — id `ring-tempts`、指輪があなたを誘惑する (CR 701.54a)
  - 説明: あなたのクリーチャー 1 体を、指輪所持者にする (「指輪」の紋章を、持っていなければ、得る: 701.54c)
- `protectionFrom(what=…, color=…)` — id `protection-from`、プロテクション (何からの) (CR 702.16a)
  - 説明: 指定のものからの、プロテクション: それによって、対象にならず、エンチャントされず、装備されず、ダメージを与えられず、ブロックされない (702.16b〜)。「1 色以上の呪文」= 何: 呪文 + 色: 1 色以上
  - 引数 `what` (何からの: 選択: `everything` (すべて), `spells` (呪文), `permanents` (パーマネント), `creatures` (クリーチャー)。初期値 `permanents`)
  - 引数 `color` (色: 選択: `any` (色を問わない), `white` (白), `blue` (青), `black` (黒), `red` (赤), `green` (緑), `colored` (1 色以上 (無色でない))。初期値 `any`)
- `setAllCreatureTypes()` — id `all-creature-types`、すべてのクリーチャー・タイプを持つ (CR 702.73a)
  - 説明: このオブジェクトは、すべてのクリーチャー・タイプである (特性を定義する能力。戦場以外の領域でも働く: 604.3)
  - 使える種類: `static`, `keyword`
- `partnerWith(name=…)` — id `partner-with`、パートナー (相手の名前) (CR 702.124a)
  - 説明: パートナー: 指定の名前のカードと、統率者にできる (ゲームの前に働く。構築のルール)
  - 使える種類: `static`, `keyword`
  - 引数 `name` (カード名: 登録済みのカード名)
- `copySpell(new-targets=…, who=…)` — id `copy-spell`、呪文をコピーする (CR 707.10)
  - 説明: 呪文 (または能力) のコピーを、スタックに置く (唱えたことには、ならない)。新しい対象を選んでもよい (707.10c)
  - 引数 `new-targets` (対象: 選択: `may-choose` (新しい対象を選んでもよい), `keep` (そのまま)。初期値 `may-choose`)
  - 引数 `who` (行う人: 選択: `you` (あなた), `target-player` (対象のプレイヤー), `controller-of-target` (対象のコントローラー (109.4)), `owner-of-target` (対象の持ち主 (108.3))。初期値 `you`)

### 条件 (`condition` に書く関数)

- `controlsPowerAtLeast(n=…)` — id `controls-power-at-least`、パワーがN以上のクリーチャーをコントロールしている (CR 109.4)
  - 説明: 自分のコントロールするクリーチャーに、パワーが N 以上のものがある
  - 引数 `n` (N: 整数。初期値 `4`)
- `isTapped()` — id `is-tapped`、このパーマネントが、タップ状態である (CR 110.5)
  - 説明: このパーマネントのステータスが、タップ状態である (誘発型では、「〜なら」: 誘発したときと、解決するときに、確かめる: 603.4)
- `gainedLifeAtLeast(n=…)` — id `gained-life-at-least`、このターン、ライフを N 点以上得ている (CR 119.3)
  - 説明: このターンに、あなたが得たライフの合計が N 以上 (ターンごとの記録が要る。誘発型では、「〜なら」: 603.4)
  - 引数 `n` (N: 整数。初期値 `3`)
- `graveyardHasCreatureWithKeyword(keyword=…)` — id `graveyard-has-keyword-creature`、墓地に、そのキーワードを持つクリーチャー・カードがある (CR 404.1)
  - 説明: いずれかの墓地に、そのキーワード能力を持つクリーチャー・カードがある。複数選ぶと、キーワードごとに別々に判定する (効果の同じキーワードに対応)
  - 引数 `keyword` (キーワード: 複数選択 (id を `|` でつなぐ): `deathtouch`, `double-strike`, `first-strike`, `flying`, `haste`, `landwalk`, `lifelink`, `protection`, `reach`, `shroud`, `trample`, `vigilance`, `fear`, `changeling`, `annihilator`, `partner`, `tiered`。初期値 `flying`)
- `isMyTurn()` — id `my-turn`、自分のターン (CR 500.1)
  - 説明: 自分のターンである
- `ringTemptedAtLeast(n=…)` — id `ring-tempted-at-least`、指輪が、このゲームで N 回以上、あなたを誘惑している (CR 701.54c)
  - 説明: このゲームで、指輪があなたを誘惑した回数が N 以上 (「指輪」の紋章の能力は、その回数で決まる)
  - 引数 `n` (N: 整数。初期値 `2`)
- `isRingBearer()` — id `is-ring-bearer`、これが、あなたの指輪所持者である (CR 701.54e)
  - 説明: このクリーチャーが、あなたのコントロール下で戦場にいて、指輪所持者の指定を持っている

### 対象 (`target`)

- `eachObject(controller=…, zone=…, type=…, color=…, mana-value-max=…, power-max=…)` — id `each`、条件に合う各オブジェクト (対象を取らない) (CR 109.2)
  - 引数 `controller` (プレイヤー: 選択: `you` (あなた), `opponent` (相手), `any` (問わない)。初期値 `you`)
  - 引数 `zone` (領域: 選択: `battlefield` (戦場), `graveyard` (墓地), `hand` (手札), `library` (ライブラリー), `exile` (追放領域), `stack` (スタック), `any` (どこでも (領域を問わない))。初期値 `battlefield`)
  - 引数 `type` (タイプ: 複数選択 (id を `|` でつなぐ): `permanent`, `card`, `creature`, `planeswalker`, `artifact`, `enchantment`, `land`, `instant`, `sorcery`, `battle`。初期値 `creature`)
  - 引数 `color` (色: 選択: `any` (色を問わない), `white` (白), `blue` (青), `black` (黒), `red` (赤), `green` (緑)。初期値 `any`)
  - 引数 `mana-value-max` (点数で見たマナ・コストの上限: 整数)
  - 引数 `power-max` (パワーの上限: 整数)
- `you` — あなた (このカードのコントローラー) / you (this object's controller) (CR 109.5)
- `targetObject(controller=…, zone=…, type=…, color=…, mana-value-max=…, power-max=…)` — id `target-object`、条件に合う、対象の 1 つ (対象を取る) (CR 115.1)
  - 引数 `controller` (プレイヤー: 選択: `you` (あなた), `opponent` (相手), `any` (問わない)。初期値 `any`)
  - 引数 `zone` (領域: 選択: `battlefield` (戦場), `graveyard` (墓地), `hand` (手札), `library` (ライブラリー), `exile` (追放領域), `stack` (スタック), `any` (どこでも (領域を問わない))。初期値 `battlefield`)
  - 引数 `type` (タイプ: 複数選択 (id を `|` でつなぐ): `permanent`, `card`, `creature`, `planeswalker`, `artifact`, `enchantment`, `land`, `instant`, `sorcery`, `battle`。初期値 `permanent`)
  - 引数 `color` (色: 選択: `any` (色を問わない), `white` (白), `blue` (青), `black` (黒), `red` (赤), `green` (緑)。初期値 `any`)
  - 引数 `mana-value-max` (点数で見たマナ・コストの上限: 整数)
  - 引数 `power-max` (パワーの上限: 整数)
- `target-creature` — 対象のクリーチャー / target creature (CR 115.1)
- `target-player` — 対象のプレイヤー / target player (CR 115.1)
- `target-spell` — 対象の呪文 / target spell (CR 115.1)
- `any-target` — 対象: 何でも (クリーチャー・プレイヤー・プレインズウォーカー・バトル) / any target (creature, player, planeswalker or battle) (CR 115.4)
- `self` — これ自身 / this object (CR 201.5)
- `created-tokens` — それら (この能力で生成したトークン) / them (the tokens this ability created) (CR 611.2c)

### キーワード (`keyword`。キーワード能力の種類 `keyword` で使う)

- `deathtouch` — 接死 / Deathtouch (CR 702.2)。手順の定義は、まだ無い (steps は空でよい)
- `double-strike` — 二段攻撃 / Double strike (CR 702.4)。手順の定義は、まだ無い (steps は空でよい)
- `first-strike` — 先制攻撃 / First strike (CR 702.7)。手順の定義は、まだ無い (steps は空でよい)
- `flying` — 飛行 / Flying (CR 702.9)。手順の定義は、まだ無い (steps は空でよい)
- `haste` — 速攻 / Haste (CR 702.10)。手順の定義は、まだ無い (steps は空でよい)
- `landwalk` — 土地渡り / Landwalk (CR 702.14)。手順の定義は、まだ無い (steps は空でよい)
- `lifelink` — 絆魂 / Lifelink (CR 702.15)。手順の定義は、まだ無い (steps は空でよい)
- `protection` — プロテクション / Protection (CR 702.16)。手順の定義は、まだ無い (steps は空でよい)
- `reach` — 到達 / Reach (CR 702.17)。手順の定義は、まだ無い (steps は空でよい)
- `shroud` — 被覆 / Shroud (CR 702.18)。手順の定義は、まだ無い (steps は空でよい)
- `trample` — トランプル / Trample (CR 702.19)。手順の定義は、まだ無い (steps は空でよい)
- `vigilance` — 警戒 / Vigilance (CR 702.20)。手順の定義は、まだ無い (steps は空でよい)
- `fear` — 畏怖 / Fear (CR 702.36)。手順の定義は、まだ無い (steps は空でよい)
- `changeling` — 多相 / Changeling (CR 702.73)。定義済み: steps に `all-creature-types` を入れる
- `annihilator` — 滅殺 / Annihilator (CR 702.86)。手順の定義は、まだ無い (steps は空でよい)
- `partner` — パートナー / Partner (CR 702.124)。手順の定義は、まだ無い (steps は空でよい)
- `tiered` — 段階 / Tiered (CR 702.183)。手順の定義は、まだ無い (steps は空でよい)

### カードタイプ (カードの `type`。唱えられるタイミングは、カードタイプが決める)

- `artifact` — アーティファクト / Artifact (CR 301.1)。唱えるタイミング: 自分のメイン・フェイズで、スタックが空のとき
- `creature` — クリーチャー / Creature (CR 302.1)。唱えるタイミング: 自分のメイン・フェイズで、スタックが空のとき
- `enchantment` — エンチャント / Enchantment (CR 303.1)。唱えるタイミング: 自分のメイン・フェイズで、スタックが空のとき
- `instant` — インスタント / Instant (CR 304.1)。唱えるタイミング: 優先権があれば、いつでも
- `planeswalker` — プレインズウォーカー / Planeswalker (CR 306.1)。唱えるタイミング: 自分のメイン・フェイズで、スタックが空のとき
- `sorcery` — ソーサリー / Sorcery (CR 307.1)。唱えるタイミング: 自分のメイン・フェイズで、スタックが空のとき
<!-- END:reference -->

## 5. 公式ルールの URL (わからないときは、ここで確認する)

- 総合ルール (公式。最新版の入り口): https://magic.wizards.com/en/rules
- 規則の番号から、条文を取る (JSON): `https://api.academyruins.com/cr/<番号>` (例: https://api.academyruins.com/cr/603.7)
- 総合ルールの解説 (MTG Wiki): https://mtg.wiki/page/Comprehensive_Rules
- 総合ルールの全文 (参考): https://yawgatog.com/resources/magic-rules/
- カードのデータ (原文・ルーリング): https://scryfall.com/docs/api

## 6. 例 (組み終えたノード)

**ノードを組んだら、ここに追記する** (`src/ai/examples.ts` に足して、`npm run guide`)。

<!-- BEGIN:examples -->
#### Changeling の例

原文: Changeling

```mtg-node
name: Changeling
source: Changeling
kind: keyword
timing: always
keyword: changeling
steps:
  setAllCreatureTypes()
```

#### Flying の例

原文: Flying

```mtg-node
name: Flying
source: Flying
kind: keyword
timing: always
keyword: flying
steps:
```

#### Menace の例

原文: Menace

```mtg-node
name: Menace
source: Menace
kind: keyword
timing: always
steps:
  blockRequirement(min-blockers=2)
```

#### Ferocious の例 (誘発型・条件つき)

原文: Whenever this creature attacks, if you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.

```mtg-node
name: Whenever this creature attacks, if you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.
source: Whenever this creature attacks, if you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.
kind: triggered
timing: attacks
condition: controlsPowerAtLeast(n=4)
target: self
steps:
  modifyPT(power=2, toughness=2, duration=until-eot)
```

#### Thought Reflection (置換効果)

原文: If you would draw a card, draw two cards instead.

```mtg-node
name: If you would draw a card, draw two cards instead.
source: If you would draw a card, draw two cards instead.
kind: static
timing: replace-draw
steps:
  draw(amount=2)
```

#### Cairn Wanderer (墓地のキーワード。複数のキーワードは、| でつなぐ)

原文: As long as a creature card with flying is in a graveyard, this creature has flying. The same is true for fear, first strike, double strike, deathtouch, haste, landwalk, lifelink, protection, reach, trample, shroud, and vigilance.

```mtg-node
name: As long as a creature card with flying is in a graveyard, this creature has flying. The same is true for fear, first strike, double strike, deathtouch, haste, landwalk, lifelink, protection, reach, trample, shroud, and vigilance.
source: As long as a creature card with flying is in a graveyard, this creature has flying. The same is true for fear, first strike, double strike, deathtouch, haste, landwalk, lifelink, protection, reach, trample, shroud, and vigilance.
kind: static
timing: always
condition: graveyardHasCreatureWithKeyword(keyword=flying|fear|first-strike|double-strike|deathtouch|haste|landwalk|lifelink|protection|reach|trample|shroud|vigilance)
target: self
steps:
  grantKeyword(keyword=flying|fear|first-strike|double-strike|deathtouch|haste|landwalk|lifelink|protection|reach|trample|shroud|vigilance)
```

#### Charging Rhino (ブロックの上限)

原文: Charging Rhino can't be blocked by more than one creature.

```mtg-node
name: Charging Rhino can't be blocked by more than one creature.
source: Charging Rhino can't be blocked by more than one creature.
kind: static
timing: always
target: self
steps:
  setMaxBlockers(max-blockers=1)
```

#### Force of Will 1 行目 (代替コスト。手順 = 支払うコスト)

原文: You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.

```mtg-node
name: You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.
source: You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.
kind: static
timing: alternative-cost
steps:
  payLife(amount=1)
  exileFromHand(count=1, color=blue)
```

#### Force of Will 2 行目 (呪文能力。何を打ち消すかは、対象の欄)

原文: Counter target spell.

```mtg-node
name: Counter target spell.
source: Counter target spell.
kind: spell
timing: resolves
target: target-spell
steps:
  counter()
```

#### Chandra, Acolyte of Flame 0 (忠誠度能力・トークン・遅延誘発。「それら」= 生成したトークン)

原文: 0: Create two 1/1 red Elemental creature tokens. They gain haste. Sacrifice them at the beginning of the next end step.

```mtg-node
name: 0: Create two 1/1 red Elemental creature tokens. They gain haste. Sacrifice them at the beginning of the next end step.
source: 0: Create two 1/1 red Elemental creature tokens. They gain haste. Sacrifice them at the beginning of the next end step.
kind: activated
timing: loyalty
loyalty: 0
target: created-tokens
steps:
  createToken(count=2, token=Elemental Token (1-1 R))
  grantKeyword(keyword=haste)
  delay(when=end-step)
  sacrifice()
```

#### Chandra, Acolyte of Flame 0 (「各〜」= 対象を取らない)

原文: 0: Put a loyalty counter on each red planeswalker you control.

```mtg-node
name: 0: Put a loyalty counter on each red planeswalker you control.
source: 0: Put a loyalty counter on each red planeswalker you control.
kind: activated
timing: loyalty
loyalty: 0
target: eachObject(controller=you, type=planeswalker, color=red)
steps:
  addCounter(kind=loyalty, amount=1)
```

#### Chandra, Acolyte of Flame −2 (忠誠度のコスト −2・墓地のカードを対象にする・唱えてもよい・置換)

原文: −2: You may cast target instant or sorcery card with mana value 3 or less from your graveyard. If that spell would be put into your graveyard, exile it instead.

```mtg-node
name: −2: You may cast target instant or sorcery card with mana value 3 or less from your graveyard. If that spell would be put into your graveyard, exile it instead.
source: −2: You may cast target instant or sorcery card with mana value 3 or less from your graveyard. If that spell would be put into your graveyard, exile it instead.
kind: activated
timing: loyalty
loyalty: -2
target: targetObject(controller=you, zone=graveyard, type=instant|sorcery, color=any, mana-value-max=3)
steps:
  mayCast(duration=this-turn)
  exileInsteadOfGraveyard(duration=this-turn)
```

#### Mana Vault 1 (アンタップしない。「ステップに〜しない」)

原文: Mana Vault doesn't untap during your untap step.

```mtg-node
name: Mana Vault doesn't untap during your untap step.
source: Mana Vault doesn't untap during your untap step.
kind: static
timing: always
target: self
steps:
  doesNotUntap()
```

#### Mana Vault 2 (「支払ってもよい。そうしたなら」= mayPay の後ろが、支払ったときの手順)

原文: At the beginning of your upkeep, you may pay {4}. If you do, untap Mana Vault.

```mtg-node
name: At the beginning of your upkeep, you may pay {4}. If you do, untap Mana Vault.
source: At the beginning of your upkeep, you may pay {4}. If you do, untap Mana Vault.
kind: triggered
timing: upkeep
target: self
steps:
  mayPay(mana={4})
  untap()
```

#### Mana Vault 3 (誘発型の「〜なら」= condition (誘発したときと、解決するときに確かめる)。ダメージを受けるのは、対象の `you`)

原文: At the beginning of your draw step, if Mana Vault is tapped, it deals 1 damage to you.

```mtg-node
name: At the beginning of your draw step, if Mana Vault is tapped, it deals 1 damage to you.
source: At the beginning of your draw step, if Mana Vault is tapped, it deals 1 damage to you.
kind: triggered
timing: draw-step
condition: isTapped()
target: you
steps:
  dealDamage(amount=1)
```

#### Mana Vault 4 (起動型。コスト = cost の欄、効果 = steps。マナ能力 (605): 対象を取らず、マナを加える)

原文: {T}: Add {C}{C}{C}.

```mtg-node
name: {T}: Add {C}{C}{C}.
source: {T}: Add {C}{C}{C}.
kind: activated
timing: anytime
cost:
  tapSelf()
steps:
  addMana(mana={C}{C}{C})
```

#### Black Lotus (コストに「生け贄に捧げる」= sacrificeCost。「好きな 1 色のマナを N 点」= addManaOfAnyOneColor。コストの全文を、cost に)

原文: {T}, Sacrifice this artifact: Add three mana of any one color.

```mtg-node
name: {T}, Sacrifice this artifact: Add three mana of any one color.
source: {T}, Sacrifice this artifact: Add three mana of any one color.
kind: activated
timing: anytime
cost:
  tapSelf()
  sacrificeCost(what=self)
steps:
  addManaOfAnyOneColor(amount=3)
```

#### Oko, Thief of Crowns +2 (「〜になる」= becomeToken。何になるかは、登録済みのトークンのカード名。対象は、タイプを複数選べる)

原文: +2: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.

```mtg-node
name: +2: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.
source: +2: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.
kind: activated
timing: loyalty
loyalty: +2
target: targetObject(controller=any, zone=battlefield, type=artifact|creature, color=any)
steps:
  becomeToken(token=Elk Token (3-3 G), duration=indefinite)
```

#### Oko, Thief of Crowns −5 (対象が 2 つ: target = 最初の対象、alsoTarget = もう1つの対象。「パワーが 3 以下」= power-max。exchangeControl は、対象 1 と対象 2 を使う)

原文: −5: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.

```mtg-node
name: −5: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.
source: −5: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.
kind: activated
timing: loyalty
loyalty: -5
target: targetObject(controller=you, zone=battlefield, type=artifact|creature, color=any)
also-target:
  targetObject(controller=opponent, zone=battlefield, type=creature, color=any, power-max=3)
steps:
  exchangeControl()
```

<!-- END:examples -->
