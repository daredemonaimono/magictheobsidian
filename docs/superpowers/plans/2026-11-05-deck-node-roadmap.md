# デッキ「Gentry Mono U」から見た、ノード追加のロードマップ

設計書 5 節の「未実装のノードを順に実装する」の、順番表。デッキのカードを、その時点のノードで組めるかを見て、足りないものを、足す順に並べた。

## 現状(カード別)

| カード | 組める? | 足りないもの |
|---|---|---|
| Negate / Essence Scatter / Spell Snare | ○ | — |
| Ancestral Recall(単独のカード) | ○ | — |
| Into the Roil | ○ | —(キッカーは `additionalCost`、実装済み) |
| We Say Thee Nay! | ○ | —(チームワークは `additionalCost`、実装済み) |
| Octopus Form | ○ | —(`controller`・`modify`・`grant`・`untap`、第1弾で実装済み) |
| Amazing Acrobatics | ○ | —(`modes`・`target min/max`、第2弾で実装済み) |
| Confusticate and Bebother | ○ | —(`modes`、第2弾で実装済み) |
| Accumulate Wisdom | ○ | —(`look`・`choose`・`move`・数の条件、第2弾で実装済み) |
| Aetherize | ○ | —(`select`、第2弾で実装済み。攻撃の処理は戦闘の実装で) |
| Island | ○ | —(`cost tap` + `addMana`、土地を出す `playLand`、第3弾で実装済み) |
| Bender's Waterskin | ○ | —(`untapDuring who=opponents` + `cost tap` + `addMana color=any`、第6・8弾で実装済み) |
| Brineborn Cutthroat / Elementalist Adept | ○ | —(`when event=cast`・`self`・`addCounter`・`keyword name=flash`、第3弾で実装済み。果敢は `keyword name=prowess`) |
| Cryogen Relic | ○ | —(`when event=enters/leaves self=true`・起動型・麻痺カウンター、第3弾で実装済み) |
| Geist of Saint Thalia | ○ | —(`keyword flying`・`reduceCost`、第4弾で実装済み) |
| Illvoi Light Jammer / Wizard's Staff | ○ | —(`attach`・`timing`・`affect who=attached`・`staticModify`・`staticGrant`・`extraTriggers`、第4弾で実装済み) |
| Chandra / The Theorist, Jace Beleren | ○ | —(忠誠度能力・X・諜報・制限つきマナ・紋章・トークン・ステップの開始時、第5弾で実装済み。「各対戦相手につき」は1対1の `max=1` で表す) |
| Witness Protection | ○ | —(オーラ・`loseAbilities`・`setBaseStats`・`setTypes`・`setColors`・`setName`、第4弾で実装済み) |
| Emeritus of Ideation // Ancestral Recall | × | 準備済(ルールの正本を確認してから) |

## 順番

1. **第1弾(スタックの呪文だけで、組めるカードを増やす)**
   - 条件 `if=`(`kicked` / `teamwork`、否定は `!`)。ノード1つ1つに付けられる、汎用のつなぎの言葉。
   - `tap` / `untap`、`target` の `controller` 絞り込み、`tapped` 状態。
   - `modify`(修整)と `grant`(キーワードを得る)に、持続「ターン終了時まで」。呪禁は、相手の対象を実際に止める。
   - → Into the Roil、We Say Thee Nay!、Octopus Form が組める。
