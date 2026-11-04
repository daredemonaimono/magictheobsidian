# 対戦の画面 段階3 (自分のターンの操作) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ネイティブ実行。段階1・2と同じ) で、タスクごとに進める。

**Goal:** 自分のターンに、土地をダブルクリックでタップしてマナを出し、手札のカードをダブルクリックで使い、能力を選んで起動し、「次へ」でステップを進められる。対象を取らないカードだけ。相手は何もしない。

**Architecture:** 「いま何ができるか」の判定と、操作の実行は、画面から切り離した純粋なコード(`src/battle/actions.ts` = 判定、`src/battle/play.ts` = 操作の入口 `BattleController`)に置き、`npm test` で確かめる。判定は、エンジンの本物の入口を `structuredClone` した局面で試し撃ちして決める(エンジンと食い違わない)。画面(`BattleView`)は、クリックを `BattleController` に渡して、描き直すだけ。

**Tech Stack:** TypeScript, esbuild, 既存のテスト(`npm test`)。

**Spec:** `docs/superpowers/specs/2026-11-04-battle-ui-design.md` (4節「操作」、7節の段階3、9節の3・4)

## Global Constraints

- `citadel/` 等の vault のノートは書き換えない(読み込みのみ)。公開(push・リリース)は、ユーザーが「リリースする」と言ったときだけ。
- 既存テスト 35 本が全部通ること。エンジンの変更は、最小限(この段階では、原則 `engine.ts` を変えない)。
- 重さ: 盤面の更新は、変わったものだけ(キーつきの差分)。ホバーの前面表示は CSS の `transform` だけ。
- 1回クリック = 選択とプレビュー。**ダブルクリック = 使う**。途中でやめるのは **Esc** だけ(右クリックは使わない)。
- ルールが無いカードは、使うとログに「ルールが設定されていません。スキップします。」(エンジンが出す)。基本土地も例外にしない。
- 見た目は、ユーザーが実機(Obsidian)で確認する。私は外部ハーネスでしか見ていないと正直に伝える。

## Review Focus

- 対象が必要なカード(`isTarget` のノードがある)を、ダブルクリックしたとき: 状態を変えず、ログに「対象を選ぶカードは、まだ使えません」と出す。
- コストが払えない・タイミングが違うカード: 状態を変えず、ログに理由が出る(例外で画面が止まらない)。
- 「次へ」を押し続けて自分のターン→相手のターン→自分のターンと進んでも、止まらず、ターン 3 の自分のアップキープで止まる。ライブラリーが空・ゲーム終了(`g.over`)でも、無限ループしない。
- マナ・プールは、ステップが替わると空になる(`strictTurns`)。画面の表示も空になる。
- 手札 8 枚以上で自分のターンを終えると、後ろのカードが自動で捨てられる(入力の仕組みは段階4)。ログに出す。

---

### Task 1: いま何ができるか (`src/battle/actions.ts`)

**Files:**
- Create: `src/battle/actions.ts`
- Test: `test/battle-actions.test.ts`

**Interfaces:**
- Produces:
  - `type Action = { kind: "land" | "cast"; card: string } | { kind: "activate"; perm: string; index: number }`
  - `needsTarget(rules: RuleBook, body: NodeCall[]): boolean` — body に、`getNode(c.node)?.isTarget` のノードがある。
  - `tryAction(g: Game, rules: RuleBook, p: PlayerId, a: Action): string | undefined` — `structuredClone(g)` に対して、`playLand` / `castSpell(…, {}, …)` / `activateAbility(…, index, {}, …)` を実行し、成功なら `undefined`、`RuleError` ならそのメッセージ。対象が必要なカード・能力は、試す前に「対象を選ぶカードは、まだ使えません」を返す。それ以外の例外は投げ直す。
  - `actionsFor(g: Game, rules: RuleBook, p: PlayerId): Action[]` — 手札の各カード(土地は `land`、それ以外は `cast`)と、自分のパーマネントの各起動型能力(`rules.get(name).abilities.filter(kind==="activated")` の番号)のうち、`tryAction` が `undefined` のもの。
  - `abilityLabels(rules: RuleBook, cardName: string): string[]` — 起動型能力ごとの短い表示(「1: …」)。ノードの表示名(`NodeDef` に label があればそれ、なければノード名)を「 → 」でつなぐ。

- [ ] **Step 1: 失敗するテストを書く** — `test/battle-actions.test.ts`(手で作ったルール。`registerBuiltinNodes`、`createGame`、`payManaCosts = true`、`strictTurns` は偽でよい)。assert:
  - 手札の島(土地、メイン、土地未プレイ)→ `actionsFor` に `{kind:"land"}`。1枚出した後は、2枚目の土地は出ない。
  - 戦場の島(`activated`: `cost tap` + `addMana U`)→ `{kind:"activate", index:0}`。タップ済みなら出ない。
  - マナ 0 のとき、{1}{U} のクリーチャーは `cast` に出ない。島をタップして U を出した後は出る。
  - `target` ノードを持つ呪文は、マナがあっても出ない。`tryAction` は「対象を選ぶカードは、まだ使えません」を返す。
  - 相手のターンのメインでは、ソーサリー・クリーチャーは出ない。`tryAction` を呼んでも、元の `g` は変わらない(手札・戦場・ログが同じ)。
