# 対戦の画面 段階2: 対戦を始める(実装計画)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自分のデッキと、同じフォーマットの相手のデッキ(選ぶ or ランダム)を選んで、対戦を始め、手札7枚が配られた盤面が画面に出る。ルールが設定されていないカードは、使うと「ルールが設定されていません。スキップします。」とログに出て、ゲームは進む。

**Architecture:** デッキ → `GameCard` の変換と、対戦の組み立て(`buildMatch`)は、Obsidian に依存しない純粋な関数にして、`npm test` で確かめる。エンジンには、ルールの無いカードをスキップする、opt-in の動き(`Game.skipUnruled`)を足す(既定は偽で、これまでの動きのまま)。画面側は、デッキを読む・ルールを読む・開始のモーダル・`BattleView` へ局面を渡す、だけ。

**Tech Stack:** TypeScript、Obsidian(`Modal`、`ItemView`)、既存のエンジン(`src/battle/`)、テストは `node test/run.mjs`。新しい依存なし。

**Spec:** `docs/superpowers/specs/2026-11-04-battle-ui-design.md`(7節の段階2、9節の1・5・6)。段階1の計画: `docs/superpowers/plans/2026-11-04-battle-ui-1-board-view.md`

## Global Constraints

- 既存の動きを壊さない。`npm test` は全部通す。既存のテストは、書き換えない。エンジンの新しい動きは、opt-in(`Game.skipUnruled`)で、既定は偽。
- 画面にルールを持たない。ルールはエンジンだけ。
- ルールが設定されていないカードは、**すべて同じ扱い**(基本土地も例外なし)。使うと「ルールが設定されていません。スキップします。」とログ。効果は飛ばし、カード自体は唱える・出すことができる。
- 統率戦(Commander)のデッキは、対戦に使えない(理由を出す)。ライフは 20。自分が先手。マリガンは無し。
- `Cards/` `Decks/` `Rules/` を、画面が勝手に書き換えない。忠誠度の保存は、`toMarkdown`(カードのノートを作る処理)と、ユーザーが押す「情報取得」だけ。
- 画面クラスのメンバー名は `open` `close` `load` などと重ねない(`test/viewnames.test.ts`)。
- パワー・タフネスが `*` のカードは 0 として扱う(エンジンに特性定義能力が無い。限界として記録)。
- 同じカードの複数枚には、枚ごとに重ならない id を付ける(画面の差分更新が、id の重なりで壊れる)。
- ユーザーが言うまで、コミット・push・リリースをしない。

## Review Focus

1. デッキが 7 枚未満 → 手札を引けず、始める前に止める(エンジンの「空のライブラリーで負け」に任せず、理由を出す)(タスク3)。
2. 同じカード 4 枚(`4 [[Island]]`)・サイド・トークン欄・コマンダー欄がある → メイン(+ 統率戦以外ではコマンダー欄なし)だけを山札にして、id が重ならない(タスク3)。
3. `mana_cost` が `{3}{U}{U} // {U}`(両面・冒険・準備)、無い(土地)、`{X}` を含む → エンジンが読める表記にする(タスク2)。
4. パワー `*`・忠誠度が無いプレインズウォーカー → 落ちずに、0 / 未定義(タスク2)。
5. ルールが無い・壊れている・未対応が残るカードがデッキにある → 始める前に一覧を出し、始められる。使うとログ(タスク3・4・5)。

## File Structure

- Modify `src/scryfall.ts`: `ScryfallCard.loyalty`、`toMarkdown` が `loyalty:` を書く。
- Modify `src/cards.ts`: `CardInfo.loyalty`、`toInfo` が読む。
- Modify `src/DeckView.ts`: 「情報取得」が、忠誠度の無いプレインズウォーカーも取り直す。
- Create `src/battle/deckToGame.ts`: `CardData` / `toGameCard` / `buildMatch` / `unruledCards`。純粋な関数。
- Modify `src/battle/state.ts` / `src/battle/engine.ts`: `Game.skipUnruled`、ルールの無いカードのスキップ。
- Create `src/BattleStartModal.ts`: 開始のモーダル(自分のデッキ・相手のデッキ・ルールが無いカードの一覧・始める)。
- Modify `src/BattleView.ts`: 外から渡された局面(`session`)を描く。無ければ、サンプル。
- Modify `src/main.ts`: コマンド「Battle: start battle」、デッキとルールを読む処理、`BattleView` への局面の受け渡し。
- Modify `README.md`。
- Test: `test/battle-start.test.ts`(新規)、`test/battle-batch13.test.ts`(スキップ。新規)、`test/flip.test.ts`(忠誠度の書き出し。既存に足す)。

---

### Task 1: 忠誠度をカードのノートに保存する