2. **第2弾(実装済み)**: モード選択(`choose`)、1〜2体の対象、集合の選択(`select`)、上から見る・選ぶ・底に置く。→ Confusticate、Amazing Acrobatics、Accumulate Wisdom、Aetherize。
3. **コストの仕組み(実装済み)**: `cost` / `additionalCost` / `addMana`(置き場所の検査つき:`cost` は起動型能力だけ、`additionalCost` は呪文能力だけ。値は 0 以上)、起動型能力の起動(マナ能力は即座に、それ以外はスタック)。マナの色の区別と、カード自体のマナコストの支払いは、まだ。
4. **第3弾(実装済み)**: 戦場に出る処理(クリーチャー・アーティファクト・土地が戦場に置かれる)、誘発型の枠(イベント)、麻痺カウンター・カウンターを置く。→ Island(戦場に出す)、Cutthroat、Adept、Cryogen Relic。限界: 対象を取る誘発型能力(誘発時に対象を選ぶ)は、まだ。誘発の順番(APNAP)は、戦場の順。戦闘(攻撃・ブロック)は、まだ。
5. **第4弾(実装済み)**: 常在型(キーワード・コスト軽減・継続効果)、装備・オーラ、レイヤー。→ Geist、Light Jammer、Wizard's Staff、Witness Protection。限界: タイムスタンプは見ない(戦場の順)。カード自体のマナコストの支払いは `Game.payManaCosts` のときだけ(色は区別しない)。
6. **第5弾(実装済み)**: 忠誠度能力・トークン・紋章。→ Chandra、Jace。状態起因処理(忠誠度0・タフネス0以下・付いていないオーラ)も入った。限界: 多人数戦の「各対戦相手につき」、マナ・プールが空にならない(マナはステップをまたいで残る)、静的な紋章の能力。
7. **第6弾(実装済み)**: `untapDuring`(他のプレイヤーのアンタップ・ステップにもアンタップ)。→ Bender's Waterskin。
8. **第7弾(実装済み)**: ライフ・ダメージ・ゲームの終わり。`Game.life`(初期 20)・`gainLife` / `loseLife` / `damage`・`target zone=any`(プレイヤー・クリーチャー・プレインズウォーカー)。状況起因処理: ライフ 0 以下・空のライブラリーから引こうとした → 負け(残りが1人以下でゲーム終了、勝者なしは引き分け)、致死ダメージ(ターン終了時に消える)。終わったゲームでは、唱える・起動する・パスができない。限界: ターン開始時のドロー(ドロー・ステップの引く処理)は、戦闘のあとの「ターンの進行」で入れる。毒カウンターなし。ダメージの発生源 (絆魂・接死) は、戦闘で。

9. **護法(実装済み)**: 常在型の `ward amount=N`。パーマネントが対戦相手の呪文・能力の対象になると(`GameEvent` の `targeted`)、{N} を払わないかぎり打ち消す誘発が積まれる(`counter unlessPay`。能力・呪文のコピーは打ち消されても墓地に行かない)。すべての能力を失っていれば働かない。限界: 護法のコストは汎用のマナだけ(ライフや「捨てる」などの護法は未対応)。

10. **戦闘開始・戦闘終了ステップ(実装済み)**: 公式のターンの流れ(mtg-jp.com の「ターンの進め方」)に合わせて、`strictTurns` のとき、戦闘フェイズを 戦闘開始(優先権の回)→ 攻撃クリーチャー指定 → ブロック指定 → (先制攻撃ダメージ)→ 戦闘ダメージ → 戦闘終了(優先権の回。攻撃状態はここまで残る)に分けた(`Game.combatPhase` の `beginning` / `end`)。攻撃が無ければ、ブロックとダメージは飛ばして戦闘終了へ。`strictTurns` が偽のときは、以前のまま(戦闘開始・戦闘終了の回は無い)。

## これからの順番(壊れない順)

依存の順に、下のものは上のものを使う。1 つ終えるごとに、テスト・レビューを通してから次へ。

