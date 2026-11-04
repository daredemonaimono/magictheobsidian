# 対戦の画面 段階1: 盤面を見るだけ(実装計画)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サンプルの局面(本物の `Game`)を、斜め見下ろしの盤面で表示する画面を作る。操作はまだ無い。見た目と重さを、ユーザーが確認できる。

**Architecture:** `Game` → 画面に出す内容(`BoardModel`)への変換を、DOM を持たない純粋な関数(`src/battle/boardModel.ts`)に切り出して、`npm test` で確かめる。DOM を作る `BattleView`(`ItemView`)は、`BoardModel` を描くだけ。更新は、変わったカードだけを描き直す(キーつきの差分)。ホバーの前面表示は CSS だけ。

**Tech Stack:** TypeScript、Obsidian `ItemView`、CSS(`perspective` + `rotateX`)。テストは、既存の `node test/run.mjs`(esbuild で束ねて node で実行)。新しい依存は入れない。

**Spec:** `docs/superpowers/specs/2026-11-04-battle-ui-design.md`(段階1 = 7節の1。モックは `docs/superpowers/specs/2026-11-04-battle-ui-mockups/layout-main.html`)

## Global Constraints

- 既存の動きを壊さない。`npm test` は、常に全部通す。既存のテストは、書き換えない。
- 画面は、エンジンの状態(`Game`)を描くだけ。画面側にルールを持たない(例: 土地の枚数制限を数えない)。
- 画面クラス(`*View.ts`)のメンバー名は、Obsidian 本体の `open` `close` `load` などと重ねない(`test/viewnames.test.ts` が確かめる)。
- 盤面は HTML と CSS の立体表示(`perspective` + `rotateX`)。canvas・WebGL・重い描画ライブラリは使わない。依存の追加なし。
- ホバーの前面表示は CSS の `transform` だけ。アニメーションは `transform` と `opacity` だけ。盤面の更新は、変わったカードだけを描き直す。画像は `loading="lazy"`。画像は、ノートに保存済みの URL を使う(新しい通信をしない)。
- フェイズ表示は、公式の5フェイズ: 開始 / 戦闘前メイン / 戦闘 / 戦闘後メイン / 最終。ステップは、そのフェイズの中に小さく出す。
- サイドバー: 上 = カーソルを合わせたカードの画像と効果テキスト、下 = 対戦のログ。
- 左下 = 自分のアバターとライフ、右上 = 相手。自分の手札は手前に大きく(こちら向き)、相手の手札は奥に裏向き。赤い帯 = 戦闘のライン。攻撃クリーチャーは紫に光る。
- 段階1のサンプルの局面は、手書きの固定データではなく、`createGame` で作った本物の `Game`。
- ユーザーが確認するまで、コミット・push・リリースをしない(「リリースする」と言われたときだけ)。

## Review Focus

(各行のテストは、担当のタスクに書いてある。)

1. 手札・戦場・墓地が空の局面 → 空のゾーンを描き、エラーにならない(タスク1)。
2. 手札が 12 枚以上 / 相手の手札が 20 枚 → 手札の扇が幅からはみ出さない。相手の裏向きの手札は、10 枚までを描き、残りは数字(タスク1・4)。
3. 同じ列に 30 枚以上のパーマネント → 列が、はみ出さずに、重なって収まる(タスク4。`--n` で重なりを調整)。
4. 画像が無いカード・トークン → 名前と、P/T か、忠誠度の、代わりの表示(タスク1・4)。
5. ライフがマイナス・大きい数、ゲームが終わっている局面 → 数字がはみ出さず、勝敗のバナーが出る(タスク2)。

## File Structure

