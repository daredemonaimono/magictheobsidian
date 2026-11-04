# 対戦機能の核(1/2: ノードと進行エンジン) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 汎用ノードで能力を表し、md に展開・読み込みでき、画面なしの進行エンジン(ターン・優先権・スタック)で、打ち消し3種(Negate / Essence Scatter / Spell Snare)が応答し合うところまでテストで動かす。

**Architecture:** `src/battle/` に、(1) ノードの型とレジストリ、(2) `Rules/*.md` の読み書き、(3) ゲーム状態と進行エンジン、(4) 実装済みノード、(5) カードごとの状況レポートを置く。ノードは `NodeDef` 1つが唯一の元データで、検証・実行・一覧はそこから作る。エンジンは Obsidian に依存せず、`npm test` だけで動かせる。

**Tech Stack:** TypeScript(`tsc --noEmit` が通ること)、esbuild、`node:assert` のテスト(`test/run.mjs` が `test/*.test.ts` を拾う)。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-11-04-battle-core-design.md`(本計画は 1/2。AI による組み立ては 2/2 で、本計画の完成後に、実物のノード一覧を元に書く)

## Global Constraints

- 能力は4分類のみ: `spell`(呪文能力) / `activated`(起動型能力) / `triggered`(誘発型能力) / `static`(常在型能力)。
- カード専用のノードを作らない。ノードは「それ以上分けられないパーツ」だけで、打ち消しも `counter` 1つに対象の条件を渡す。
- タイミング(インスタント/ソーサリー)はカードタイプから決める。ノードにしない。
- プレイヤーは `PlayerId[]`(リスト)で持ち、相手は `opponentsOf` で引く。実装は1対1だけ。
- 枠の8項目(結果の受け渡し・置換・レイヤー・唱えた記録・持続・新しい物の生成・各対戦相手・マナ制限)は、型と置き場所を `node.ts` に定義する。実装するのは結果の受け渡しと各対戦相手だけ。
- 保存先は vault の `Rules/<カード名>.md`(`.obsidian/plugins/` 内には置かない)。`Cards/` は読むだけ。
- 0.40.0 のコード(`archive/battle-rules-0.40.0`)は再利用しない。
- コメントとメッセージは日本語。既存の作法(`test/rules.test.ts` の、トップレベルの `assert`)に合わせる。
- コミット・push・リリースは、じゅまが依頼したときだけ。各タスクの区切りは「`npm test` と `npm run build` が通る」こと。
- 準備済・麻痺カウンター・チームワーク・盤面 UI・多人数戦は扱わない。

## Review Focus

1. 唱えたあと、解決の前に対象が消えた(打ち消されて墓地へ行った)とき: 打ち消し側は何もせず墓地へ行き、例外を出さない。(Task 5)
2. 合法な対象が1つも無いとき: 唱えられず、状態が変わらない(Negate をスタックが空のときに唱える)。(Task 4)
3. 手で直した md に、未知のノード・足りない引数・見出しの重複・全角スペースがあるとき: 行番号つきのエラーで、そのカードだけ「組めていない」になり、ほかのカードは読み込める。(Task 2, 6)
4. 全員が連続でパスしたとき: スタックが空なら次のステップへ、空でなければ一番上だけを解決し、無限ループしない。(Task 3)
5. 打ち消し呪文を、相手が打ち消し返したとき: 後から唱えた方が先に解決し、元の呪文は残る。(Task 5)

---

## File Structure

- `src/battle/node.ts` — 型(`NodeDef` / `NodeCall` / `Ability` / `CardRule`)と、枠の8項目の型
- `src/battle/registry.ts` — ノードの登録・検索・呼び出しの検証
- `src/battle/ruleMd.ts` — `Rules/*.md` の `parseRule` / `writeRule`
- `src/battle/state.ts` — `Game` とその生成、`opponentsOf`
- `src/battle/engine.ts` — ステップ進行・優先権・唱える・解決
- `src/battle/nodes.ts` — 実装済みノード(`target` / `counter`)の登録
- `src/battle/coverage.ts` — カードごとの状況と、ノードの使用先
- `src/battle/samples.ts` — 打ち消し3種の `Rules/*.md` の本文とシナリオ
- `src/main.ts` — コマンド2つの追加(Task 7)
- `test/battle-node.test.ts` / `battle-md.test.ts` / `battle-game.test.ts` / `battle-spell.test.ts` / `battle-coverage.test.ts`

---

### Task 1: ノードの型とレジストリ

**Files:**
- Create: `src/battle/node.ts`, `src/battle/registry.ts`
- Test: `test/battle-node.test.ts`

**Interfaces:**
- Produces(後続が使う):
```ts
export type Value = string | number | boolean;
export type Arg = Value | { ref: string };          // ref = 前のノードの as の名前
export interface NodeCall { node: string; as?: string; args: Record<string, Arg> }
export type AbilityKind = "spell" | "activated" | "triggered" | "static";
export interface Ability { kind: AbilityKind; body: NodeCall[] }
export interface CardRule { card: string; abilities: Ability[] }
export type ParamDef = { type: "string" | "number" | "boolean" | "ref"; required?: boolean; choices?: string[] };
export interface NodeDef {
  id: string; title: string; summary: string;          // title/summary は日本語 (一覧・AI への指示の元)
  params: Record<string, ParamDef>;
  outputs: Record<string, "id" | "number" | "boolean">; // 結果の受け渡し
  isTarget?: boolean;                                    // 唱えるときに対象を選ぶノード
  run?: (ctx: RunCtx, args: Record<string, Value>) => Record<string, Value>; // 無ければ「未実装」
}
// 枠の8項目 (型だけ。実装は後)
export type Duration = { until: "endOfTurn" | "whileAttached" | "forever" };
export interface CastRecord { kicked?: boolean; modes?: number[]; extraCosts?: string[] }
export interface ReplacementHook { id: string; applies: (event: string) => boolean }
export interface LayerEffect { layer: 4 | 5 | 6 | 7; effect: string }
export interface ManaRestriction { onlyFor: string }
export interface Created { kind: "token" | "emblem"; name: string }
```
  `RunCtx` は Task 3 の `Game` を使うので、`node.ts` では `export type RunCtx = import("./engine").RunCtx` と宣言し、Task 4 で実体を足す。
```ts
export function defineNode(def: NodeDef): void;
export function getNode(id: string): NodeDef | undefined;
export function allNodes(): NodeDef[];
export function checkCall(call: NodeCall): string | null;   // 問題なければ null、あれば日本語の理由
export function resetRegistry(): void;                       // テスト用
```

- [ ] **Step 1: テストを書く**(`test/battle-node.test.ts`)
  - `defineNode` したノードを `getNode` で取れる。同じ id を2回定義すると throw。
  - `checkCall({node:"nope",args:{}})` は `"未知のノード: nope"` を含む文字列。
  - 必須引数が無い呼び出し → `"必須の引数がない: <名前>"` を含む。
  - `choices` に無い値 → `"選べない値"` を含む。型違い(number に文字列)→ `"型が違う"` を含む。
  - `{ref:"t"}` は `type:"ref"` の引数でだけ通る。
- [ ] **Step 2:** `npm test` を実行し、`battle-node.test.ts` が FAIL(モジュール無し)になる。
- [ ] **Step 3:** `node.ts` に上の型を、`registry.ts` に上の関数を実装する。レジストリは `Map<string, NodeDef>`。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 2: `Rules/*.md` の書式と読み書き

**Files:**
- Create: `src/battle/ruleMd.ts`
- Test: `test/battle-md.test.ts`

**Interfaces:**
- Consumes: `CardRule` / `Ability` / `NodeCall` / `Arg`(Task 1)
- Produces:
```ts
export class RuleParseError extends Error { constructor(message: string, public line: number) }
export function parseRule(md: string): CardRule;     // 失敗時は RuleParseError (行番号つき)
export function writeRule(rule: CardRule): string;   // parseRule の逆。正規化した形
```
書式(Negate の例。これが正):
```
---
mtg: rule
card: "[[Negate]]"
---

## 呪文能力

- target as=t zone=stack kind=spell notType=creature
- counter target=$t
```
  見出しは `呪文能力` / `起動型能力` / `誘発型能力` / `常在型能力`(= 4分類)。同じ見出しは何度あってもよく、1見出し=1能力。箇条書き1行=1ノード呼び出し: `<ノードid> [as=<名前>] <引数>=<値> ...`。値は `$名前`(ref)、整数、`true`/`false`、それ以外は文字列(空白を含むときは `"..."`)。全角スペースは半角として扱う。

- [ ] **Step 1: テストを書く**
  - 上の Negate の md を `parseRule` → `card === "Negate"`、`abilities.length === 1`、`kind === "spell"`、`body[0].args.notType === "creature"`、`body[1].args.target` が `{ref:"t"}`、`body[0].as === "t"`。
  - `writeRule(parseRule(md)) === md`(正規化済みの入力で往復が一致)。
  - 全角スペース・行頭の余計な空白・`mv=2`(数値) / `flag=true`(真偽) / `name="a b"`(引用)を含む md が読める。
  - 見出しの重複 → `abilities.length === 2`。
  - 異常系はどれも `RuleParseError` で、`line` が該当行: `card:` が無い / 未知の見出し / 見出しの前の箇条書き / `key=` の値が空。
- [ ] **Step 2:** `npm test` で `battle-md.test.ts` が FAIL。
- [ ] **Step 3:** `ruleMd.ts` を実装する。1行ずつ読む素朴なパーサ(正規表現でフロントマターの `card:` を取り、トークン分割は引用を考慮)。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 3: ゲーム状態・ステップ進行・優先権・スタック

**Files:**
- Create: `src/battle/state.ts`, `src/battle/engine.ts`(進行の部分)
- Test: `test/battle-game.test.ts`

**Interfaces:**
- Consumes: `CastRecord`(Task 1)
- Produces:
```ts
export type PlayerId = string;
export type Step = "untap" | "upkeep" | "draw" | "main1" | "combat" | "main2" | "end";
export interface GameCard { id: string; name: string; typeLine: string; mv: number; owner: PlayerId; flash?: boolean }
export interface StackItem { id: string; card: GameCard; controller: PlayerId; targets: Record<string, string>; cast: CastRecord }
export interface Game {
  players: PlayerId[]; active: PlayerId; step: Step; priority: PlayerId | null; passes: PlayerId[];
  hands: Record<PlayerId, GameCard[]>; graveyards: Record<PlayerId, GameCard[]>; stack: StackItem[]; log: string[];
}
export function createGame(players: PlayerId[]): Game;      // active=players[0], step="main1", priority=active
export function opponentsOf(g: Game, p: PlayerId): PlayerId[];
export interface RuleBook { get(card: string): CardRule | undefined }   // カード名 → ルール (Task 4 以降で使う。Task 3 のテストは空の RuleBook を渡す)
export function passPriority(g: Game, p: PlayerId, rules: RuleBook): "passed" | "resolved" | "stepEnded";
export function nextPlayer(g: Game, p: PlayerId): PlayerId;
export function canCastNow(g: Game, p: PlayerId, card: GameCard): boolean; // カードタイプから決める
```
  優先権の規則: `passPriority` は `g.priority === p` のときだけ有効(違えば throw)。パスしたら次のプレイヤーに優先権が移り、全員が連続でパスしたとき、スタックが空なら `step` を次へ進めて active に優先権、空でなければ一番上を解決して active に優先権(解決は Task 4 で実装済みの `resolveTop` を呼ぶ。この時点では「一番上を取り除いて墓地へ」だけ)。`untap` ステップは優先権なし。`end` の次は、相手を active にして `upkeep` へ。`canCastNow`: インスタントか `flash` なら優先権があればいつでも。それ以外は、自分が active・`main1`/`main2`・スタックが空のときだけ。

- [ ] **Step 1: テストを書く**
  - `createGame(["A","B"])`: `active==="A"`、`priority==="A"`、`opponentsOf(g,"A")` は `["B"]`。3人でも `opponentsOf` は自分以外の全員。
  - A がパス → `priority==="B"`。B もパス(スタック空)→ `step==="combat"`、`priority==="A"`。
  - B が `priority` を持たないときに `passPriority(g,"B")` → throw。
  - スタックに2つ積んで全員パス → 一番上の1つだけが解決(墓地へ)され、`stack.length===1`、`priority==="A"`。
  - `end` を抜けると `active==="B"`、`step==="upkeep"`。
  - `canCastNow`: インスタント(`typeLine:"Instant"`)は B が優先権を持っていれば A のターン中でも true / ソーサリーは B では false、A の `main1` でスタック空なら true、スタックが空でなければ false。
- [ ] **Step 2:** `npm test` で FAIL。
- [ ] **Step 3:** `state.ts`(型・`createGame`・`opponentsOf`)と `engine.ts`(`passPriority` / `nextPlayer` / `canCastNow` と、仮の `resolveTop(g: Game, rules: RuleBook): void`=一番上を取り除いて墓地へ)を実装する。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 4: 対象・打ち消しノードと、呪文を唱える

**Files:**
- Create: `src/battle/nodes.ts`, `src/battle/samples.ts`
- Modify: `src/battle/engine.ts`(`castSpell` と本物の `resolveTop`)、`src/battle/node.ts`(`RunCtx` の実体)
- Test: `test/battle-spell.test.ts`

**Interfaces:**
- Consumes: Task 1〜3 の全部
- Produces:
```ts
export interface RunCtx { game: Game; item: StackItem; vars: Record<string, Value> }
export class RuleError extends Error {}
export function castSpell(g: Game, p: PlayerId, cardId: string, targets: Record<string, string>, rules: RuleBook): void;
export function resolveTop(g: Game, rules: RuleBook): void;
export function registerBuiltinNodes(): void;       // target / counter を defineNode
export const SAMPLE_RULES: Record<string, string>;  // "Negate" | "Essence Scatter" | "Spell Snare" → md 本文
```
  ノード(`registerBuiltinNodes`):
  - `target`: `isTarget: true`。引数 `zone`(choices `["stack"]`)、`kind`(choices `["spell"]`)、省略可の `type` / `notType`(文字列、型行に含まれるか)、`mv`(number)。出力 `id`。`run` は、対象が今も条件に合うか調べ、合えば `{id}` を返し、合わなければ `{}` を返す。
  - `counter`: 引数 `target`(ref)。`run` は対象の呪文をスタックから取り除き、持ち主の墓地へ置き、`log` に1行足す。
  `castSpell`: 手札にあるカード、`canCastNow`、ルール(`rules.get(card.name)` の `spell` 能力)があること、`isTarget` のノードごとに `targets[as]` が条件に合う合法な対象であること、を確かめ、合わなければ `RuleError`(状態は変えない)。通れば手札からスタックへ置き、`priority` は唱えた人に戻し、`passes` を空にする。
  `resolveTop`: 一番上の呪文の `spell` 能力の `body` を順に `run`。`as` の出力は `vars` に入れ、`{ref}` 引数は `vars` から引いて渡す。`run` が無いノードは `log` に「未実装: <id>」を出して飛ばす。解決後、呪文自身は墓地へ。

- [ ] **Step 1: テストを書く**(`SAMPLE_RULES` を `parseRule` で読んだ `RuleBook` を使う。カードは `mv`/`typeLine` を持たせる)
  - Negate(`Instant`, mv 2)を A が唱え、対象に B の「クリーチャーでない呪文(Lightning Bolt 相当)」を指定 → 全員パスで Negate が解決し、Bolt は B の墓地、Negate は A の墓地。
  - Negate の対象にクリーチャー呪文 → `RuleError`、`stack.length` が変わらない。
  - Essence Scatter はクリーチャー呪文だけ、Spell Snare は `mv===2` の呪文だけを対象にできる(mv 3 は `RuleError`)。
  - スタックが空のとき Negate → 対象を指定できず `RuleError`(Review Focus 2)。
  - `run` の無いノードを含む `RuleBook` で解決 → `log` に `"未実装: "` を含む行があり、例外は出ない。
- [ ] **Step 2:** `npm test` で FAIL。
- [ ] **Step 3:** 上の関数を実装する。サンプルの md は Task 2 の書式で、3枚とも `target` と `counter` の2行だけ(条件は `notType=creature` / `type=creature` / `mv=2`)。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 5: 応答の連鎖と、対象が消えた解決

**Files:**
- Modify: `src/battle/engine.ts`(必要なら)
- Test: `test/battle-spell.test.ts`(追記)

**Interfaces:** Task 4 の関数のみ。

- [ ] **Step 1: テストを追記する**
  - A が Bolt を唱え、B が Negate で打ち消し、A が Essence Scatter ではなく Negate で打ち消し返す(対象は B の Negate): 後から唱えた A の Negate が先に解決し、B の Negate は墓地へ、Bolt は残って最後に解決する。解決の順は `log` で確認する(Review Focus 5)。
  - 同じ対象を2つの打ち消しが狙う: 先に解決した方が対象を打ち消し、後の方は対象が無く何もしないが、例外は出ず、自分は墓地へ行く(Review Focus 1)。
  - 相手のターン中(B が active)に、A が優先権を得て Negate を唱えられる(インスタントのタイミング)。
- [ ] **Step 2:** `npm test` を実行し、通らないものがあれば FAIL を確認する(すでに通るなら、その旨を記録して Step 3 は不要)。
- [ ] **Step 3:** 失敗した分だけ `engine.ts` を直す。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 6: カードごとの状況と、ノードの使用先

**Files:**
- Create: `src/battle/coverage.ts`
- Modify: `src/battle/samples.ts`(シナリオを足す)
- Test: `test/battle-coverage.test.ts`

**Interfaces:**
- Consumes: `parseRule` / `checkCall` / `getNode`(Task 1〜2)、`SAMPLE_RULES`(Task 4)
- Produces:
```ts
export type Status = "ok" | "partial" | "unbuilt";
export interface CardStatus { card: string; status: Status; reasons: string[] }
export type Scenario = () => void;                 // 最小シナリオ。失敗したら throw
export const SCENARIOS: Record<string, Scenario>;  // samples.ts。Negate / Essence Scatter / Spell Snare
export function cardStatus(card: string, md: string | undefined): CardStatus;
export function nodeUsers(rules: CardRule[], nodeId: string): string[];  // そのノードを使うカード名
export function report(cards: CardStatus[]): string;                      // md の本文 (カード | 状況 | 理由)
```
  判定: md が無い、または `RuleParseError`・未知のノード・引数の誤り → `unbuilt`(理由に行番号つきメッセージ)。md は有効だが、`run` の無いノードを含む、または `SCENARIOS[card]` が無い、またはシナリオが throw → `partial`(理由を書く)。すべて実装済みでシナリオも通れば `ok`。

- [ ] **Step 1: テストを書く**
  - 打ち消し3種の `SAMPLE_RULES` は `ok`。
  - md が `undefined` → `unbuilt`。未知のノードを書いた md → `unbuilt` で `reasons[0]` に行番号。
  - `defineNode` で `run` 無しのノード `draw` を足して使った md → `partial`、`reasons` に `"未実装: draw"`。
  - 有効な md だがシナリオ無しのカード → `partial`(理由に「シナリオが無い」)。
  - 壊れた md が1つあっても、ほかのカードの `cardStatus` は影響を受けない(Review Focus 3)。
  - `nodeUsers([...3枚], "counter")` は3枚の名前、`"target"` も同じ。
  - `report(...)` は先頭行に `| カード | 状況 | 理由 |` を含む。
- [ ] **Step 2:** `npm test` で FAIL。
- [ ] **Step 3:** 実装する。シナリオは、`castSpell` → 全員パスまでを1枚ごとに書き、期待どおりでなければ `assert` で throw させる。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 7: Obsidian への接続(コマンド2つ)

**Files:**
- Modify: `src/main.ts`(`onload` に `addCommand` を2つ)
- Create: なし(読み書きは `main.ts` の中の小さな private メソッドで足りる)

**Interfaces:**
- Consumes: `SAMPLE_RULES`、`cardStatus`、`report`、`registerBuiltinNodes`(Task 4〜6)
- 定数: `RULES_DIR = "Rules"`(`CARD_DIR` / `DECK_DIR` と同じ作法)

- [ ] **Step 1: コマンド「Battle: create sample rules」**を追加する。`Rules/` が無ければ作り、`SAMPLE_RULES` の3枚を `Rules/<カード名>.md` として書く。すでにあるファイルは上書きしない(`Notice` で「あるのでスキップ」)。
- [ ] **Step 2: コマンド「Battle: rules coverage」**を追加する。`Cards/` の全カード名に対して、`Rules/<名前>.md` の本文(無ければ `undefined`)から `cardStatus` を作り、`Rules/_coverage.md` に `report` を書き出す(既存なら更新)。`_` で始まるファイルは、ルールとして読まない。
- [ ] **Step 3:** `onload` の先頭で `registerBuiltinNodes()` を1回呼ぶ。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。
- [ ] **Step 5(じゅまの確認):** Obsidian でプラグインを読み込み直し、(a) サンプル作成コマンドで `Rules/` に3枚できる、(b) 1枚を手で壊して coverage を実行すると、その1枚だけ `unbuilt`(行番号つき)になり、`_coverage.md` の `Cards/` の残りは `unbuilt`(md 無し)で、打ち消し3種は `ok` になる。これは Obsidian 上の確認で、スクリプトでは検証しない。

---

## Self-Review

- **Spec coverage:** 4分類=Task 1(`AbilityKind`)・Task 2(見出し) / カード専用ノード禁止=Global Constraints と Task 4(`counter` に条件を渡す) / 保守(3状態・使用先・動いた記録)=Task 6 / 枠の8項目の型=Task 1 / 進行(ターン・優先権・スタック)と応答=Task 3〜5 / md 展開と手修正=Task 2・7 / 1対1・リスト=Task 3(`opponentsOf`) / AI による組み立て=本計画の対象外(2/2)。ギャップはこれだけ。
- **Type consistency:** `NodeCall` / `CardRule` / `RunCtx` / `RuleBook` / `castSpell` / `resolveTop` / `cardStatus` の名前と型は、定義した Task と使う Task で一致。`RuleBook` は Task 3 で定義し、`passPriority` と `resolveTop` は最初から `rules` を取る(Task 3 の `resolveTop` は仮=一番上を墓地へ。Task 4 で本物に置き換える)。
- **Proportion:** 設計書より長いが、コードは署名・テスト名・値だけで、本体は書いていない。