1. **第8弾(実装済み)**: マナの色。`Game.mana`(合計。互換のため残す)+ `Game.pool`(色つきの内訳 W U B R G と好きな色 A。合計から引いた残りは無色)。`addMana color=W|U|B|R|G|C|any`、`cost` / `additionalCost` の `manaCost="{1}{U}"`(混成 {W/U}・{2/W}・{C}、{X}=0、{S}=無色1)、`GameCard.manaCost`(`payManaCosts` のとき、色まで払う。コスト軽減は汎用の分だけ)、制限つきマナにも色。払い方は `src/battle/mana.ts` の `trySpend` 1か所(色つき → 混成 → 汎用。汎用は、制限つき → 無色 → 好きな色 → 色の余りの順)。限界: 好きな色のマナは、払うときに色を決める(本来は出すときに決める)。マナ・プールは、ステップの終わりに空にならない(ターンの進行で)。ファイレクシアマナ {W/P} はライフで払えない(色のマナ1点として読む)。
2. **第9弾(実装済み)**: 戦闘。戦闘ステップが、攻撃クリーチャーの指定 → ブロックの指定 → (先制攻撃ダメージ) → 戦闘ダメージ → 終了 の段階(`Game.combatPhase`)で進む。攻撃が無ければ、いままでどおり飛ばす。入口は `declareAttackers`(攻撃先はプレイヤーかプレインズウォーカー)・`declareBlockers`。キーワード: 飛行・到達・威嚇・警戒・防衛・速攻・先制攻撃・二段攻撃・接死・絆魂・トランプル・破壊不能。召喚酔い(`Perm.enteredTurn` / `Game.turn`。攻撃と {T} のコストの能力)。ダメージは `damage.ts` の `dealDamage` 1か所(`damage` ノードも同じ。接死・絆魂が効く)。誘発のきっかけ `when event=attacks / blocks`。限界: ダメージの割り振りは宣言の順に致死ダメージ(選べない)、ブロッカー1体のブロック先は1体だけ、攻撃・ブロックの要件(「〜は攻撃できない」「できるなら攻撃する」)・戦闘ダメージを与えたときの誘発・「戦闘に入る」などの誘発は未対応。
3. **第10弾(実装済み)**: ターンの進行。`Game.strictTurns`(真のとき: ドロー・ステップにアクティブ・プレイヤーが1枚引く(ゲームの最初のターンを除く。「ドロー・ステップの開始時」の誘発より先)・ステップと戦闘の段階の終わりにマナ・プールが空になる(色つき・制限つきも)・終了ステップの終わりに手札を 7 枚まで捨てる)。偽(既定)のときは、いままでどおり。`startGame(g, rules, first)` が、手札を 7 枚ずつ引いて、厳密なターンで先手のターン 1 の維持ステップから始める。引くための共通の処理 `drawCards` / `discardCards`(`draw` / `discard` ノードも使う)。限界: マリガン・先手後手の決め方・ライブラリーを切る処理は未対応(呼び出し側が切って渡す)。追加ターン・ターンの飛ばしは未対応。
4. **対戦の画面** — エンジンが固まってから。判断の入力 (`Decider`) の置き換えもここ。
5. **第11弾(実装済み)**: 準備 (prepared)。ルールの出典は Scryfall の裁定 (2026-03-20)。能力の種類 `準備呪文`(`## 準備呪文`。最初のノード `prepareSpell name type manaCost`)・`entersPrepared`(常在型)・`prepare`(準備済になる。準備呪文を持たないものはなれない・すでに準備済なら何も起きない)・`exile`(墓地から追放。`optional` で「してもよい」)・条件 `if=$名前`(前のノードの出力が 0・偽・空でないとき。「そうしたなら」)。`Perm.prepared` / `Game.exile` / `StackItem.copy`(呪文のコピー。解決しても打ち消されても、墓地に行かず消える)。入口 `castPrepared(g, p, permId, targets, rules)`(準備済のクリーチャーのコントローラーだけ。唱えると準備済でなくなる。戦場を離れると準備済も消える)。→ Emeritus of Ideation。限界: 準備済になる・ならなくなる効果のうち、他のクリーチャーを準備済にするもの・準備済でなくすものは未対応、追放するカードは墓地の古い順 (選べない)。

準備済(Emeritus)は、ルールの正本を確認するまで扱わない。

## デッキ2: Bant Hatebears (ビンテージ) のノード (2026-11-06、ユーザー依頼)

デッキ 36 枚中、ルールが動くのは 10 枚だけ (Mox・Black Lotus・Ancestral Recall・デュアルランドなど)。残り 26 枚は、`## 未対応` に、足りない効果が書いてある。方針は、これまで通り**特定のカード専用のノードを作らず、組み合わせで効く部品**を足す。足りない部品を、効く枚数の多い順・作りやすい順に並べる。