- Create `src/battle/boardModel.ts`: `Game` → `BoardModel`。DOM を持たない純粋な関数。
- Create `src/battle/sampleBattle.ts`: サンプルの局面を作る(`createGame` ベースの本物の `Game` と、手で作った `RuleBook`)。
- Create `src/BattleView.ts`: `BoardModel` を描く `ItemView`。ホバーのプレビュー、ログ、差分更新。
- Modify `styles.css`: `.mtg-bt-*` のスタイル(斜めの盤面、手札の扇、ホバーの前面表示、サイドバー)。
- Modify `src/main.ts`: 画面の登録(`BATTLE_VIEW`)とコマンド「Battle: open battle screen (sample)」。
- Test: `test/battle-boardmodel.test.ts`(新規)。`test/viewnames.test.ts` は、`BattleView.ts` を自動で見る(変更なし)。
- Modify `README.md`: 対戦の画面の説明(段階1)。

---

### Task 1: ゾーンと両陣営の表示内容(`boardModel`)

**Files:**
- Create: `src/battle/boardModel.ts`
- Test: `test/battle-boardmodel.test.ts`

**Interfaces:**
- Consumes: `Game`, `GameCard`, `Perm`, `RuleBook`, `PlayerId` (`src/battle/state.ts`); `characteristics(g, perm, rules)` (`src/battle/continuous.ts`: 継続効果をふまえた `typeLine` / `power` / `toughness` / `keywords`)。
- Produces:
  ```ts
  export interface CardView { id: string; name: string; typeLine: string; manaCost?: string; power: number | null; toughness: number | null; loyalty?: number; damage: number; counters: Record<string, number>; tapped: boolean; attacking: boolean; blocking: boolean; token: boolean; prepared: boolean; sick: boolean; keywords: string[]; image?: string }
  export interface SideView { player: PlayerId; life: number; library: number; graveyard: number; exile: number; handCount: number; hand: CardView[]; lands: CardView[]; creatures: CardView[]; others: CardView[] }
  export type ImageOf = (card: GameCard) => string | undefined
  export function sideView(g: Game, rules: RuleBook, player: PlayerId, imageOf: ImageOf, showHand: boolean): SideView
  ```
  `hand` は、`showHand` が偽(相手)なら空配列(`handCount` だけ)。列の分け方: 型行に Creature を含む → `creatures`(土地クリーチャーも)、そうでなく Land を含む → `lands`、それ以外(アーティファクト・エンチャント・プレインズウォーカー)→ `others`。順番は、`g.battlefield` の順。`sick` = `enteredTurn === g.turn` で、クリーチャーで、`haste` が無い。

- [ ] **Step 1: 失敗するテストを書く** (`test/battle-boardmodel.test.ts`)
  `sideView` で次を確かめる: ①空の `createGame(["A","B"])` → 全ゾーンが空配列・`life` 20・`handCount` 0(**Review Focus 1**)。②手札2枚・山札3枚・墓地1枚・追放1枚の枚数が `handCount` / `library` / `graveyard` / `exile` に出る。③戦場に、島(Land)・熊(Creature — Bear, 2/2)・アーティファクト・土地クリーチャー(`Land Creature — Forest Dryad`)を置くと、それぞれ `lands` / `creatures` / `others` / `creatures` に入る。④`showHand=false` で `hand` が空、`handCount` は枚数どおり。⑤タップ済み・`damage` 2・`counters["+1/+1"]` 1 の熊 → `tapped` true・`damage` 2・`counters` に反映、`power`/`toughness` は、+1/+1 カウンターをふまえて 3/3(`characteristics` の結果)。⑥`enteredTurn === g.turn` の熊 → `sick` true、`haste` を持つと false。⑦`imageOf` が undefined を返しても `image` が undefined で落ちない(**Review Focus 4**)。⑧トークン(`card.token`)→ `token` true。⑨プレインズウォーカー → `loyalty` = `counters.loyalty`。

- [ ] **Step 2: テストが失敗することを確かめる**
  Run: `npm test 2>&1 | grep -E "FAIL|passed"`
  Expected: `FAIL battle-boardmodel.test.ts`(モジュールが無い)

