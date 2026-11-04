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

## あとでまとめて書くもの

- シナリオ (`src/battle/samples.ts` の `SCENARIOS`。動いた記録): 無いカードは Chandra, Chill of Compliance / The Theorist, Jace Beleren / Into the Roil / Island / Octopus Form / We Say Thee Nay! (打ち消し3種だけある)。無いと `Battle: rules coverage` で partial になる。
