# ノードの一覧

> このファイルは、自動で作られます (`src/battle/nodeDocs.ts`)。直接は書き換えません。ノードを足したら、`npm run docs:nodes` で更新します。ノードは、`src/battle/nodes/` の、カテゴリーごとのファイルにあります。

全 87 個のノード、9 個の条件。

目次: [宣言・コスト・条件](#宣言・コスト・条件) / [対象・数える・絞り込む](#対象・数える・絞り込む) / [カードの移動・ライブラリー・手札](#カードの移動・ライブラリー・手札) / [パーマネント・トークン・カウンター](#パーマネント・トークン・カウンター) / [ダメージ・ライフ・マナ・打ち消し](#ダメージ・ライフ・マナ・打ち消し) / [継続効果](#継続効果)

## 宣言・コスト・条件 (25 個)

### `cost` コスト

起動型能力のコスト(能力の最初に書く)。mana=払う汎用マナの数 / manaCost=色つきのマナコスト("{1}{U}") / tap=このパーマネントをタップ / sacrifice=このパーマネントを生け贄に捧げる / life=N点のライフを払う (フェッチランド) / tapCreatures=パワーの合計がこの値以上になるよう、自分のクリーチャーをタップ / loyalty=忠誠度を足す(+1 は loyalty=1、−2 は loyalty=-2。プレインズウォーカーの能力。ソーサリーのタイミングで1ターンに1回) / loyaltyX=true で −X(X は起動時に選び、効果の中で $X として参照する) / removeCounter=カウンターの種類(+1/+1 など)を 1 個取り除く / discardSelf=true で、このカードを手札から捨てる(手札から起動する能力: サイクリング {2}。cost mana=2 discardSelf=true → draw)

- 引数: `mana`(number)、`manaCost`(string)、`tap`(boolean)、`sacrifice`(boolean)、`life`(number)、`tapCreatures`(number)、`loyalty`(number)、`loyaltyX`(boolean)、`removeCounter`(string)、`discardSelf`(boolean)
- 書ける能力: activated
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `additionalCost` 追加コスト(任意)

呪文を唱えるときに払ってもよい追加コスト(キッカー・チームワーク)。flag=kicked / teamwork。払って唱えると、if=<flag> のノードが実行される。mana=汎用のマナ / manaCost=色つきのマナコスト("{1}{U}") / tapCreatures=パワーの合計がこの値以上になるよう、自分のクリーチャーをタップ

- 引数: `flag`(string・必須・kicked / teamwork)、`mana`(number)、`manaCost`(string)、`tapCreatures`(number)
- 書ける能力: spell
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `altCost` 別のコスト

呪文を唱えるとき、マナコストのかわりに払ってもよい別のコスト(Force of Will・召喚者)。払って唱えると、if=alt のノードが実行される。mana=汎用のマナ / manaCost=色つきのマナコスト / life=払うライフ / exile=手札から追放するカードの枚数(exileColor=W・U・B・R・G でその色のカード。唱える呪文自身は数えない) / notYourTurn=true で、自分のターンでないときだけ / exileX=true で、追放したカードのマナ総量が X になる(Sickening Shoal。$X で読む) / oppSpells=N で、相手がこのターンに N 個以上呪文を唱えていたときだけ(Mindbreak Trap。mana=0 と使う)。パーマネントなら Evoke: 出たとき if=alt で生け贄に(Grief)

- 引数: `mana`(number)、`manaCost`(string)、`life`(number)、`exile`(number)、`exileColor`(string・W / U / B / R / G)、`notYourTurn`(boolean)、`exileX`(boolean)、`oppSpells`(number)
- 書ける能力: spell
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `delve` Delve

Delve の宣言(呪文能力の最初に書く。引数なし)。唱えるとき、墓地のカードを何枚か追放して、その1枚につき汎用マナ {1} を払ったことにできる(Treasure Cruise・Dig Through Time)

- 引数: なし
- 書ける能力: spell
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `delay` あとで (遅延誘発)

誘発型能力の途中に書く。このノードより後ろのノードを、いまではなく、次の step(upkeep・draw・main1・combat・main2・end)の開始時(だれのターンでも、次のそれ)に実行する。「次の終了ステップの開始時に、戦場に戻す」(Prized Amalgam)は、delay step=end → self → move to=battlefield tapped=true

- 引数: `step`(string・必須・upkeep / draw / main1 / combat / main2 / end)
- 言い方 (キー): 次の終了ステップの開始時に、あとで、遅延誘発
- 書ける能力: triggered / activated / spell

### `exileInstead` 墓地に行くかわりに追放

常在型能力。カードが墓地に置かれるかわりに、追放される(どこから置かれるときでも)。who=opponents(相手の墓地に行くカード。Leyline of the Void) / you / all(だれの墓地でも。Rest in Peace)。戦場にあるあいだ働く

- 引数: `who`(string・必須・opponents / you / all)
- 言い方 (キー): 墓地に行くかわりに追放、墓地に置かれるかわりに追放する
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `ignoreLegendRule` 伝説のルールを無視する

常在型能力。伝説のルール(同名の伝説のパーマネントは 1 つだけ)が、働かなくなる。who=all(だれのパーマネントにも。Mirror Gallery) / you(このパーマネントのコントローラーのものだけ) / opponents / self(このパーマネント自身だけ)。能力を失っていると、働かない

- 引数: `who`(string・必須・all / you / opponents / self)
- 言い方 (キー): 伝説のルールを無視する、伝説のルールは適用されない、レジェンド・ルール
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `startOnBattlefield` 開始時に戦場に出す

常在型能力。このカードが、ゲーム開始時の手札にあるなら、ゲームを戦場に出して始められる(Leyline of the Void)。マリガンが終わったあとに、戦場に出る

- 引数: なし
- 言い方 (キー): ゲームの開始時に戦場に出してよい、開始時の手札にあれば戦場に
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `mulliganExile` マリガンのかわりに手札を入れ替える

常在型能力。マリガンできるとき、このカードが手札にあれば、手札を全部追放して、同じ枚数を引いてもよい(マリガンの回数には数えない。Serum Powder)

- 引数: なし
- 言い方 (キー): マリガンのかわりに手札を追放して引く、マリガンできるとき手札を入れ替える
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `entersWith` カウンターつきで出る

戦場に出るとき、kind のカウンターが置かれた状態で出る(常在型能力)。x=true で、唱えるときに選んだ X 個(Chalice of the Void)/ count=N 個 / zone=graveyard + type=creature で、自分の墓地のその型のカード 1 枚につき 1 個(Golgari Grave-Troll)。出た直後から、カウンターが載っている

- 引数: `kind`(string・必須)、`x`(boolean)、`count`(number)、`zone`(string・graveyard)、`type`(string)
- 言い方 (キー): カウンターが置かれた状態で出る、出るときにカウンター
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `dredge` Dredge

Dredge の宣言(常在型能力。amount=N)。このカードが墓地にあるとき、カードを引くかわりに、ライブラリーの上から N 枚を墓地に置いて、このカードを手札に戻してもよい(ライブラリーが N 枚以上のとき)。Stinkweed Imp・Golgari Thug・Shambling Shell・Golgari Grave-Troll

- 引数: `amount`(number・必須)
- 言い方 (キー): ドレッジ、引くかわりに墓地から戻す、引く代わりにライブラリーを削って手札に戻す
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `storm` Storm

Storm の宣言(呪文能力の最初に書く。引数なし)。この呪文を唱えたとき、このターンにそれより前に唱えられた呪文(だれのものでも)の数だけ、この呪文をコピーする。コピーの対象は、元と同じ(Flusterstorm)

- 引数: なし
- 書ける能力: spell
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `modes` モード

「以下から選ぶ」の宣言(呪文能力の最初に書く)。count=モードの数(最大5) / min・max=選ぶ数(「1つ」は min=1 max=1、「1つまたは両方」は min=1 max=2)。各モードのノードに if=mode1, if=mode2 … を付ける

- 引数: `count`(number・必須)、`min`(number・必須)、`max`(number・必須)
- 書ける能力: spell
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `when` どうなったら

誘発型能力の最初に書く、誘発のきっかけ。event=cast / enters(from=graveyard) / leaves(to=graveyard で死亡) / moved(from=library to=graveyard、from=hand to=graveyard=捨てた) / damaged(combat=true。hit=creature・player) / attacks / blocks / targeted(by=you で自分の呪文・能力の対象になった) / drew(引いた) / step(step=upkeep〜end)。zone=graveyard は墓地にあるあいだだけ。castFrom=graveyard は墓地から唱えて出たとき。絞り込み: who=you・opponents / type・notType / turn=yours・opponents / self=true / alone=true / first=true(attacks は宣言で最初の1体、targeted はそのターンで最初)。eventPerm は引き金のパーマネント

- 引数: `event`(string・必須・cast / enters / leaves / moved / damaged / step / attacks / blocks / targeted / drew)、`combat`(boolean)、`hit`(string・creature / player / planeswalker)、`zone`(string・battlefield / graveyard)、`from`(string・library / hand / graveyard / stack / battlefield)、`to`(string・library / hand / graveyard / exile / battlefield)、`castFrom`(string)、`step`(string・upkeep / draw / main1 / combat / main2 / end)、`who`(string・you / opponents)、`type`(string)、`notType`(string)、`turn`(string・yours / opponents)、`self`(boolean)、`alone`(boolean)、`first`(boolean)、`by`(string・you)
- 書ける能力: triggered
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `keyword` キーワード能力

常在型能力に書く、キーワード能力の宣言。name=flash なら瞬速で唱えられ、それ以外は戦場に出たときにそのキーワードを得る

- 引数: `name`(string・必須・flying / hexproof / flash / haste / vigilance / trample / lifelink / deathtouch / firstStrike / doubleStrike / reach / menace / defender / prowess / indestructible)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `reduceCost` コスト軽減

呪文のコストを amount 減らす(マナ総量から引く)。who=you(このパーマネントのコントローラーの呪文。既定) / opponents / all。type・notType で呪文の型を絞る。affect は要らない。self=true は、このカード自身を唱えるときの軽減(「この呪文は〜安くなる」)で、per=discarded を付けると、このターンに捨てた・サイクリングしたカード 1 枚につき amount 減る(Hollow One)

- 引数: `amount`(number・必須)、`who`(string・you / opponents / all)、`type`(string)、`notType`(string)、`self`(boolean)、`per`(string・discarded)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `castLimit` 唱えられる数の制限

1ターンに唱えられる呪文の数を、プレイヤーごとに amount 以下にする(Archon of Emeria は amount=1)。who=all(全員。既定) / you / opponents。affect は要らない

- 引数: `amount`(number・必須)、`who`(string・you / opponents / all)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `cantCast` 唱えられない呪文

条件に合う呪文を、唱えられなくする。who=opponents(対戦相手が唱える呪文。all 既定 / you)。type・notType で呪文の型を絞る。mvOverLands=true なら、マナ総量が、そのプレイヤーがコントロールする土地の数より大きい呪文だけ(Lavinia は who=opponents notType=creature mvOverLands=true)。from=graveyard|library で、そのゾーンから唱えるときだけ(Grafdigger's Cage)。affect は要らない

- 引数: `who`(string・you / opponents / all)、`type`(string)、`notType`(string)、`mvOverLands`(boolean)、`from`(string)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `cantActivate` 起動できない能力

条件に合うパーマネントの起動型能力(マナ能力も)を、起動できなくする。type・notType でパーマネントの型を絞る(Collector Ouphe は type=artifact)。who で、能力を起動するプレイヤーを絞る(既定は all)。affect は要らない

- 引数: `who`(string・you / opponents / all)、`type`(string)、`notType`(string)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `entersTapped` タップ状態で出る

条件に合うカードが、タップ状態で戦場に出る(Archon of Emeria の「対戦相手の基本でない土地」は who=opponents type=land notType=Basic)。who は、戦場に出るカードのコントローラー(既定は all)。affect は要らない

- 引数: `who`(string・you / opponents / all)、`type`(string)、`notType`(string)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `cantEnter` 戦場に出られない

from(graveyard / library。graveyard|library のように並べられる)にある、条件に合うカードが、戦場に出られなくする(Grafdigger's Cage は from=graveyard|library type=creature)。探して戦場に出す(search)で効く。affect は要らない

- 引数: `from`(string・必須)、`type`(string)、`notType`(string)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `upkeepTax` 維持コスト

条件に合うパーマネントは、そのコントローラーのアップキープの開始時に、汎用マナ mana を支払わないかぎり、else=sacrifice(生け贄に捧げる) / destroy(破壊される)(Energy Flux は type=artifact mana=2 else=sacrifice、The Tabernacle at Pendrell Vale は type=creature mana=1 else=destroy)。who は、パーマネントのコントローラー(既定は all)。マナは、払えるなら自動でタップして払い、払うかどうかを聞く。affect は要らない

- 引数: `mana`(number・必須)、`else`(string・必須・sacrifice / destroy)、`who`(string・you / opponents / all)、`type`(string)、`notType`(string)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `ward` 護法

護法 {N}(「このパーマネントが、対戦相手がコントロールする呪文や能力の対象になるたび、それを打ち消す。そのプレイヤーが {N} を支払わないかぎり」)。常在型能力に amount=N で書く(affect は要らない。汎用のマナ N 点だけ)

- 引数: `amount`(number・必須)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `untapDuring` 他のプレイヤーのアンタップ

このパーマネントを、他のプレイヤーのアンタップ・ステップにもアンタップする(Bender's Waterskin など)。who=opponents(対戦相手のターン) / all。自分のアンタップ・ステップでは、ふつうにアンタップする。affect は要らない

- 引数: `who`(string・必須・opponents / all)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `timing` 起動のタイミング

起動型能力の起動の制限(能力の最初に書く)。sorcery=true なら、ソーサリーのタイミングだけ(装備など) / oncePerTurn=true なら、1ターンに1回だけ / oppLostLife=true なら、相手がこのターンにライフを失っているときだけ (Hired Claw)

- 引数: `sorcery`(boolean)、`oncePerTurn`(boolean)、`oppLostLife`(boolean)
- 書ける能力: activated
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

## 対象・数える・絞り込む (12 個)

### `target` 対象

対象を決める。zone=stack + kind=spell(スタックの呪文) / zone=battlefield + kind=permanent(戦場のパーマネント) / zone=player + kind=player(プレイヤー。draw や discard の player=target と使う。controller=opponents で対戦相手) / zone=graveyard + kind=card(墓地のカード。type=creature などで絞る。controller=you は、自分の墓地) / zone=any + kind=any(「any target」。プレイヤー・クリーチャー・プレインズウォーカー。damage と使う)。type=型 / notType=その型でない / mv=マナ総量 / controller=you(この呪文のコントローラーのもの)・opponents(それ以外) / attacking=攻撃中か / tapped=タップ状態 で絞る。min / max = 対象の数(既定は1。「1体か2体」は min=1 max=2、「最大1つ」は min=0 max=1)

- 引数: `zone`(string・必須・stack / battlefield / player / any / graveyard)、`kind`(string・必須・spell / permanent / player / any / card)、`type`(string)、`notType`(string)、`mv`(number)、`maxPower`(number)、`controller`(string・you / opponents)、`attacking`(boolean)、`tapped`(boolean)、`min`(number)、`max`(number)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `select` すべて選ぶ

対象を取らずに、条件に合うものすべてを選ぶ(「すべての〜」)。zone=battlefield + kind=permanent / zone=stack + kind=spell。絞り込みは target と同じ(type / notType / mv / controller / attacking / tapped)。bounce や tap などの target に渡せる

- 引数: `zone`(string・必須・stack / battlefield)、`kind`(string・必須・spell / permanent)、`type`(string)、`notType`(string)、`mv`(number)、`maxPower`(number)、`controller`(string・you / opponents)、`attacking`(boolean)、`tapped`(boolean)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `countCards` 枚数を数える

zone(hand / graveyard / library / battlefield)のカードの枚数を、n として出力する(who=you・opponents。type・notType で絞る)。「手札の枚数に等しい X」は、これを as= で受けて、count=$名前 に渡す

- 引数: `zone`(string・必須・hand / graveyard / library / battlefield)、`who`(string・you / opponents)、`type`(string)、`notType`(string)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)

### `statOf` 数値を読む

対象(複数なら、合計。スタックの呪文のマナ総量も)のパワー・タフネス・マナ総量を、n として出力する (stat=power / toughness / mv)。戦場を離れる効果の前に使う: 「そのパワーに等しいライフを得る」(Swords to Plowshares)は、statOf → exile → gainLife amount=$名前

- 引数: `target`(ref・必須)、`stat`(string・必須・power / toughness / mv)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)

### `counterCount` カウンターの数

対象のパーマネント(複数なら合計)の上にある kind のカウンターの数を、n として出力する。「カウンターの数に等しいマナ総量」(Chalice of the Void)は、self as=s → counterCount target=$s kind=charge → compare

- 引数: `target`(ref・必須)、`kind`(string・必須)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): カウンターの数、カウンターが何個

### `controllerOf` コントローラーを読む

対象のパーマネント(複数なら、先頭)のコントローラーを、id として出力する。「そのコントローラーは、ライフを得る」は、controllerOf as=名前 → gainLife player=target target=$名前。戦場を離れる効果の前に使う

- 引数: `target`(ref・必須)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)