- [ ] **Step 3: `sideView` を実装する** (`src/battle/boardModel.ts`)
  シグネチャは上のとおり。`characteristics` の結果から型行・P/T・キーワードを取る(継続効果が効く)。`loyalty` は `perm.counters?.loyalty`。`prepared` は `perm.prepared === true`。手札のカードは `CardView`(`tapped` などは false)。

- [ ] **Step 4: テストが通ることを確かめる**
  Run: `npm test 2>&1 | tail -3`
  Expected: 全部 `PASS`(新しいテストを含めて、1つ増える)

- [ ] **Step 5: Commit**(ユーザーが「コミットして」と言ったときだけ。それまでは、変更を残すだけ)

---

### Task 2: フェイズ・戦闘・スタック・マナ・勝敗・ログ(`boardModel`)

**Files:**
- Modify: `src/battle/boardModel.ts`
- Test: `test/battle-boardmodel.test.ts`

**Interfaces:**
- Consumes: Task 1 の `SideView` / `sideView` / `ImageOf` / `CardView`。`Game.step` / `Game.combatPhase` / `Game.stack` / `Game.mana` / `Game.pool` / `Game.over` / `Game.log` / `Game.active` / `Game.turn`。
- Produces:
  ```ts
  export type PhaseId = "beginning" | "main1" | "combat" | "main2" | "ending"
  export interface ManaView { total: number; colors: Partial<Record<"W"|"U"|"B"|"R"|"G"|"A", number>>; colorless: number }
  export interface StackView { id: string; name: string; controller: "self" | "opp"; ability: boolean }
  export interface BoardModel { self: SideView; opp: SideView; manaSelf: ManaView; phase: PhaseId; step: string; combat: boolean; activeSide: "self" | "opp"; turn: number; stack: StackView[]; over?: { winner?: "self" | "opp" }; log: string[] }
  export function boardModel(g: Game, rules: RuleBook, viewer: PlayerId, imageOf: ImageOf): BoardModel
  ```
  `phase` の決め方: `untap`/`upkeep`/`draw` → `beginning`、`main1` → `main1`、`combat` → `combat`、`main2` → `main2`、`end` → `ending`。`step` = 画面に小さく出す日本語のステップ名(アンタップ / アップキープ / ドロー / メイン / 戦闘開始 / 攻撃クリーチャー指定 / ブロック指定 / 先制攻撃ダメージ / 戦闘ダメージ / 戦闘終了 / 終了)。戦闘のステップは `combatPhase` から(`undefined` のときは「戦闘」)。`combat` は `g.step === "combat"`。`opp` = `g.players` のうち `viewer` でない最初の人。`over.winner` は `g.over.winner` を "self"/"opp" に直したもの(引き分けは `{}`)。`log` は `g.log` の最後の 50 行。`manaSelf` は、`viewer` の `g.mana` / `g.pool` から(無色 = `total` − 色つきの合計、0 未満にしない)。

- [ ] **Step 1: 失敗するテストを書く**
  ①`step`×`combatPhase` の表(untap→beginning/アンタップ、draw→beginning/ドロー、main1→main1、combat+`beginning`→combat/戦闘開始、combat+`attackers`→攻撃クリーチャー指定、combat+`end`→戦闘終了、main2、end→ending/終了)を `boardModel` で確かめる。②`combat` は戦闘ステップのときだけ true。③`activeSide` は `g.active === viewer` で "self"。④スタックに呪文と能力が1つずつ → `stack` に `ability` の真偽つきで出て、`controller` が "self"/"opp"。⑤`g.mana["A"]=3`、`g.pool["A"]={U:1}` → `manaSelf` が `total` 3・`colors` `{U:1}`・`colorless` 2。pool が合計を超えていても `colorless` が負にならない。⑥`g.over={winner:"B"}` で viewer "A" → `over.winner` "opp"。`g.over={}` → `over` が `{}`(引き分け)、`g.over` が無ければ `over` が無い。**ライフが -3 や 9999 でも、そのまま数値で出る**(表示側で桁を縮める。Review Focus 5)。⑦`g.log` が 60 行 → 最後の 50 行。⑧同じ `Game` で2回呼ぶと、`assert.deepEqual` で等しい(差分更新の前提)。