- [ ] **Step 2: 実行して失敗を確かめる** — Run: `npm test` / Expected: `battle-actions` が import エラーで失敗。
- [ ] **Step 3: `actions.ts` を実装する**(上の署名どおり)。
- [ ] **Step 4: 実行して通す** — Run: `npm test` / Expected: 全部 PASS。
- [ ] **Step 5: Commit**(リリースはしない): `git add -A && git commit -m "battle-ui 3: actions"`

---

### Task 2: 操作の入口 (`src/battle/play.ts`)

**Files:**
- Create: `src/battle/play.ts`
- Test: `test/battle-play.test.ts`

**Interfaces:**
- Consumes: Task 1 の `Action`, `tryAction`, `actionsFor`, `abilityLabels`。エンジンの `castSpell` `playLand` `activateAbility` `passPriority` `RuleError`。
- Produces: `class BattleController { constructor(game: Game, rules: RuleBook, me: PlayerId = "you") }` に、
  - `use(cardId: string): string | undefined` — 手札のカードを使う(土地なら `playLand`、他は `castSpell`)。失敗は、メッセージを返し、ログにも1行(`g.log`)。成功したら、ログに「あなたが X を唱えた / 出した」。
  - `activate(permId: string, index: number): string | undefined` — 戦場の自分のパーマネントの能力。成功したら、ログに「あなたが X の能力を起動した」(マナ能力のみなら、「あなたが X をタップして マナを出した」)。
  - `abilities(permId: string): { index: number; label: string; usable: boolean }[]` — 能力の一覧(クリックで出すメニュー用)。
  - `next(): void` — 自分が `passPriority`、続けて相手が自動でパス。結果が `resolved`(スタックの1つを解決)ならそこで止まる。`stepEnded` で、相手のターン(`g.active !== me`)なら、自分のターンになるまで、両者が自動でパスし続ける。`g.over` や、100 回を超えたら止める(無限ループ防止)。手札を捨てる(クリンナップ)ときは、ログに「手札が 7 枚を超えたので、後ろから N 枚捨てた」。
  - `actions(): Action[]` — `actionsFor(game, rules, me)` を返す。

- [ ] **Step 1: 失敗するテストを書く** — `test/battle-play.test.ts`(`buildMatch` で 60 枚ずつのデッキを組み、`strictTurns` を使う。手で作ったルール)。assert:
  - 島を `use` → 戦場に出る。ログに「あなたが 島 を出した」。2枚目の `use` は、メッセージが返り、戦場は変わらない。
  - 島を `activate` → `g.mana.you === 1`。クリーチャーを `use` → スタックに積まれ、マナが減る。`next()` → 解決して戦場に。
  - 対象が必要なカードの `use` → メッセージ「対象を選ぶカードは、まだ使えません」、状態は変わらない。
  - ステップを替えると、マナ・プールが空(`strictTurns`)。
  - 自分のターンのアップキープから `next()` を繰り返す: ステップが アップキープ → ドロー → メイン → 戦闘開始 → … → 終了 → (相手のターンを自動で飛ばし) ターン 3 のアップキープで止まる。途中、手札は引かれる(ターン 3 のドローでは +1)。`next()` の呼び出しは 30 回以内。
  - ライブラリーが空の相手がいても止まる(`g.over` が立つ)。`next()` を追加で呼んでも、例外にならない。
  - 手札 9 枚で終了ステップを抜けると、7 枚になり、ログに出る。
- [ ] **Step 2: 失敗を確かめる** — Run: `npm test` / Expected: `battle-play` が失敗。
- [ ] **Step 3: `play.ts` を実装する**。エンジンの例外は `RuleError` だけを捕まえてメッセージにする。
- [ ] **Step 4: 通す** — Run: `npm test` / Expected: 全部 PASS。
- [ ] **Step 5: Commit**: `git add -A && git commit -m "battle-ui 3: controller"`

---

### Task 3: 画面に出す内容 (`boardModel` に足す)

**Files:**
- Modify: `src/battle/boardModel.ts` (`CardView.playable: boolean`、`BoardModel.canNext: boolean`、`BoardModel.nextLabel: string`)
- Modify: `test/battle-boardmodel.test.ts`