### `filter` 絞り込む

from(look / choose などの出力)のカードのうち、type(| は または)に合い、notType(| は どれでもない)に合い、color(W U B R G)の色を持つものだけを、出力する。except(self などの出力)に渡したカードは除く

- 引数: `from`(ref・必須)、`type`(string)、`notType`(string)、`color`(string)、`except`(ref)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)

### `spentColors` 払ったマナの色の数

この呪文を唱えるために払ったマナの色の数 (W・U・B・R・G のうち、何色か) を出力する。収束 (Converge): Prismatic Ending。色の決まらない好きな色のマナで払った分は、数えない

- 引数: なし
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)
- 書ける能力: spell

### `compare` 数を比べる

a と b を、op (lt = a<b / le = a≤b / eq = a=b / ge = a≥b / gt = a>b) で比べて、成り立てば true、でなければ false を出力する。as= で名前を付けて、if=$名前 で使う(「マナ総量が、払った色の数以下なら」は statOf と spentColors と使う)

- 引数: `a`(number・必須)、`b`(number・必須)、`op`(string・必須・lt / le / eq / ge / gt)
- 出力: `ok`(boolean) (`as=名前` で受けて、`$名前` で渡す)

### `math` 数を計算する

a と b を、op (add = a+b / sub = a−b / mul = a×b) で計算して、n として出力する。as= で受けて、count=$名前・power=$名前 などに渡す。「−X/−X」は、math a=$X op=mul b=-1 → modify power=$名前 toughness=$名前