**Files:** Modify `src/scryfall.ts`, `src/cards.ts`, `src/DeckView.ts`; Test `test/flip.test.ts`

**Interfaces:**
- Consumes: `toMarkdown(c: ScryfallCard, opts)`(既存)。
- Produces: `ScryfallCard.loyalty?: string`(Scryfall は文字列)。ノートの frontmatter に `loyalty: 4`。`CardInfo.loyalty?: number`。

- [ ] **Step 1: 失敗するテストを書く** (`test/flip.test.ts` の末尾に)
  `type_line: "Legendary Planeswalker — Jace"`・`loyalty: "4"` の `ScryfallCard` で `toMarkdown` → `loyalty: 4` を含む。`loyalty` が `"X"` や無いカード → `loyalty:` の行を書かない(**Review Focus 4**)。

- [ ] **Step 2: 失敗を確かめる** — Run: `npm test 2>&1 | grep -E "FAIL|passed"` / Expected: `FAIL flip.test.ts`

- [ ] **Step 3: 実装する**
  `ScryfallCard` に `loyalty?: string`。`toMarkdown` の frontmatter に、`/^\d+$/` に合う `loyalty` だけ `loyalty: <数>`。`CardInfo` に `loyalty?: number`、`toInfo` が `fm.loyalty` を数にする。`DeckView.ts` の「情報取得」で、`typeLine` に Planeswalker を含み `loyalty === undefined` のカードも、取り直しの対象に足す(既存の `noText` と同じ並び)。

- [ ] **Step 4: 通ることを確かめる** — Run: `npm test 2>&1 | tail -3` / Expected: 全部 `PASS`

---

### Task 2: カードのデータ → `GameCard`(`toGameCard`)

**Files:** Create `src/battle/deckToGame.ts`; Test `test/battle-start.test.ts`

**Interfaces:**
- Consumes: `GameCard`(`src/battle/state.ts`)。
- Produces:
  ```ts
  export interface CardData { name: string; typeLine: string; cmc: number; manaCost: string; power?: string; toughness?: string; keywords?: string[]; colors: string[]; loyalty?: number }
  export function toGameCard(data: CardData, id: string, owner: string): GameCard
  ```
  `name` = カードのノートの名前(`Cards/` のファイル名。ルールのノートの名前と同じ)。`mv` = `cmc`。`manaCost`: `" // "` で分かれていれば、前半だけ(前面のコスト)。空文字なら `undefined`(土地)。`{X}` はそのまま(エンジンが 0 として読む)。`power` / `toughness`: 数字の文字列 → 数。`*` や数でないもの → 0。`power` が無ければ、どちらも設定しない(クリーチャーでない)。`keywords` は、あればそのまま(エンジンが正規化する)。`colors` はそのまま。`loyalty` はあればそのまま。

- [ ] **Step 1: 失敗するテストを書く** (`test/battle-start.test.ts`)
  ①`{3}{U}{U} // {U}` → `manaCost` `{3}{U}{U}`(Review Focus 3)。②`""` → `manaCost` が undefined。③`{X}{R}` → そのまま。④`power: "*"`・`toughness: "2"` → 0 と 2(**Review Focus 4**)。⑤`power: "3"`・`toughness: "4"` → 3 と 4。⑥`power` なし → `power`・`toughness` が undefined。⑦`loyalty: 4` → 4。⑧`id` / `owner` / `name` / `typeLine` / `mv` が入る。

- [ ] **Step 2: 失敗を確かめる** / Expected: `FAIL battle-start.test.ts`(モジュールが無い)

- [ ] **Step 3: `toGameCard` を実装する** (`src/battle/deckToGame.ts`)

- [ ] **Step 4: 通ることを確かめる** / Expected: 全部 `PASS`

---

### Task 3: 対戦の組み立て(`buildMatch`・`unruledCards`)

**Files:** Modify `src/battle/deckToGame.ts`; Test `test/battle-start.test.ts`

**Interfaces:**
- Consumes: `toGameCard` / `CardData`(タスク2)、`createGame` / `Game` / `RuleBook`、`startGame`(`src/battle/engine.ts`)。
- Produces:
  ```ts
  export interface DeckData { format: string; main: { key: string; n: number; data: CardData }[] }
  export class MatchError extends Error {}
  export function buildMatch(self: DeckData, opp: DeckData, rules: RuleBook, rng?: () => number): Game
  export function unruledCards(decks: DeckData[], rules: RuleBook): string[]
  ```
  `buildMatch`: プレイヤーは `["you", "opp"]`、先手は `"you"`。`format` が `"commander"` のデッキがあれば `MatchError("統率戦のデッキは、対戦に使えない")`。メインが 7 枚未満のデッキがあれば `MatchError("<自分|相手>のデッキが 7 枚に足りない")`(**Review Focus 1**)。山札: `main` を、枚数ぶん展開し(id = `${owner}:${key}#${連番}`)、`rng`(既定 `Math.random`)で Fisher–Yates に切る。`g.payManaCosts = true`、`g.skipUnruled = true`、`startGame(g, rules, "you")`(手札 7 枚)。`unruledCards`: デッキ内のカード名(重複なし)のうち、`rules.get(name)` が無い、または `abilities` が空のもの(ルールが設定されていないカード)。