| 弾 | 足す部品 (汎用) | 動くようになるカード (枚数) | 手間 |
|---|---|---|---|
| A-1 (実装済み 0.102.0) | `shuffle` (ライブラリーを切る。ゲームの乱数 `Game.rngState` は、種から決まる: リプレイで同じ結果)。自分の手札を渡すだけの `lookHand` は、見せない・ログに出さない。手札から選んで、ライブラリーの上に置く (`lookHand` + `choose` + `move to=top`。置く順は入力済み) | Brainstorm (1)・Ponder (1)・Gitaxian Probe の「手札を見る」(1) | 小 |
| A-2 (実装済み 0.103.0) | `search` (ライブラリーから、条件に合うカードを探して、戦場・手札へ。切る)。`cost life=N` (ライフを払うコスト)。`destroy` (パーマネントを破壊) | Misty Rainforest (3)・Windswept Heath (3)・Strip Mine (1)・Wasteland (4)・Force of Vigor の破壊 (1+3) | 中 |
| A-3 (実装済み 0.105.0) | `exile` を戦場のパーマネントにも (対象)。「そのパワーに等しいライフ」(値の参照: 対象のパワー・マナ総量) | Swords to Plowshares (2+2)・Prismatic Ending (1+2) の一部 | 中 |
| A-4 (実装済み 0.106.0) | `addMana` で、色の候補を選ぶ (`colors=GWU`)。`when event=attacks` に「1体だけで攻撃」の条件 + `modify` (Exalted) | Noble Hierarch (4) | 中 |
| B-1 (実装済み 0.107.0) | **別のコストで唱える** (`altCost`: 手札の色つきカードを追放・ライフを払う・自分のターンでないとき)。唱えるときに選ばせる (追加コストの選択と同じ入口) | Force of Will (4)・Force of Negation (1)・Force of Vigor (1+3) | 大 |
| B-2 (実装済み 0.108.0) | **Delve** (墓地のカードを追放して、コストを払う)・**Phyrexian マナ** ({U/φ}: 2 ライフで払う)・**Storm** (それまでに唱えた呪文の数・呪文のコピー)・**Converge** (マナの色の数) | Dig Through Time (1)・Treasure Cruise (1)・Gitaxian Probe (1)・Flusterstorm (2)・Prismatic Ending (1+2) | 大 |
| C (実装済み 0.109.0) | **「できない」「かわりに」の枠** (制限・置換): 「各プレイヤーは、1ターンに、呪文を2つ以上唱えられない」「戦場に出るとき、タップ状態で」「アーティファクトの起動型能力は、起動できない」「X のマナ総量より大きい呪文は唱えられない」「墓地・ライブラリーから、クリーチャーは戦場に出られない」。`extraTriggers` (すべてに「アップキープに、〜払わなければ、生け贄」) | Archon of Emeria (3)・Collector Ouphe (3)・Lavinia (2)・Grafdigger's Cage (3 サイド)・Energy Flux (2 サイド)・The Tabernacle (2 サイド) | 大 |
| D (実装済み 0.110.0) | 個別だが、汎用にできるもの: **追加ターン** (Time Walk)・Oko の −5 (コントロールの交換) と Food の能力・Endurance (墓地を、底に、ランダムな順で。召喚者に、追放して唱える代替コスト)・Sylvan Library (ドロー・ステップに、追加で引いて、ライフか上に置く) | Time Walk (1)・Oko (3)・Endurance (3+1)・Sylvan Library (1) | 中〜大 |

おすすめの進め方: A-1 → A-2 → A-3 → A-4 を、1弾ずつ、テスト・レビュー・リリースの順で。A だけで、14 種類・約 25 枚 (デッキの 3 割) が、動くようになる。B-1 (別のコスト) は、Force of Will の 4 枚と、デッキの核なので、次に。C は、制限の枠を、1つ作って、6 種類をまとめて通す。

## デッキ3: Dredge (ビンテージ) のノード (2026-11-06、ユーザー依頼)

デッキ (`Decks/Dradge.md`) 18 種類・60 枚のうち、ルールがあるのは Force of Will・Force of Negation・Mental Misstep・Force of Vigor・Strip Mine の 5 種類 (別のコスト・サイドの Strip Mine)。残り 18 種類は、`Rules/` が無い。方針は同じで、**カード専用のノードを作らず、組み合わせで効く部品**を足す。いまのエンジンは、誘発型能力が「戦場のパーマネント」のイベント (`cast / enters / leaves / step / attacks / blocks`) だけで、**墓地・ライブラリー・手札にあるカードの能力**と、**カードのゾーン移動のイベント**が無い。ここが、Dredge の土台。