**Interfaces:**
- Consumes: Task 1 の `actionsFor`。
- Produces: `boardModel(g, rules, viewer, imageOf)` の結果で、自分の手札・戦場のカードの `playable`(その札・パーマネントに、できる行動が1つ以上ある)、`canNext`(自分が優先権を持ち、ゲームが終わっていない)、`nextLabel`(スタックがあれば「解決する」、無ければ「次へ」)。相手側と、サンプルの局面では `playable = false`。

- [ ] **Step 1: 失敗するテストを書く** — 手札のクリーチャーはマナがあれば `playable`、無ければ偽。戦場の島は未タップなら `playable`、タップ済みなら偽。スタックがあるとき `nextLabel === "解決する"`。`g.over` があると `canNext === false`。
- [ ] **Step 2: 失敗を確かめる** — Run: `npm test` / Expected: FAIL。
- [ ] **Step 3: 実装する**。`sideView` の `inHand` / `permView` に `playable` を渡す(自分の側だけ `actionsFor` の結果から作る)。
- [ ] **Step 4: 通す** — Run: `npm test` / Expected: 全部 PASS(既存の `deepEqual` が `playable` で壊れたら、その前提が変わったので、テストを直す)。
- [ ] **Step 5: Commit**: `git add -A && git commit -m "battle-ui 3: boardModel playable"`

---

### Task 4: 画面の操作 (`BattleView`)

**Files:**
- Modify: `src/BattleView.ts`, `src/main.ts`(セッションに `BattleController` を持たせる), `src/battle/deckToGame.ts`(`BattleSession` に controller は持たせず、`BattleView.begin()` で作る)
- Modify: `styles.css`
- Modify: `README.md`, `agent.md`(段階3を追記)

**Interfaces:**
- Consumes: Task 2 の `BattleController`、Task 3 の `playable` / `canNext` / `nextLabel`。
- 画面の約束:
  - `playable` なカードに、薄い光(`is-playable`)。
  - **ダブルクリック**: 手札 → `use`。自分の戦場のパーマネント → 能力が1つなら `activate(…, 0)`、2つ以上なら一番上(`index` が最小の使えるもの)。
  - **1回クリック**: 選択(枠)とプレビュー。能力が2つ以上あるパーマネントは、カードのそばに能力の一覧(`abilities()` の `label`、使えないものは薄く)を出し、クリックでその能力を起動。一覧は **Esc**、または他の場所のクリックで閉じる。
  - 右下に「次へ」ボタン(`nextLabel`、`canNext` が偽なら無効)。押すと `next()`。
  - 操作のあとは、`paint()` し、新しく出たカード名の画像を読む(`loadImages()` を、足りない名前だけにする)。メッセージ(失敗の理由)は、ログに出る(コントローラーが `g.log` に書く)。
  - サンプルの局面(`battle-open`)では、操作できない(クリックはプレビューだけ)。
- [ ] **Step 1**: `BattleView` に、コントローラーを持たせる(`begin()` で、対戦のセッションなら作る。サンプルなら作らない)。クリック / ダブルクリック / Esc / 「次へ」を配線する。要素の差分更新(`sync`)は、`playable` が `CardView` に入るので、そのまま効く。
- [ ] **Step 2**: `styles.css` に `.mtg-bt-card.is-playable`、`.mtg-bt-next`、`.mtg-bt-menu` を足す(`transform` と `opacity` だけで動かす)。
- [ ] **Step 3**: ビルド → 外部ハーネス(esbuild で `BattleView` をバンドル + `python3 -m http.server 8765` + 内蔵ブラウザ)で、1ターンを実際に操作して確認(島をダブルクリック → マナ → クリーチャーをダブルクリック → 「次へ」で解決)。Run: `npm run build && npm test` / Expected: エラー無し、全部 PASS。
- [ ] **Step 4**: README(段階3)・`agent.md`(「できること」に自分のターンの操作、「未対応」に対象を取るカード・攻撃ブロック・捨てる/選ぶ入力・マリガンが段階4〜6)を更新。
- [ ] **Step 5: Commit**: `git add -A && git commit -m "battle-ui 3: own-turn operations"`(**リリースは、ユーザーが「リリースする」と言ったとき**だけ: 0.65.0)

---

## 私が決めたこと(直してよい)

- 仕様 4節に「土地をクリックでタップ」と「ダブルクリックで…土地・マナ能力のあるカード: タップしてマナを出す」の両方がある。後者(ダブルクリック)に統一する(1回クリックは選択だけ)。
- 相手のターンは、「次へ」で、自分のターンになるまで自動で飛ばす(相手は何もしない。段階4で優先権の設定、段階5で CPU が入る)。
- 手札を捨てる入力は段階4。それまでは、後ろから自動で捨て、ログに出す。
- 「いまできるか」は、エンジンの入口を `structuredClone` で試し撃ちして決める(専用の判定を別に書かない)。カードが多い盤面での重さは、実機で確かめる。