- [ ] **Step 1: 失敗するテストを書く**
  ①60 枚のデッキ2つ(`4 Island` ×… 同じカード複数枚を含む)→ `hands.you.length` 7・`libraries.you.length` 53・手札+山札の id が全部重ならない(**Review Focus 2**)・`g.players` `["you","opp"]`・`g.active` "you"・`g.strictTurns` true・`g.payManaCosts` true・`g.skipUnruled` true・`g.life` `{you:20, opp:20}`。②同じ `rng`(固定の疑似乱数)なら、同じ手札。違う `rng` なら、違う並び(少なくとも 1 枚)。③`format: "commander"` → `MatchError`。④メインが 6 枚 → `MatchError`(自分 / 相手の区別が、メッセージに出る)。⑤`unruledCards`: `rules.get` が無いカードと、ノードが空のカードが出て、ルールがあるカードは出ない。重複なし・並びはデッキの順。

- [ ] **Step 2: 失敗を確かめる** / Expected: `FAIL`

- [ ] **Step 3: 実装する** (`src/battle/deckToGame.ts`)。`Game.skipUnruled` は、タスク4で型に足す(このタスクでは、型エラーを避けるため、`Game` に `skipUnruled?: boolean` を先に足してよい)。

- [ ] **Step 4: 通ることを確かめる** / Expected: 全部 `PASS`

---

### Task 4: ルールの無いカードをスキップする(エンジン)

**Files:** Modify `src/battle/state.ts`, `src/battle/engine.ts`; Test `test/battle-batch13.test.ts`

**Interfaces:**
- Consumes: `castSpell` / `playLand` / `resolveTop`(既存)。
- Produces: `Game.skipUnruled?: boolean`。真のとき、`rules.get(card.name)` が無いカード(または、能力が空のルール)は:
  - 呪文として唱えられる(`castSpell`): 本体は空(効果なし)。パーマネント呪文は、解決して戦場に出る。インスタント・ソーサリーは、解決して墓地へ。唱えたとき、`g.log` に `<カード名>: ルールが設定されていません。スキップします。` を1回。
  - 土地は出せる(`playLand`): 出たとき、同じメッセージを1回。マナは出ない(能力が無い)。
  偽のときは、これまでどおり(`castSpell` は RuleError)。

- [ ] **Step 1: 失敗するテストを書く** (`test/battle-batch13.test.ts`)
  `g.skipUnruled = true` で、ルール(`RuleBook`)に何も無いとき: ①クリーチャーを `castSpell` → エラーにならず、解決して戦場に出る・`g.log` に `ルールが設定されていません。スキップします。` を含む行がちょうど 1 つ。②インスタント → 解決して墓地へ。③土地を `playLand` → 戦場に出る・ログ 1 行・`g.mana` は増えない。④`skipUnruled` が偽(既定)→ `castSpell` が `RuleError`(これまでの動き)。⑤ルールがあるカード(効果あり)は、通常どおり動き、ログに出ない。⑥ルールのノードが空(`abilities: []`)のカードも、スキップ扱い。

- [ ] **Step 2: 失敗を確かめる** / Expected: `FAIL battle-batch13.test.ts`

- [ ] **Step 3: 実装する**
  `src/battle/state.ts` の `Game` に `skipUnruled?: boolean`(タスク3で足していれば、そのまま)。`castSpell` の本体決定(`spellBody(rules, card) ?? (rules.get(card.name) && isPermanentCard(card) ? [] : undefined)`)で、`g.skipUnruled` かつ「ルールが無い or 能力が空」なら、本体を `[]` にして、ログを積む。`playLand` も同じ判定でログを積む。判定は小さな関数(`unruled(g, rules, card): boolean`)にして、両方で使う。

- [ ] **Step 4: 通ることを確かめる** / Expected: 全部 `PASS`(既存のテストも)

---

### Task 5: 開始のモーダルと、画面への受け渡し

**Files:** Create `src/BattleStartModal.ts`; Modify `src/BattleView.ts`, `src/main.ts`, `README.md`

**Interfaces:**
- Consumes: `buildMatch` / `unruledCards` / `DeckData` / `CardData` / `MatchError`(タスク3)、`parseDeck`(`src/deck.ts`)、`cardInfo`(`src/cards.ts`)、`cardStatus`(`src/battle/coverage.ts`)、`parseRule`(`src/battle/ruleMd.ts`)、`judge`(`src/rules.ts`)。
- Produces: `export interface BattleSession { game: Game; rules: RuleBook }`。`BattleView` が、`session` があればそれを描く(無ければ、サンプル)。コマンド `battle-start`(名前「Battle: start battle」)。