- 引数: `a`(number・必須)、`b`(number・必須)、`op`(string・必須・add / sub / mul)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 計算する、−X/−X (X を負にする)、足す・引く・かける

### `eventPerm` 引き金のパーマネント

誘発型能力の引き金になったものの id を出力する(event が enters / leaves / attacks / blocks ならそのパーマネント、cast なら唱えられた呪文)。as= を付けて target に渡す(「そのクリーチャーは +1/+1」「その呪文を打ち消す」など)

- 引数: なし
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 書ける能力: triggered

### `self` このパーマネント

この能力の発生源のパーマネント自身の id を出力する(「このクリーチャーの上に」など。as= を付けて、target に渡す)

- 引数: なし
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

## カードの移動・ライブラリー・手札 (17 個)

### `draw` 引く

プレイヤーがカードを count 枚引く。player=you(呪文のコントローラー) / opponents(全相手) / target(target ノードで選んだプレイヤー。target=$名前 を渡す)。optional=true なら「引いてもよい」(player=you のとき、引くかどうかを選ぶ)。引いた枚数を出力する (「そうしたなら」は if=$名前)

- 引数: `player`(string・必須・you / opponents / target)、`target`(ref)、`count`(number・必須)、`optional`(boolean)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 引く、ドロー、カードを引く、手札に加える (ライブラリーから)

