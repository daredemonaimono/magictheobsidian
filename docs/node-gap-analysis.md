# 人気カードの効果と、ノードの対応状況

> 自動で作った分析です (2026-11-08)。`scripts/node-gap-analysis/` で、もう一度作り直せます。「効果の分類」は、オラクルテキストを、文字のパターンで分けた、おおまかな見積もりです。数字は、目安として読んでください。

## 目的

人気のカードに採用されている効果のうち、いまのノード (104 個) で書けないものを洗い出して、**次に作るノードの優先順位**を決める。

## 調べたカード

Scryfall の人気順 (EDHREC の順位) で、統率戦・モダン・スタンダード・レガシーの上位から集めた、重複なしの **777 枚**。基本土地は除く。人気の順位は、統率戦の人気なので、**統率戦で好まれるカード (マナ加速・土地・除去・ドロー) に偏っています**。構築戦の人気は、別の資料 (MTGGoldfish など) が要ります。

## 対応率

- **書ける**: そのカードの効果が、すべて、いまのノードで書ける。
- **ほぼ書ける**: 一部の効果が、簡単な形だけ書ける (「一部」を含む)。

| 範囲 | 枚数 | 書ける | ほぼ書ける |
|---|---|---|---|
| 全部 | 777 | 553 (71%) | 679 (87%) |
| 統率戦 (人気上位 525 枚) | 525 | 399 (76%) | 461 (87%) |
| 　うち上位 100 枚 | 100 | 82 (82%) | 85 (85%) |
| モダン (人気上位 350 枚) | 350 | 273 (78%) | 319 (91%) |
| 　うち上位 100 枚 | 100 | 85 (85%) | 89 (89%) |
| スタンダード (人気上位 350 枚) | 350 | 236 (67%) | 306 (87%) |
| 　うち上位 100 枚 | 100 | 83 (83%) | 90 (90%) |
| レガシー (人気上位 350 枚) | 350 | 271 (77%) | 307 (87%) |
| 　うち上位 100 枚 | 100 | 79 (79%) | 82 (82%) |

効果の行は全部で 1534 行。パターンに当てはまらなかった行は 25 行 (1%)。

## 次に作るノードの優先順位

「**それだけで書けるようになるカード**」は、そのタグが、そのカードの、**唯一の足りない部分**であるときの枚数。多いほど、作る効果が大きい。

