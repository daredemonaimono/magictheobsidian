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
| Island | ○ | —(`cost tap` + `addMana`、実装済み。戦場に出す処理は第3弾) |
| Bender's Waterskin | △ | アンタップ・ステップの変更(常在型) |
| Brineborn Cutthroat / Elementalist Adept | × | 誘発型(呪文を唱えた時)、カウンター、果敢、瞬速 |
| Cryogen Relic | × | 誘発型(出た時/離れた時)、起動型(生け贄)、麻痺カウンター |
| Geist of Saint Thalia | × | 飛行、コスト軽減(常在型) |
| Illvoi Light Jammer / Wizard's Staff | × | 装備、付ける、誘発の追加(常在型) |
| Chandra / The Theorist, Jace Beleren | × | 忠誠度能力、紋章、トークン、諜報、各対戦相手 |
| Witness Protection | × | オーラ、レイヤー(全能力を失う、色・種別・名前・基本P/T) |
| Emeritus of Ideation // Ancestral Recall | × | 準備済(ルールの正本を確認してから) |

## 順番

1. **第1弾(スタックの呪文だけで、組めるカードを増やす)**
   - 条件 `if=`(`kicked` / `teamwork`、否定は `!`)。ノード1つ1つに付けられる、汎用のつなぎの言葉。
   - `tap` / `untap`、`target` の `controller` 絞り込み、`tapped` 状態。
   - `modify`(修整)と `grant`(キーワードを得る)に、持続「ターン終了時まで」。呪禁は、相手の対象を実際に止める。
   - → Into the Roil、We Say Thee Nay!、Octopus Form が組める。
2. **第2弾(実装済み)**: モード選択(`choose`)、1〜2体の対象、集合の選択(`select`)、上から見る・選ぶ・底に置く。→ Confusticate、Amazing Acrobatics、Accumulate Wisdom、Aetherize。
3. **コストの仕組み(実装済み)**: `cost` / `additionalCost` / `addMana`(置き場所の検査つき:`cost` は起動型能力だけ、`additionalCost` は呪文能力だけ。値は 0 以上)、起動型能力の起動(マナ能力は即座に、それ以外はスタック)。マナの色の区別と、カード自体のマナコストの支払いは、まだ。
4. **第3弾**: 戦場に出る処理(クリーチャー・アーティファクト・土地が戦場に置かれる)、誘発型の枠(イベント)、麻痺カウンター・カウンターを置く。→ Island(戦場に出す)、Cutthroat、Adept、Cryogen Relic。
5. **第4弾**: 常在型(キーワード・コスト軽減・継続効果)、装備・オーラ、レイヤー。→ Geist、Light Jammer、Wizard's Staff、Witness Protection。
6. **第5弾**: 忠誠度能力・トークン・紋章。→ Chandra、Jace。

準備済(Emeritus)は、ルールの正本を確認するまで扱わない。