### `discard` 捨てる

プレイヤーが手札を count 枚捨てる(捨てるカードは、そのプレイヤーが選ぶ)。player=you / opponents / target(draw と同じ)。count のかわりに cards(選んだカードの id。choose の出力)を書くと、そのカードを捨てさせる(「1枚選ぶ。そのプレイヤーはそれを捨てる」Grief)

- 引数: `player`(string・必須・you / opponents / target)、`target`(ref)、`count`(number)、`cards`(ref)、`optional`(boolean)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 捨てる、ディスカード、手札を捨てる

### `look` ライブラリーの上を見る

プレイヤーのライブラリーの上から count 枚を見る(動かさない)。出力を choose や move に渡す。player=you / opponents / target

- 引数: `player`(string・必須・you / opponents / target)、`target`(ref)、`count`(number・必須)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 見る、占術、諜報、ライブラリーの上を見る

### `lookHand` 手札を見る

プレイヤーの手札を見る(動かさない。「手札を公開する」「手札を見て、1枚選んで、捨てさせる」)。見たカードの id を出力する: filter(絞る)・choose(選ぶ)・move(to=graveyard / top など)につなぐ。player=you / opponents / target。相手の手札を見ると、画面は、見た手札を、前に出して見せる (自分の手札を、ほかのノードに渡すだけのときは、見せない)