| 弾 | 足す部品 (汎用) | 動くようになるカード | 手間 |
|---|---|---|---|
| DR-1 (実装済み 0.123.0) | **ゾーン移動のイベント**: `when event=moved from=library to=graveyard` (ライブラリーから墓地へ)・`event=leaves to=graveyard` (死亡)・`event=enters from=graveyard` (墓地から出た)。**墓地・手札にあるカード自身の誘発** (`when zone=graveyard`)。`mill` (上から N 枚を墓地へ)。`move` の `to=battlefield tapped=true` | Narcomoeba・Creeping Chill・Golgari Thug (死亡)・Ichorid (アップキープ、墓地から)・Silversmote Ghoul (終了ステップ、墓地から) の誘発の土台。実装: `when event=moved/enters/leaves` に from・to、`when zone=graveyard`、`mill`、`move to=battlefield tapped= optional=`、`target zone=graveyard kind=card`、`exile` が墓地のカードも、`damage player=opponents`。shortcut: 墓地のカードを対象にする呪文を、人が唱えるときの画面の選択は、まだ (誘発の対象は自動) | 大 |
| DR-2 (実装済み 0.124.0) | **Dredge** (引く代わりに、上から N 枚を墓地に置いて、このカードを手札に戻す。引くときに選ばせる: ドロー・ステップ・「引く」効果のすべて)。置換の枠 (`restrict.ts` の「かわりに」) を、「引く」にも | Stinkweed Imp・Golgari Thug・Shambling Shell・Golgari Grave-Troll (計 4 種・13 枚) + Bazaar of Baghdad (引く・捨てる)。実装: 常在型 `dredge amount=N`・`drawCards(rules)` が、引くたびに `Decider.dredge` で選ばせる (人には、`choose` の質問 0〜1 枚)。shortcut: CPU・AI 相手は、Dredge しない。ログの「カードを引いた」は、Dredge したときも出る | 大 |
| DR-3 (実装済み 0.125.0) | **戦闘ダメージを与えたときの誘発** (`when event=damaged`: 与えた側・受けた側の型で絞る。Stinkweed Imp の「クリーチャーに戦闘ダメージを与えたら、それを破壊」。計画の見落とし)・遅延誘発 (「次の終了ステップの開始時に」)・「このターンにライフを得た量」・「〜したら (if you do)」の連鎖 | Stinkweed Imp の誘発・Ichorid (追放→戻る・終了時に生け贄)・Prized Amalgam (墓地から出たら、次の終了時に戻る)・Silversmote Ghoul (3 点以上ライフを得たら)・Grief の誘発 (手札を見て選ばせて捨てさせる) 。実装: `when event=damaged (self combat hit)`・`delay step=`・`lifeGained`・`filter color= except=`・`discard cards=`。`when` の step は self を無視。shortcut: 「墓地から唱えた」(Prized Amalgam の後半)は、まだ。割り込みの「if (介入 if)」は、解決時にだけ見る | 中 |
| DR-4 (実装済み 0.126.0) | **別のコストの拡張**: 手札から黒いカードを追放 (X はそのマナ総量)・「このターンに、相手が 3 つ以上呪文を唱えた」ときの 0 マナ。**Evoke** (別のコストで唱え、出たら生け贄に) | Grief (4)・Sickening Shoal (4 サイド)・Mindbreak Trap (サイド) 。実装: `altCost exileX=true` (X = 追放したカードのマナ総量)・`altCost oppSpells=N`・`math`・`exile` がスタックの呪文も。Evoke は、`altCost` + 出たとき `if=alt` の `sacrifice` で足りた (新しい部品なし) | 中 |
| DR-5 (実装済み 0.127.0) | **カウンター・X・唱えた数の参照**: X 個のカウンターつきで出る・唱えた呪文のマナ総量とカウンターの数を比べて打ち消す・「戦場に出るとき、墓地のクリーチャー・カード 1 枚につきカウンター」・カウンターを取り除くコストと、**再生** (regenerate: 再生の盾。Golgari Grave-Troll) | Chalice of the Void (1)・Golgari Grave-Troll の ETB 。実装: `entersWith (x / count / zone+type)`・`counterCount`・`statOf` がスタックの呪文の mv も・`cost removeCounter=`・`regenerate` (再生の盾。破壊・致死ダメージを防ぐ。ターン終了で消える)・`addCounter` の kind は自由な名前 | 中 |
| DR-6 (実装済み 0.128.0) | **サイクリングと「捨てた・サイクリングした数」**: 手札から起動する能力・コストの軽減 (このターンに捨てた・サイクリングしたカード 1 枚につき {2} 安く)。Phyrexian マナつきの呪文の対象 (墓地のカードを、ライブラリーの上に置く)。Noxious Revival | Hollow One (4)・Noxious Revival (4) 。実装: `cost discardSelf=true` (手札から起動。エンジン `activateFromHand`・画面は手札を 1 回クリックで一覧)・`Game.discarded` (捨てた・サイクリングした数。ターンで 0)・`reduceCost self=true per=discarded`・墓地のカードが対象の呪文の、人の対象選択 (カードの一覧)。shortcut: CPU・AI 相手は、サイクリングしない | 中 |
| DR-7 (実装済み 0.129.0) | **置換: 相手の墓地に行くカードを、かわりに追放**・開始時の手札から、戦場に出して始める (Leyline)・Serum Powder の「マリガンの代わりに、手札を追放して、同じ枚数引く」(マリガンの画面に、手札のカードの能力を出す) | Leyline of the Void (4 サイド)・Serum Powder (4) | 中〜大 。実装: `exileInstead who=opponents|you|all` (墓地に行くカードのかわりに追放。`putInGraveyard` が行き先を返し、`leaves` の to にも反映)・`startOnBattlefield` (マリガンのあと、いつも戦場に出す)・`mulliganExile` (Serum Powder: マリガンの画面にボタン。マリガンの回数に数えない)。shortcut: Leyline は「してもよい」でなく、いつも出す。置換は、出たときに写すだけ (能力を失っても残る) |