| 順位 | 足りない効果 | 状態 | それだけで書ける | 出てくるカード | 提案 |
|---|---|---|---|---|---|
| 1 | そのほかの置換効果 (もし〜なら かわりに) | 一部だけ | 25 枚 | 35 枚 (Doubling Season、Elspeth, Storm Slayer、The Earth Crystal、Gemstone Caverns…) | modifyAmount (トークン・カウンター・ダメージ・ライフ・引く枚数の倍化) と exileInstead・entersWith。ほかの「かわりに」は、まだ |
| 2 | そのほかのキーワード処理 (extort・evolve・explore・amass・connive・bolster・adapt など) | 一部だけ | 21 枚 | 33 枚 (Dawn's Truce、Mosswort Bridge、Coruscation Mage、Beseech the Mirror…) | explore・amass・connive・bolster・investigate (Clue)・turnStat (raid・morbid)・graveyardTypes (delirium)。ほかのキーワード処理は、まだ |
| 3 | X を選ぶ呪文・能力 | 一部だけ | 20 枚 | 25 枚 (Craterhoof Behemoth、Esper Sentinel、Ghalta, Primal Hunger、Nature's Rhythm…) | X は選べる。数式の X は、限られる |
| 4 | ブロックされない・攻撃できない | 一部だけ | 18 枚 | 24 枚 (Rogue's Passage、Mistrise Village、Propaganda、Hexing Squelcher…) | cantBlock・cantBeBlocked・cantAttack・mustAttack。「打ち消されない」「負けない」などは、まだ |
| 5 | 「クリーチャー・タイプ」「カード名」などを選ぶ | 書けない | 10 枚 | 12 枚 (Three Tree City、Patchwork Banner、Secluded Courtyard、Banner of Kinship…) | 色だけ選べる (chooseColor) |
| 6 | 追放したカードをプレイしてよい | 一部だけ | 8 枚 | 16 枚 (Professional Face-Breaker、Bolas's Citadel、Muldrotha, the Gravetide、Bonehoard Dracosaur…) | exilePlay / castFromGraveyard (墓地・追放から唱える一部) |
| 7 | Partner / コマンダー関連 | 書けない | 8 枚 | 12 枚 (Command Tower、Arcane Signet、Path of Ancestry、Commander's Sphere…) | 統率戦は、対戦に使えない |
| 8 | ライフを得たとき・失ったとき誘発 | 書けない | 6 枚 | 7 枚 (Enduring Tenacity、Bloodthirsty Conqueror、Marauding Blight-Priest、Vito, Thorn of the Dusk Rose…) | ライフ増減のイベントが無い (このターンの量を読むだけ) |
| 9 | Crew・Saddle・Station (乗り物) | 書けない | 6 枚 | 7 枚 (Evendo, Waking Haven、Uthros, Titanic Godcore、Hedge Shredder、Adagia, Windswept Bastion…) | 乗り物 (タップして、クリーチャーになる) の仕組みが無い |
| 10 | 追加の土地を出せる | 書けない | 5 枚 | 9 枚 (Loot, Exuberant Explorer、Explore、Dryad of the Ilysian Grove、Azusa, Lost but Seeking…) | 土地を出せる回数を増やす仕組みが無い |
| 11 | ほかの誘発イベント (scry・tap・cycle・copy・proliferate など) | 一部だけ | 4 枚 | 10 枚 (Storm-Kiln Artist、Monument to Endurance、Archmage Emeritus、Utopia Sprawl…) | discard(手札→墓地)は書ける。それ以外はイベントが無い |
| 12 | Suspend / Foretell / Madness / Echo ほか特殊な唱え方 | 書けない | 4 枚 | 6 枚 (Cyclonic Rift、Vandalblast、Mystic Remora、Damn…) | 特殊な唱え方・維持の仕組みが無い |
| 13 | 能力のコピー・誘発を増やす | 一部だけ | 4 枚 | 6 枚 (Annie Joins Up、Panharmonicon、Windcrag Siege、Cloud, Midgar Mercenary…) | extraTriggers (誘発を増やす) だけ |
| 14 | オーラ (enchant ...) | 一部だけ | 4 枚 | 5 枚 (Imprisoned in the Moon、Animate Dead、Ethereal Armor、Sheltered by Ghosts…) | attach (出たとき付ける) |
| 15 | 対象の変更 | 書けない | 3 枚 | 6 枚 (Redirect Lightning、Bolt Bend、Thousand-Year Storm…) | 対象を変える node が無い |
| 16 | プロテクション | 書けない | 3 枚 | 5 枚 (The One Ring、Teferi's Protection、Mother of Runes…) | 無い (対象・ダメージ・ブロックを防ぐ) |
| 17 | 探して一番上に置く | 書けない | 3 枚 | 4 枚 (Vampiric Tutor、Enlightened Tutor、Mystical Tutor…) | search に to=top が無い |
| 18 | カウンターを取り除く・倍にする | 一部だけ | 3 枚 | 4 枚 (Mossborn Hydra、Bristly Bill, Spine Sower、Walking Ballista…) | cost removeCounter だけ (効果で取り除く node が無い) |
| 19 | 追加ターン・追加の戦闘 | 一部だけ | 3 枚 | 4 枚 (Aurelia, the Warleader、Genji Glove、Full Throttle…) | 追加のターンだけ。追加の戦闘は無い |
| 20 | 手札の上限の変更 | 書けない | 3 枚 | 4 枚 (Reliquary Tower、Thought Vessel、Decanter of Endless Water…) | 手札の上限を変える仕組みが無い |
| 21 | フラッシュバック | 書けない | 3 枚 | 3 枚 (Faithless Looting、Sevinne's Reclamation、Bulk Up…) | 唱えたあと追放する仕組みが無い (castFromGraveyard は唱えるだけ) |
| 22 | 「土地が出せる色・相手の土地が出せる色のマナ」 | 書けない | 3 枚 | 3 枚 (Exotic Orchard、Fellwar Stone、Reflecting Pool…) | 「コントロールする土地が出せる色」を読む仕組みが無い |
| 23 | 変身・両面カード (daybound など) | 書けない | 2 枚 | 5 枚 (Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun、Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel…) | 変身の仕組みが無い |
| 24 | Saga・Class・Case・Role など | 書けない | 2 枚 | 4 枚 (Urza's Saga、Not Dead After All…) | 章・レベルの仕組みが無い |
| 25 | トークンを作ったとき誘発 | 書けない | 2 枚 | 3 枚 (Mirkwood Bats、Kambal, Profiteering Mayor…) | トークン作成のイベントが無い |

## 順に作っていくと、書けるカードが、どれだけ増えるか

いまは 553 枚 (71%)。効果の大きい順に作ると:

| 作る順 | 効果 | 増える枚数 | 合計 |
|---|---|---|---|
| 1 | そのほかの置換効果 (もし〜なら かわりに) | +25 | 578 枚 (74%) |
| 2 | そのほかのキーワード処理 (extort・evolve・explore・amass・connive・bolster・adapt など) | +24 | 602 枚 (77%) |
| 3 | X を選ぶ呪文・能力 | +21 | 623 枚 (80%) |
| 4 | ブロックされない・攻撃できない | +20 | 643 枚 (82%) |
| 5 | 「クリーチャー・タイプ」「カード名」などを選ぶ | +11 | 654 枚 (84%) |
| 6 | 追放したカードをプレイしてよい | +9 | 663 枚 (85%) |
| 7 | Partner / コマンダー関連 | +9 | 672 枚 (86%) |
| 8 | 追加の土地を出せる | +8 | 680 枚 (87%) |
| 9 | Crew・Saddle・Station (乗り物) | +7 | 687 枚 (88%) |
| 10 | 能力のコピー・誘発を増やす | +6 | 693 枚 (89%) |
| 11 | ライフを得たとき・失ったとき誘発 | +6 | 699 枚 (89%) |
| 12 | ほかの誘発イベント (scry・tap・cycle・copy・proliferate など) | +6 | 705 枚 (90%) |
| 13 | 変身・両面カード (daybound など) | +5 | 710 枚 (91%) |
| 14 | 対象の変更 | +5 | 715 枚 (92%) |
| 15 | プロテクション | +5 | 720 枚 (92%) |

## 提案する部品 (大きい順)

### 1. そのほかの置換効果 (もし〜なら かわりに)

- それだけで書けるようになる: **25 枚** / 出てくる: 35 枚
- いまの状態: modifyAmount (トークン・カウンター・ダメージ・ライフ・引く枚数の倍化) と exileInstead・entersWith。ほかの「かわりに」は、まだ
- 提案: **置換効果の部品**: 「〜なら、かわりに〜」を、ダメージ・引く・戦場に出る・墓地に置く、の4つの入口に分けて、`replace event=... with ...` の形で書けるようにする。設計が要るので、先に仕様を決める。
- 例: Doubling Season、Jeska's Will、Elspeth, Storm Slayer、The Earth Crystal、Into the Flood Maw、Gemstone Caverns、Innkeeper's Talent、Hardened Scales

### 2. そのほかのキーワード処理 (extort・evolve・explore・amass・connive・bolster・adapt など)

- それだけで書けるようになる: **21 枚** / 出てくる: 33 枚
- いまの状態: explore・amass・connive・bolster・investigate (Clue)・turnStat (raid・morbid)・graveyardTypes (delirium)。ほかのキーワード処理は、まだ
- 提案: **キーワード処理の組み合わせノード**: explore・amass・connive・investigate・populate・incubate などは、いまあるノードの組み合わせ (カウンター・トークン・見る・捨てる) で書ける。コードを書かずに、「組み合わせノード」として、データで定義して配る形にできる。条件の語 (raid・revolt・morbid・threshold・delirium) は、`条件ノード` (そのターンの出来事・墓地の内訳) として足す。
- 例: Dawn's Truce、Return the Favor、Into the Flood Maw、Chimil, the Inner Sun、Mosswort Bridge、Coruscation Mage、Rhythm of the Wild、Beseech the Mirror

### 3. X を選ぶ呪文・能力

- それだけで書けるようになる: **20 枚** / 出てくる: 25 枚
- いまの状態: X は選べる。数式の X は、限られる
- 提案: **数式の X**: X を、`math` で計算して、各ノードに渡せるようにする (いまは X そのものだけ)。
- 例: Craterhoof Behemoth、Esper Sentinel、Ghalta, Primal Hunger、Nature's Rhythm、The Great Henge、Gray Merchant of Asphodel、Krenko, Mob Boss、Anim Pakal, Thousandth Moon

### 4. ブロックされない・攻撃できない

- それだけで書けるようになる: **18 枚** / 出てくる: 24 枚
- いまの状態: cantBlock・cantBeBlocked・cantAttack・mustAttack。「打ち消されない」「負けない」などは、まだ
- 提案: **回避・制限の部品**: `cantBeBlocked` (全体・特定の型にだけ)・`mustAttack`・`cantAttack` を、継続効果と、条件つきで足す。`cantBlock` は、すでにある。
- 例: Rogue's Passage、Cavern of Souls、Untimely Malfunction、Mistrise Village、Propaganda、Hexing Squelcher、Delighted Halfling、Ghostly Prison

### 5. 「クリーチャー・タイプ」「カード名」などを選ぶ

- それだけで書けるようになる: **10 枚** / 出てくる: 12 枚
- いまの状態: 色だけ選べる (chooseColor)
- 提案: **種類を選ぶ**: `chooseType kind=creatureType|cardType|basicLandType` を足す。選んだものは、`affect type=chosen` で使う (`chooseColor` と同じ形)。
- 例: Cavern of Souls、Roaming Throne、Three Tree City、Patchwork Banner、Secluded Courtyard、Banner of Kinship、Herald's Horn、Unclaimed Territory

### 6. 追放したカードをプレイしてよい

- それだけで書けるようになる: **8 枚** / 出てくる: 16 枚
- いまの状態: exilePlay / castFromGraveyard (墓地・追放から唱える一部)
- 提案: **追放してプレイ**: `exilePlay` を広げる (土地もプレイできる・期限を指定できる・「このカードで追放したカード」を覚える)。墓地・ライブラリーの上から唱える効果も、同じ仕組みで書く。
- 例: Jeska's Will、Icetill Explorer、Professional Face-Breaker、Bolas's Citadel、Muldrotha, the Gravetide、Ragavan, Nimble Pilferer、Bonehoard Dracosaur、Chandra, Torch of Defiance

### 7. Partner / コマンダー関連

- それだけで書けるようになる: **8 枚** / 出てくる: 12 枚
- いまの状態: 統率戦は、対戦に使えない
- 提案: **統率戦の対戦**: 統率戦のデッキは、まだ対戦に使えません (コマンダーの扱い・コマンダー・タックスが要る)。ノードではなく、対戦の仕組みの仕事です。
- 例: Command Tower、Arcane Signet、Path of Ancestry、Commander's Sphere、Deflecting Swat、Fierce Guardianship、Deadly Rollick、Jeska's Will

### 8. ライフを得たとき・失ったとき誘発

- それだけで書けるようになる: **6 枚** / 出てくる: 7 枚
- いまの状態: ライフ増減のイベントが無い (このターンの量を読むだけ)
- 提案: **ライフのイベント**: `when event=lifegain / lifeloss` を足す (そのターンの量を読む `lifeGained`・`lifeLost` は、すでにある)。
- 例: Enduring Tenacity、Bloodthirsty Conqueror、Marauding Blight-Priest、Exemplar of Light、Vito, Thorn of the Dusk Rose、Sanguine Bond、Exquisite Blood

### 9. Crew・Saddle・Station (乗り物)

- それだけで書けるようになる: **6 枚** / 出てくる: 7 枚
- いまの状態: 乗り物 (タップして、クリーチャーになる) の仕組みが無い
- 提案: **乗り物**: `crew N` (タップして、そのターン、クリーチャーになる)。`becomes` (そのターンだけ) と `cost tapCreatures` の組み合わせで近づける。
- 例: Evendo, Waking Haven、Uthros, Titanic Godcore、Hedge Shredder、The Eternity Elevator、Adagia, Windswept Bastion、Sram, Senior Edificer、Susur Secundi, Void Altar

### 10. 追加の土地を出せる

- それだけで書けるようになる: **5 枚** / 出てくる: 9 枚
- いまの状態: 土地を出せる回数を増やす仕組みが無い
- 提案: **追加の土地**: `extraLand count=N` (そのターンに出せる土地の数を増やす)。
- 例: Icetill Explorer、Loot, Exuberant Explorer、Explore、Dryad of the Ilysian Grove、Azusa, Lost but Seeking、Exploration、Case of the Locked Hothouse、Ramunap Excavator

### 11. ほかの誘発イベント (scry・tap・cycle・copy・proliferate など)

- それだけで書けるようになる: **4 枚** / 出てくる: 10 枚
- いまの状態: discard(手札→墓地)は書ける。それ以外はイベントが無い
- 提案: **イベントの追加**: scry・surveil・cycle・copy・proliferate・investigate・explore などのイベントを足す。
- 例: Terrasymbiosis、Storm-Kiln Artist、Monument to Endurance、Archmage Emeritus、Wild Growth、Exemplar of Light、Anim Pakal, Thousandth Moon、Utopia Sprawl

### 12. Suspend / Foretell / Madness / Echo ほか特殊な唱え方

- それだけで書けるようになる: **4 枚** / 出てくる: 6 枚
- いまの状態: 特殊な唱え方・維持の仕組みが無い
- 提案: **特殊な唱え方**: foretell・suspend・madness・echo などは、1 つずつ別の仕事 (出た数が少ない順に、あとで)。
- 例: Cyclonic Rift、Vandalblast、Mystic Remora、Ragavan, Nimble Pilferer、Damn、Ephemerate

### 13. 能力のコピー・誘発を増やす

- それだけで書けるようになる: **4 枚** / 出てくる: 6 枚
- いまの状態: extraTriggers (誘発を増やす) だけ
- 提案: **能力のコピー**: `copyAbility` (スタックの能力をコピー)。
- 例: Roaming Throne、Delney, Streetwise Lookout、Annie Joins Up、Panharmonicon、Windcrag Siege、Cloud, Midgar Mercenary

### 14. オーラ (enchant ...)

- それだけで書けるようになる: **4 枚** / 出てくる: 5 枚
- いまの状態: attach (出たとき付ける)
- 提案: **オーラ**: `enchant 型` の宣言と、付ける対象を選ぶ唱え方 (いまは、出たときに付ける形だけ)。
- 例: Imprisoned in the Moon、Wild Growth、Animate Dead、Ethereal Armor、Sheltered by Ghosts

### 15. 対象の変更

- それだけで書けるようになる: **3 枚** / 出てくる: 6 枚
- いまの状態: 対象を変える node が無い
- 提案: **対象の変更**: `changeTarget target=$spell` を足す。
- 例: Untimely Malfunction、Deflecting Swat、Redirect Lightning、Bolt Bend、Return the Favor、Thousand-Year Storm

### 16. プロテクション

- それだけで書けるようになる: **3 枚** / 出てくる: 5 枚
- いまの状態: 無い (対象・ダメージ・ブロックを防ぐ)
- 提案: **プロテクション**: 対象にできない・ダメージを受けない・ブロックされない・付けられない、の4つの制限の組み合わせとして、`protection from=色/型` を足す。
- 例: The One Ring、Teferi's Protection、Akroma's Will、Commander's Plate、Mother of Runes

### 17. 探して一番上に置く

- それだけで書けるようになる: **3 枚** / 出てくる: 4 枚
- いまの状態: search に to=top が無い
- 提案: **探して上に置く**: `search` に `to=top` を足す。
- 例: Vampiric Tutor、Enlightened Tutor、Mystical Tutor、Insatiable Avarice

### 18. カウンターを取り除く・倍にする

- それだけで書けるようになる: **3 枚** / 出てくる: 4 枚
- いまの状態: cost removeCounter だけ (効果で取り除く node が無い)
- 提案: **カウンターの取り除き・倍**: `removeCounter` (効果)・`doubleCounters`・`proliferate`。
- 例: Wishclaw Talisman、Mossborn Hydra、Bristly Bill, Spine Sower、Walking Ballista

### 19. 追加ターン・追加の戦闘

- それだけで書けるようになる: **3 枚** / 出てくる: 4 枚
- いまの状態: 追加のターンだけ。追加の戦闘は無い
- 提案: **追加の戦闘**: `extraCombat`。
- 例: Aurelia, the Warleader、Genji Glove、Great Train Heist、Full Throttle

### 20. 手札の上限の変更

- それだけで書けるようになる: **3 枚** / 出てくる: 4 枚
- いまの状態: 手札の上限を変える仕組みが無い
- 提案: **手札の上限**: `handSize N / none` を足す。
- 例: Reliquary Tower、Thought Vessel、Finale of Revelation、Decanter of Endless Water

## すでに書ける効果 (参考: 出てくる回数の多い順)

- 起動型能力 (コスト: 効果): 323 枚
- マナを加える: 275 枚
- タップ状態で出る: 148 枚
- カードを引く: 114 枚
- 出たとき誘発: 74 枚
- 切る: 72 枚
- ライブラリーから探す: 71 枚
- 基本のキーワード (飛行・先制攻撃・速攻など): 70 枚
- トークンを作る: 69 枚
- 戦場に出す: 64 枚
- 数で変わる修整 (「〜1つにつき +1/+1」): 63 枚
- ダメージ: 57 枚
- ライフを得る: 47 枚
- カウンターを置く: 47 枚
- 追放: 46 枚

## 注意

- 効果の分類は、文字のパターンです。1 枚のカードが、実際には書けても「書けない」とされたり、その逆もあります。優先順位を決める目安として使い、作るときは、そのカードの実際のテキストで、確かめてください。
- 「ほぼ書ける」の中には、「簡単な形なら書ける」ものも含みます。
- 人気の順位は、統率戦の偏りがあります。構築戦 (モダン・レガシー・ヴィンテージ) の、実際のデッキリスト (MTGGoldfish・Melee など) を足すと、精度が上がります。
- 分類できなかった行の例 (パターンの追加の手がかり):
  - Rishkar's Expertise: you may cast a spell with mana value 5 or less from your hand without paying its mana cost.
  - Utopia Sprawl: enchant forest
  - Leyline of the Guildpact: each nonland permanent you control is all colors.
  - Taurean Mauler: changeling
  - Maskwood Nexus: creatures you control are every creature type. the same is true for creature spells you control and 
  - Innkeeper's Talent: permanents you control with counters on them have ward {1}.
  - Oracle of Mul Daya: play with the top card of your library revealed.
  - Blasphemous Edict: you may pay {b} rather than pay this spell's mana cost if there are thirteen or more creatures on th
  - Flashback: target instant or sorcery card in your graveyard gains flashback until end of turn. the flashback co
  - Bulk Up: double target creature's power until end of turn.
  - Electro, Assaulting Battery: you don't lose unspent red mana as steps and phases end.
  - Spelunking: lands you control enter untapped.
  - Omniscience: you may cast spells from your hand without paying their mana costs.
  - Agatha's Soul Cauldron: creatures you control with +1/+1 counters on them have all activated abilities of all creature cards
  - Hedge Shredder: whenever one or more land cards are put into your graveyard from your library, put them onto the bat