- 引数: `player`(string・必須・you / opponents / target)、`target`(ref)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 手札を見る、手札を公開させる

### `shuffle` ライブラリーを切る

プレイヤーのライブラリーを切る。player=you / opponents / target。optional=true なら「してもよい」(断れる。「切ってもよい」)

- 引数: `player`(string・必須・you / opponents / target)、`target`(ref)、`optional`(boolean)
- 言い方 (キー): 切る、シャッフル

### `choose` 選ぶ

from(look などの出力)の中から count 枚を選ぶ。atMost=true なら 0〜count 枚(「好きな数」「最大N」。諜報など)。選んだカードの id を出力する

- 引数: `from`(ref・必須)、`count`(number・必須)、`atMost`(boolean)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 選ぶ、その中から選ぶ

### `move` カードを動かす

cards(look / choose の出力)を、持ち主の to へ動かす。to=hand / graveyard / top(ライブラリーの一番上) / bottom(一番下) / battlefield(持ち主のコントロールで、戦場へ。tapped=true でタップ状態。「墓地から出られない」の制限に従う)。optional=true なら「してもよい」(断れる)。except に渡したカードは動かさない(「残りを底に」)。random=true で、ランダムな順で(「ランダムな順番でライブラリーの一番下に置く」)

- 引数: `cards`(ref・必須)、`except`(ref)、`to`(string・必須・hand / graveyard / top / bottom / battlefield)、`random`(boolean)、`tapped`(boolean)、`optional`(boolean)
- 言い方 (キー): 動かす、墓地に置く、ライブラリーの上・下に置く、墓地から戻す

### `mill` 切削 (ライブラリーの上から墓地へ)

プレイヤーのライブラリーの上から count 枚を、墓地に置く(足りなければ、ある分だけ)。player=you / opponents / target。置いたカードの id を出力する。置かれたカードは「ライブラリーから墓地に置かれた」(Narcomoeba・Creeping Chill が誘発する)

- 引数: `player`(string・必須・you / opponents / target)、`target`(ref)、`count`(number・必須)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 墓地に置く (ライブラリーから)、切削、ミル、ライブラリーの上から N 枚を墓地へ

### `exilePlay` 追放して、プレイしてよい

コントローラーが、ライブラリーの一番上から count 枚(既定は1)を追放し、期限までのあいだ、プレイしてよい。duration=endOfTurn(このターン中) / yourNextEnd(自分の次の終了ステップまで)。実際には手札に置いて印を付ける(期限が来て、まだ手札にあれば追放される。shortcut: 手札の枚数にも数える)

- 引数: `count`(number)、`duration`(string・必須・endOfTurn / yourNextEnd)

### `zoneCards` 墓地・手札のカード

プレイヤーの墓地(zone=graveyard)または手札(zone=hand)のカードすべての id を出力する。player=you / opponents / target(draw と同じ)。move の cards に渡す(「墓地のカードをすべてライブラリーの一番下に置く」は move to=bottom random=true)

- 引数: `zone`(string・必須・graveyard / hand)、`player`(string・必須・you / opponents / target)、`target`(ref)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)

### `drawnCards` このターンに引いたカード

コントローラーが、このターンに引いて、まだ手札にあるカードすべての id を出力する(choose の from に渡す。Sylvan Library)

- 引数: なし
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)

### `payOrMove` ライフを払うか、動かす

cards(choose などの出力)の1枚ごとに、コントローラーが life 点のライフを払う(そのカードは手札に残る)か、払わずに、そのカードを to(top / bottom)に置くかを選ぶ。払うか聞かれたら、既定は払わない(Sylvan Library は life=4 to=top)

- 引数: `cards`(ref・必須)、`life`(number・必須)、`to`(string・必須・top / bottom)
- 言い方 (キー): ライフを払うか、戻す