おすすめの進め方: DR-1 → DR-2 を、先に (土台と、デッキの顔)。ここが動けば、墓地から戻る・引く代わりに掘る、動きが、対戦で見られる。DR-3 以降は、カードごとに、1弾ずつ。Grafdigger's Cage の「墓地・ライブラリーから呪文を唱えられない」は、Rules の「未対応」のまま (戦場に出られない方だけ動く)。墓地から唱えるカードは、このデッキには、ほぼ無いので、DR 系の後ろに、「墓地から唱える」(`cantCast from=graveyard`) として足す。

## あとでまとめて書くもの

- シナリオ (`src/battle/samples.ts` の `SCENARIOS`。動いた記録): 無いカードは Chandra, Chill of Compliance / The Theorist, Jace Beleren / Into the Roil / Island / Octopus Form / We Say Thee Nay! (打ち消し3種だけある)。無いと `Battle: rules coverage` で partial になる。

- 対戦の画面のサイドバー統合 (ユーザー依頼 2026-11-05、急がない): カードプレビューと対戦ログを、BattleView 内の右カラムではなく Obsidian のサイドバー機能に載せる。対戦を始めるとサイドバーが開き、対戦用のサイドバーアイコンが追加される。対戦のタブを閉じると、アイコンごと消えてサイドバーも閉じる。デッキ作成画面に同じ動きの実装がある (DeckView 周辺) ので、それと同じ作りにする。
- 雑魚 CPU のマリガン (ユーザー依頼 2026-11-05、段階5): 手札の土地が N 枚以上、かつ、コストの低いカードがあればキープ。そうでなければマリガン (ロンドン)。基準は設定で変えられる。`BattleController.mulligan/keep/bottom` と同じ入口を CPU も使う。
- AI 自身のデッキ別「AI ルール」 (ユーザーの構想 2026-11-05、段階7〜8のあと): AI が、リプレイから学習して、デッキごとのマークダウン (動かし方・コンボ・マリガンの基準) を作り、対戦ごとに読んで、書き直して、自己調整する。
- ターンのルールの修正予定 (note の解説 https://note.com/kunichu/n/ne348d4f22d1b との照合、2026-11-05。エンジンの現状との違い3点):
  1. 戦闘ダメージの割り振り: (実装済み 段階6b 前半) 攻撃側が `assignDamage` で自由に割り振れる。選ばなければ、宣言の順に致死ダメージ。
  2. 誘発の順番 (APNAP): アクティブ・プレイヤーの誘発が先、次に非アクティブ・プレイヤー。同じプレイヤーの複数の誘発は、そのプレイヤーが順番を選ぶ (いまは戦場の順)。
  3. クリンナップの再発生: クリンナップ中に誘発が起きた・手札が 8 枚以上になったときは、もう一度クリンナップ (いまは 1 回だけ)。