- [ ] **Step 2: テストが失敗することを確かめる**
  Run: `npm test 2>&1 | grep -E "FAIL|passed"` / Expected: `FAIL battle-boardmodel.test.ts`

- [ ] **Step 3: `boardModel` を実装する**
  上の決め方どおり。ステップ名の対応表は、定数のオブジェクトにする。`sideView` は Task 1 のものを、`viewer` の側は `showHand=true`、相手は `false` で呼ぶ。

- [ ] **Step 4: テストが通ることを確かめる**
  Run: `npm test 2>&1 | tail -3` / Expected: 全部 `PASS`

- [ ] **Step 5: Commit**(ユーザーが言ったときだけ)

---

### Task 3: サンプルの局面(`sampleBattle`)

**Files:**
- Create: `src/battle/sampleBattle.ts`
- Test: `test/battle-boardmodel.test.ts`

**Interfaces:**
- Consumes: `createGame` / `Game` / `RuleBook` (`state.ts`)。
- Produces: `export function sampleBattle(): { game: Game; rules: RuleBook }`。`game.players` は `["you", "opp"]`、viewer は `"you"`。

局面の中身(モックに合わせる。カード名は、ユーザーの vault の `Cards/` にあるもの。画像は、名前でノートを引くので、同じ名前にする): 自分(`you`)= 手札 6 枚(Aetherize / Accumulate Wisdom / Confusticate and Bebother / Into the Roil / Negate / We Say Thee Nay!)、戦場に Island ×4(1枚タップ)、Brineborn Cutthroat 2/1・Geist of Saint Thalia 3/3 飛行・Elementalist Adept 2/2 に +1/+1 カウンター 1、Octopus Form(`others`)、The Theorist, Jace Beleren(プレインズウォーカー、忠誠度 4)、イリュージョントークン 1/1(トークン)。このうち Cutthroat と Geist と Adept の3体が攻撃中(`attacking`、`attackTarget: "opp"`)。相手(`opp`)= 手札 5 枚、戦場にクリーチャー3体(ブロックしている 1 体は `blocking`、ダメージ 1 が載っている 1 体)、タップした土地 2 枚。山札・墓地の枚数を、モックの数字に近づける(自分 山札 46・墓地 2 / 相手 山札 47・墓地 2)。`g.step = "combat"`・`g.combatPhase = "blockers"`・`g.turn = 5`・`g.active = "you"`、`g.life = { you: 20, opp: 15 }`、`g.mana["you"] = 1`・`g.pool["you"] = { U: 1 }`。`g.log` に 5 行(例: 「あなたが島をタップして {U} を出した」「あなたが Geist of Saint Thalia で攻撃した」「相手が … でブロックした」)。`rules` は、手で作った最小のルール(キーワード飛行を持つ Geist など、`characteristics` が必要とするもの。なければ空の `RuleBook` でよい)。

- [ ] **Step 1: 失敗するテストを書く**
  `boardModel(sampleBattle().game, rules, "you", () => undefined)` で次を確かめる: `self.hand.length` 6・`self.lands.length` 4 でタップ済み 1・`self.creatures` 4 体(トークン含む)のうち `attacking` が 3・`self.others` に Octopus Form と Jace(`loyalty` 4)・`opp.handCount` 5・`opp.hand` 空・`opp.creatures` のうち `blocking` 1・ダメージ付き 1・`phase` "combat"・`step` "ブロック指定"・`combat` true・`self.life` 20 / `opp.life` 15・`manaSelf` が U:1・`log` 5 行。**`createGame` で作った `Game` が、`stateBased` を通っても何も変わらないこと**(`g.life` が 0 超・タフネス 0 以下のクリーチャーがいない)も確かめる。