### `bounce` 手札に戻す

対象(select の出力も可)のパーマネントを持ち主の手札に戻す

- 引数: `target`(ref・必須)
- 言い方 (キー): 手札に戻す、バウンス、持ち主の手札に戻す

### `sacrifice` 生け贄に捧げる

コントローラーが、対象のパーマネント(自分のもの。self ノードの出力で「これを生け贄に捧げる」)を生け贄に捧げる(持ち主の墓地へ。破壊不能でも捧げられる)。他人のパーマネントは、捧げられない

- 引数: `target`(ref・必須)
- 言い方 (キー): 生け贄に捧げる、生け贄

### `destroy` 破壊する

対象(select の出力も可)のパーマネントを破壊する (持ち主の墓地へ。破壊不能は、破壊されない)。「土地を破壊する」(Wasteland・Strip Mine)・「アーティファクトやエンチャントを、最大2つ破壊する」は、target(type=・notType=・min=・max=)と使う

- 引数: `target`(ref・必須)
- 言い方 (キー): 破壊する、壊す

### `search` ライブラリーから探す

コントローラーのライブラリーから、type(型・サブタイプ。例: Forest|Island)に合うカードを count 枚まで(既定は1)探して、to=battlefield / hand に置く。tapped=true ならタップ状態で戦場に出す。そのあとライブラリーを切る (shuffle=false で切らない)。見つかったカードの id を出力する (「そうしたなら」は if=$名前)。フェッチランド: `cost tap=true sacrifice=true life=1` → `search type=Forest|Island to=battlefield`

- 引数: `type`(string)、`name`(string)、`to`(string・必須・battlefield / hand)、`count`(number)、`tapped`(boolean)、`shuffle`(boolean)
- 出力: `id`(id) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 探す、サーチ、ライブラリーから探す

### `exile` 追放する

追放する。target=(対象・select の出力・self) があれば、戦場のそのパーマネント (戦場に無ければ、墓地のそのカード。スタックの呪文も) を追放する (トークンは消える)。無ければ、自分の墓地のカードを count 枚(zone=graveyard。足りなければ何もしない)。optional=true なら「してもよい」(断れる)。追放できた枚数を n として出力する(0 なら追放していない)。「そうしたなら〜」は、これを as=名前 で受けて、次のノードに if=$名前 を付ける。「追放して、そのパワーに等しいライフを得る」は、追放の前に statOf・controllerOf で読んでおく。shortcut: 墓地から追放するカードは、古いものから (選べるのは、判断の入力を作るとき)

- 引数: `target`(ref)、`zone`(string・graveyard)、`count`(number)、`optional`(boolean)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): 追放する、追放

## パーマネント・トークン・カウンター (15 個)

### `tap` タップする

対象(複数も可)のパーマネントをタップする

- 引数: `target`(ref・必須)
- 言い方 (キー): タップする

### `untap` アンタップする

対象(複数も可)のパーマネントをアンタップする

- 引数: `target`(ref・必須)
- 言い方 (キー): アンタップする

### `modify` 修整を受ける

対象のクリーチャーが +power/+toughness の修整を受ける。duration=endOfTurn(ターン終了時まで) / forever

- 引数: `target`(ref・必須)、`power`(number・必須)、`toughness`(number・必須)、`duration`(string・必須・endOfTurn / forever)
- 言い方 (キー): 修整を受ける、+X/+X、パワー・タフネスの修整

### `becomes` 〜になる

対象のパーマネントが、types(型行。例: "Creature — Elk")・colors(例: G)・power と toughness(基本のパワー・タフネス)になる。loseAbilities=true なら、すべての能力を失う。duration=forever / endOfTurn。Oko の +1 (target artifact or creature → becomes types="Creature — Elk" colors=G power=3 toughness=3 loseAbilities=true duration=forever)

- 引数: `target`(ref・必須)、`types`(string)、`colors`(string)、`power`(number)、`toughness`(number)、`loseAbilities`(boolean)、`duration`(string・必須・endOfTurn / forever)
- 言い方 (キー): 〜になる、変身させる

### `exchangeControl` コントロールを交換する

a と b(それぞれ target ノードの出力)のパーマネントのコントロールを交換する。どちらかが戦場になければ、何も起きない。交換したパーマネントは、召喚酔いになる(クリーチャーの場合)。Oko の −5

- 引数: `a`(ref・必須)、`b`(ref・必須)
- 言い方 (キー): コントロールを交換する

### `grant` キーワードを得る

対象のクリーチャーがキーワード能力を得る。duration=endOfTurn(ターン終了時まで) / forever

- 引数: `target`(ref・必須)、`keyword`(string・必須・flying / hexproof / flash / haste / vigilance / trample / lifelink / deathtouch / firstStrike / doubleStrike / reach / menace / defender / prowess / indestructible)、`duration`(string・必須・endOfTurn / forever)
- 言い方 (キー): 能力を得る、飛行を得る

### `prepareSpell` 準備呪文

準備呪文 (準備済のクリーチャーの、裏面の呪文) の最初に書く宣言。name=呪文の名前 / type=Instant か Sorcery / manaCost=マナコスト("{U}")。そのあとに、呪文の効果のノードを書く