流れ: コマンド → `BattleStartModal`(自分のデッキ: `Decks/` の一覧。フォーマットが統率戦のものは、選べない(理由を表示)。相手のデッキ: 「ランダム」+ 同じフォーマットで使えるデッキ(`judge` が ok)。自分のデッキの下に「ルールが設定されていないカード」の一覧(`unruledCards`。両方のデッキ分)。「始める」)→ `main.ts` が `DeckData` を作り(`Cards/` の `cardInfo` から `CardData`、枚数は `parseDeck` の `main`)、`Rules/` から `RuleBook` を作り(カード名 → `parseRule`。読めない・見つからないものは無いとして)、`buildMatch` を呼び、`MatchError` はお知らせ(`Notice`)に出す。成功したら、新しいタブで `BattleView` を、`session` つきで開く。

- [ ] **Step 1: `BattleView` が `session` を受け取る**
  `constructor(leaf, private getSession: () => BattleSession | undefined)`。`onOpen` は `getSession() ?? sampleBattle()`。`VIEWER` は "you" のまま。サンプルのコマンド(`battle-open`)は残す。`main.ts` の `registerView` で、`this.battleSession` を返す関数を渡す。

- [ ] **Step 2: `BattleStartModal` を実装する**
  自分のデッキ(`<select>`。統率戦は `disabled` で理由つき)、相手のデッキ(`<select>`。「ランダム」+ 同じフォーマットで使えるデッキ。自分のデッキを変えると作り直す)、ルールが設定されていないカードの一覧(自分のデッキ・相手のデッキの順。「ランダム」のときは、選んだ時点で決める)、「始める」ボタン。決めた2つのデッキの名前を、コールバックで返す。

- [ ] **Step 2b: `main.ts` に、読む処理とコマンドを足す**
  `loadDeckData(name): DeckData`(`parseDeck` の `main` → 各カードの `CardData`。`Cards/` に無いカードは、そのデッキを `MatchError` 扱い(「カードのノートが無い: <名前>」))、`loadRules(names): RuleBook`、コマンド `battle-start`。`BattleView` を開き直して、`session` を渡す(開いている `BattleView` があれば、その局面を置き換える)。

- [ ] **Step 3: README を足す**
  対戦の画面の節に、「Battle: start battle」の説明(デッキを選ぶ、相手はランダムか選ぶ、ルールが無いカードはスキップ、統率戦は不可、いまはまだ操作できない)。

- [ ] **Step 4: ビルドとテストを確かめる**
  Run: `npm run build 2>&1 | tail -3 && npm test 2>&1 | tail -3` / Expected: ビルド成功・全部 `PASS`(`view names ok` を含む)。

- [ ] **Step 5: ユーザーが画面で確認する項目を渡す**(Obsidian を動かせないので、「動かしていない」と言う)
  ①コマンドでモーダルが開く。②自分のデッキを選ぶと、相手の候補が、同じフォーマットで使えるデッキに絞られる。③統率戦のデッキは選べず、理由が出る。④ルールが無いカードの一覧が出る。⑤「始める」で、手札7枚が配られた盤面が出る(手札が、自分のデッキのカード)。⑥山札の枚数が、デッキの枚数 − 7。⑦7枚に足りないデッキは、お知らせが出る。⑧情報取得(忠誠度)後に、プレインズウォーカーが戦場に出たとき、忠誠度が出る(段階3以降で確認)。

- [ ] **Step 6: コミット・リリース**(ユーザーが言ったときだけ。版は 0.64.0)

---

## Self-Review

- **Spec coverage(段階2):** デッキ選択・相手のデッキ(フォーマットで絞る / ランダム)(タスク5)/ `startGame`・手札7枚(タスク3)/ カード → `GameCard`(タスク2)/ ルールが無いカードのログ(タスク4)/ 始める前のルール一覧(タスク3・5)/ 忠誠度の保存(タスク1)/ 統率戦は不可(タスク3・5)。**範囲外**: 操作・マリガン・先手後手の決め方・相手の動き。
- **型の一貫性:** `CardData` / `DeckData` / `buildMatch` / `unruledCards` / `MatchError` はタスク2・3で定義し、タスク5が使う。`Game.skipUnruled` はタスク3・4で同じ名前。`BattleSession` はタスク5で定義。
- **Review Focus:** 5行とも、担当のタスクのテストまたは確認項目に入れた。
- **比率:** 本体のコードは書かず、シグネチャ・テストの内容・決めた値だけを書いた。