- [ ] **Step 2: テストが失敗することを確かめる** / Expected: `FAIL`

- [ ] **Step 3: `sampleBattle` を実装する**
  上の中身どおり。`Perm` は `g.battlefield.push({...})`、手札は `g.hands[p].push(card)`、山札・墓地は、枚数だけの、ダミーの `GameCard`(名前 "library-1" など)で埋める。

- [ ] **Step 4: テストが通ることを確かめる** / Expected: 全部 `PASS`

- [ ] **Step 5: Commit**(ユーザーが言ったときだけ)

---

### Task 4: `BattleView` の画面・スタイル・登録・README

**Files:**
- Create: `src/BattleView.ts`
- Modify: `styles.css`, `src/main.ts`, `README.md`
- Test: `test/viewnames.test.ts`(変更なし。`BattleView.ts` が、メンバー名の検査に入ること)

**Interfaces:**
- Consumes: `boardModel` / `BoardModel` / `CardView` / `ImageOf` (Task 2)、`sampleBattle` (Task 3)、`cardInfo` / `cardImage` / `cardText` (`src/cards.ts`: ノートから画像の URL と効果テキストを引く)。
- Produces: `export const BATTLE_VIEW = "mtg-battle"`、`export class BattleView extends ItemView`(`getViewType` / `getDisplayText` = "Battle" / `getIcon` = "swords")。`main.ts` に、`registerView(BATTLE_VIEW, …)` と、コマンド `battle-open`(名前「Battle: open battle screen (sample)」)。

構造(DOM のクラス名。モックの `layout-main.html` の見た目に合わせる): `.mtg-bt`(左右2段: `.mtg-bt-stage` と `.mtg-bt-side`)/ `.mtg-bt-board`(`perspective(900px) rotateX(38deg)`、`transform-origin: 50% 100%`)/ `.mtg-bt-row`(列。`--n` に枚数を入れ、`margin-left` を `min(10px, calc((100% - n*62px)/n))` のように負にして収める)/ `.mtg-bt-card`(`.is-tapped` は `rotate(90deg)`、`.is-attacking` は紫の光、`.is-sick` は薄く)/ `.mtg-bt-hand`(自分の手札。扇状。`:hover` で `transform: translateY(-40px) scale(1.25); z-index: 10`。`transition: transform .12s`)/ `.mtg-bt-ohand`(相手の手札。最大 10 枚の裏向き + 超えた分は「+N」の数字)/ `.mtg-bt-belt`(赤い帯。`combat` のときだけ濃く)/ `.mtg-bt-life`・`.mtg-bt-avatar`(左下 = 自分、右上 = 相手)/ `.mtg-bt-pile`(山札・墓地。枚数)/ `.mtg-bt-phase`(5フェイズ。いまのフェイズが `.on`。その下にステップ名を小さく)/ `.mtg-bt-mana`(自分のマナ・プール)/ `.mtg-bt-banner`(勝敗のバナー)/ サイドバー `.mtg-bt-side` は、上 `.mtg-bt-preview`(ホバーしたカードの画像と効果テキスト)・下 `.mtg-bt-log`(`log` を新しいものが下になるように並べて、最後へスクロール)。画像が無いカードは、名前と P/T(または忠誠度)を書いた代わりの面。ダメージのあるカードの上に、赤い数字(`.mtg-bt-dmg`)。ライフは 4 桁以上で `font-size` を縮める(`.is-long`)。

差分更新: `BattleView` は、`Map<id, { el: HTMLElement; sig: string }>` を持ち、`render(model)` で、各 `CardView` の `sig`(`JSON.stringify` したもの)が前回と同じなら、その要素を触らない。違うものだけを更新する。要素の並びが変わったときだけ、`appendChild` で並べ直す。消えたカードの要素は取り除く。`render` は、`Game` の変化を知らされたときだけ呼ぶ(段階1では、画面を開いたときと、ウィンドウのサイズが変わったときの 2 回)。