- 引数: `name`(string・必須)、`type`(string・必須・Instant / Sorcery)、`manaCost`(string)
- 書ける能力: prepare
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `entersPrepared` 準備済で戦場に出る

「このクリーチャーは準備済状態で戦場に出る」。常在型能力に書く(affect は要らない)。準備呪文を持たないクリーチャーは、準備済にならない

- 引数: なし
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `prepare` 準備済になる

このパーマネント自身が、準備済になる(「このクリーチャーは準備済状態になる」)。すでに準備済なら何も起きない(2つ目のコピーはできない)。準備呪文を持たないものは、なれない

- 引数: なし
- 書ける能力: spell / activated / triggered

### `attach` 付ける

この能力の発生源(装備品・オーラ)を、対象のパーマネントに付ける。オーラは、戦場に出てから付く

- 引数: `target`(ref・必須)
- 言い方 (キー): 付ける、装備する、オーラ

### `emblem` 紋章の能力

紋章の誘発型能力の最初に書く(そのあとに when)。name は、createEmblem の name と同じ。プレインズウォーカーなどのカードのルールの中に、紋章の能力を書く

- 引数: `name`(string・必須)
- 書ける能力: triggered
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `createEmblem` 紋章を得る

コントローラーが紋章を得る。紋章は戦場の外に残り続け、元のカードのルールの、emblem name=<同じ name> で始まる誘発型能力が働く

- 引数: `name`(string・必須)

### `createToken` トークンを作る

コントローラーが、トークンのクリーチャーなどを count 個(既定は1)作る。name=名前 / types=型行(例: "Creature — Illusion") / power・toughness / colors=色(空白区切り。例: "U")

- 引数: `name`(string・必須)、`types`(string・必須)、`power`(number)、`toughness`(number)、`colors`(string)、`count`(number)
- 言い方 (キー): トークンを作る、トークンを生成

### `regenerate` 再生する

対象のパーマネントに、再生の盾を 1 つ与える(このターンのあいだ、次に破壊されるかわりに、タップして戦闘から外れ、ダメージが取り除かれる。致死ダメージも防ぐ)。「このクリーチャーを再生する」は、self as=s → regenerate target=$s

- 引数: `target`(ref・必須)
- 言い方 (キー): 再生する、再生の盾

### `addCounter` カウンターを置く

対象のパーマネントの上にカウンターを count 個置く。kind=+1/+1(パワー・タフネスに足される) / stun(麻痺。アンタップするかわりに1つ取り除く) / charge など、好きな名前(数えるだけ)

- 引数: `target`(ref・必須)、`kind`(string・必須)、`count`(number・必須)
- 言い方 (キー): カウンターを置く、+1/+1 カウンター

## ダメージ・ライフ・マナ・打ち消し (9 個)

### `gainLife` ライフを得る

プレイヤーが amount 点のライフを得る。player=you / opponents / target(draw と同じ)

- 引数: `player`(string・必須・you / opponents / target)、`target`(ref)、`amount`(number・必須)
- 言い方 (キー): ライフを得る、回復、ライフを回復

### `loseLife` ライフを失う

プレイヤーが amount 点のライフを失う。player=you / opponents / target(draw と同じ)

- 引数: `player`(string・必須・you / opponents / target)、`target`(ref)、`amount`(number・必須)
- 言い方 (キー): ライフを失う、ライフを払う、ライフ損失

### `lifeGained` このターンに得たライフ

プレイヤー (player=you / opponents) が、このターンに得たライフの量 (合計) を、n として出力する。「3 点以上ライフを得ていたら」(Silversmote Ghoul)は、これを as= で受けて、compare op=ge と if=$名前

- 引数: `player`(string・必須・you / opponents)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)
- 言い方 (キー): このターンにライフを得た、ライフを得ていたら

### `lifeLost` このターンに失ったライフ

プレイヤー (player=you / opponents) が、このターンに失ったライフの量 (合計。ダメージ・ライフの支払いも含む) を、n として出力する。「相手がこのターンにライフを失っていたら」は、これを as= で受けて、compare op=ge b=1 と if=$名前

- 引数: `player`(string・必須・you / opponents)
- 出力: `n`(number) (`as=名前` で受けて、`$名前` で渡す)

### `damage` ダメージを与える

対象 (target ノードの出力。zone=any なら、プレイヤー・クリーチャー・プレインズウォーカー) に amount 点のダメージを与える。対象を取らないときは、player=you / opponents (「各対戦相手に」) を、target のかわりに書く

- 引数: `target`(ref)、`player`(string・you / opponents)、`amount`(number・必須)
- 言い方 (キー): ダメージを与える、ダメージ、焼く

### `addMana` マナを加える

コントローラーがマナを amount 点加える。colors=GWU(その中の好きな1色。「{G}、{W}、{U} のいずれか」)。color=W・U・B・R・G(その色) / C(無色。既定) / any(好きな色。どの色のコストにも使える)。spellType / spellNotType を添えると、そのマナは、その型の呪文(spellNotType ならその型でない呪文)を唱えるためにしか使えない(「クリーチャーでない呪文を唱えるためにしか使えない」は spellNotType=creature)

- 引数: `amount`(number・必須)、`color`(string・W / U / B / R / G / C / any)、`colors`(string)、`spellType`(string)、`spellNotType`(string)
- 言い方 (キー): マナを加える、マナ

### `extraTurn` 追加のターン

コントローラーが、このターンの次に、追加のターンを count 回(既定は1)得る(Time Walk)

- 引数: `count`(number)
- 言い方 (キー): 追加のターン

### `copySpell` 呪文をコピーする

スタックの呪文(target ノードの出力。zone=stack)を count 回(既定は1)コピーする。コピーは、能力のコントローラーのもので、元と同じ対象を持ち、解決しても墓地に行かず消える。shortcut: 対象は選び直せない

- 引数: `target`(ref)、`spell`(string)、`count`(number)
- 言い方 (キー): 呪文をコピーする、コピー

### `counter` 打ち消す

対象の呪文を打ち消す (スタックから取り除いて、持ち主の墓地へ)。unlessPay=N を付けると「そのコントローラーが N を支払わないかぎり」。exile=true で「墓地に置くかわりに追放する」

- 引数: `target`(ref・必須)、`unlessPay`(number)、`exile`(boolean)
- 言い方 (キー): 打ち消す、カウンター (呪文を打ち消す)

## 継続効果 (9 個)

### `affect` 及ぶ先

継続効果の常在型能力の最初に書く、効果が及ぶ先。who=attached(このパーマネントが付いているもの。装備・オーラ) / self(このパーマネント自身) / yours(自分のパーマネント) / all(すべて)。type・notType で型を絞る。turn=yours で、そのコントローラーのターンのあいだだけ(「自分のターンのあいだ、先制攻撃を持つ」)/ opponents で、相手のターンのあいだだけ

- 引数: `who`(string・必須・attached / self / yours / all)、`type`(string)、`notType`(string)、`turn`(string・yours / opponents)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)
- 中心のノード (ルールを書かせるとき、いつも AI の指示に入る。ほかは、カードごとに選ぶ)

### `staticModify` 修整(継続)

及ぶ先が、+power/+toughness の修整を受ける(レイヤー7)

- 引数: `power`(number・必須)、`toughness`(number・必須)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `staticGrant` キーワードを与える(継続)

及ぶ先が、キーワード能力を持つ(レイヤー6)。prowess を与えると、果敢として働く

- 引数: `keyword`(string・必須・flying / hexproof / flash / haste / vigilance / trample / lifelink / deathtouch / firstStrike / doubleStrike / reach / menace / defender / prowess / indestructible)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `loseAbilities` すべての能力を失う

及ぶ先が、すべての能力を失う(誘発型・起動型・常在型・キーワード。レイヤー6)

- 引数: なし
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `setBaseStats` 基本のパワー・タフネス

及ぶ先の基本のパワー・タフネスを power/toughness にする(レイヤー7b。カウンターや修整は、そのあとで足される)

- 引数: `power`(number・必須)、`toughness`(number・必須)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `setTypes` 型行を変える

及ぶ先の型行を types にする(例: "Creature — Citizen"。レイヤー4)

- 引数: `types`(string・必須)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `setColors` 色を変える

及ぶ先の色を colors にする(空白区切り。例: "G W"。レイヤー5)

- 引数: `colors`(string・必須)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `setName` 名前を変える

及ぶ先の名前を name にする(レイヤー4。表示用)

- 引数: `name`(string・必須)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

### `extraTriggers` 誘発の追加

及ぶ先の誘発型能力が、追加で amount 回誘発する

- 引数: `amount`(number・必須)
- 書ける能力: static
- 宣言のノード (エンジンが読む。`if=` は付けられない)

## 条件 (`if=`)

- `kicked` キッカーされた: この呪文がキッカーされて唱えられた
- `alt` 別のコストで唱えられた: この呪文 (出てきたパーマネントの誘発では、そのパーマネント) が、altCost の別のコストで唱えられた (召喚者・Force of Will など)
- `noManaSpent` マナを使わずに唱えられた: 引き金になった呪文 (when event=cast の誘発で) が、マナを1点も使わずに唱えられた (別のコスト・0 のコスト)。Lavinia, Azorius Renegade
- `teamwork` チームワークを用いた: この呪文がチームワークを用いて唱えられた
- `mode1` モード1が選ばれた: この呪文のモード1が選ばれて唱えられた (modes の宣言と使う)
- `mode2` モード2が選ばれた: この呪文のモード2が選ばれて唱えられた (modes の宣言と使う)
- `mode3` モード3が選ばれた: この呪文のモード3が選ばれて唱えられた (modes の宣言と使う)
- `mode4` モード4が選ばれた: この呪文のモード4が選ばれて唱えられた (modes の宣言と使う)
- `mode5` モード5が選ばれた: この呪文のモード5が選ばれて唱えられた (modes の宣言と使う)

数の条件 `graveyard:lesson:3+` (場所:型:数。`+` 以上 / `-` 以下)、`$名前` (前のノードの出力が、0・偽・空でないとき)。否定は `!` を前に付ける。