- [ ] **Step 1: `BattleView` と `BoardModel` の描画を実装する** (`src/BattleView.ts`)
  上の DOM 構造どおり。`onOpen()` で `sampleBattle()` を呼び、`imageOf = (card) => { const i = cardInfo(this.app, card.name); return i ? cached(i.file) : undefined }`(画像の URL は、`cardImage` が非同期なので、先に全部を解決してから `render` する。解決できなければ undefined のまま)。ホバー: `mouseenter` で、右上のプレビューに、画像と `cardText(this.app, card.name)` の効果テキストを出す。`mouseleave` では、プレビューを変えない。メンバー名は、`open` `close` `load` などを使わない(`render`・`draw` のような名前にする)。

- [ ] **Step 2: スタイルを足す** (`styles.css`)
  `.mtg-bt-*` を、モックの CSS を元に足す。アニメーションと `transition` は `transform` と `opacity` だけ。`.mtg-bt-card img` に `loading="lazy"`(DOM 側)。長い名前は `overflow: hidden; text-overflow: ellipsis`。

- [ ] **Step 3: 登録する** (`src/main.ts`)
  `BATTLE_VIEW` を import し、`this.registerView(BATTLE_VIEW, (leaf) => new BattleView(leaf))`、`this.addCommand({ id: "battle-open", name: "Battle: open battle screen (sample)", callback: ... })` を足す。コマンドは、新しいタブで開く(`getLeaf(true).setViewState({ type: BATTLE_VIEW, active: true })`)。

- [ ] **Step 4: README を足す**
  「対戦(作成中)」の節に、段階1の説明(コマンド、いまはサンプルの局面を見るだけ、ホバーでカードの画像と効果、ログが下)を、数行で。

- [ ] **Step 5: ビルドとテストを確かめる**
  Run: `npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -3`
  Expected: ビルドが成功(`main.js` が出る)・全部 `PASS`(`view names ok` を含む)。

- [ ] **Step 6: ユーザーが画面で確認する項目を、一覧にして渡す**(私は、Obsidian の画面を動かせない。「動かしていない」と、はっきり言う)
  ①コマンドで、画面が開く。②斜めの盤面・手前の手札・左下の自分・右上の相手が、モックに近いか。③手札にカーソルを合わせると、そのカードが前に出る(重なりが見える)か。④パーマネントにカーソルを合わせると、右上に画像と効果が出るか。⑤ログが右下に出るか。⑥攻撃クリーチャーが紫に光る・赤い帯・フェイズ表示(戦闘)が出るか。⑦ウィンドウを広げ縮めしても、はみ出さないか。⑧重さ(カーソルを素早く動かして、引っかからないか)。⑨画像が無いカードの代わりの表示。

- [ ] **Step 7: Commit・リリース**(ユーザーが「リリースする」と言ったときだけ。版は 0.63.0)

---

## Self-Review

- **Spec coverage(段階1):** 斜め盤面・手前の手札・ホバー前面(タスク4)/ アバター・ライフ・山札・墓地・赤い帯・紫の光(タスク2・4)/ 5フェイズとステップ(タスク2・4)/ サイドバー上下(タスク4)/ 本物の `Game` のサンプル(タスク3)/ 差分更新・遅延読み込み(タスク4)。**範囲外(段階2以降)**: デッキ選択・操作・スタックの操作・戦闘の演出・設定項目・履歴。
- **型の一貫性:** `CardView` / `SideView` / `ImageOf` はタスク1、`BoardModel` / `PhaseId` / `ManaView` / `StackView` はタスク2で定義し、タスク3・4はそれを使う。名前は変えない。
- **Review Focus:** 5行とも、担当のタスクのテストか、確認項目(タスク4 Step 6)に入れた。
- **比率:** 計画は、設計書の1段階分に対して、コードの本体を書いていない(シグネチャ・テストの内容・DOM の構造だけ)。
