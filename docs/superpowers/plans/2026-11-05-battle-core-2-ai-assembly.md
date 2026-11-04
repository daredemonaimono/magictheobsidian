# 対戦機能の核(2/2: AI による組み立て) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プラグイン設定に API キー(Obsidian のキーチェーンに保存)を設定し、コマンドから AI にカードのノード組み立てを頼んで、検証を通った `Rules/<カード名>.md` を作れるようにする。

**Architecture:** 純粋関数(指示文の組み立て、Messages API の呼び出し、検証つきのやり直しループ)を `src/battle/` に置き、HTTP は差し替え可能にしてテストする。設定画面とコマンドは `main.ts` / `settings.ts` に薄く足す。

**Tech Stack:** TypeScript、Obsidian の `requestUrl` と `app.secretStorage` / `SecretComponent`(1.11.4 以上)、Anthropic Messages API(SDK は入れない)。

**Spec:** `docs/superpowers/specs/2026-11-04-battle-core-design.md`(4.10 節)。前提: 計画 1/2(`2026-11-04-battle-core-1-nodes-and-engine.md`)の完成。

## Global Constraints

- API キーを `data.json`・ログ・ノート・`Notice` に出さない。設定に残るのは、キーチェーン上の名前(`claudeKeySecret`)だけ。
- 呼び出しは `POST https://api.anthropic.com/v1/messages`、ヘッダは `x-api-key` / `anthropic-version: 2023-06-01` / `content-type: application/json`。`temperature` などのサンプリング引数と `thinking` は送らない(新しいモデルは 400 になる)。`max_tokens` は 16000(非ストリーミング)。
- 返事の `stop_reason` が `"refusal"` のとき、`content` を読まずにエラーにする。`content` は `type:"text"` のブロックだけをつなぐ。
- 保存するのは `parseRule` と `checkCall` を通ったものだけ。AI に頼むのは、画面でチェックされたカードだけ。すでにある `Rules/<カード名>.md` を上書きするときは、直前の内容を `Rules/_backup/<カード名>.md` に1世代だけ退避してから書く。
- 1/2 の制約(カード専用ノード禁止・4分類・日本語のコメント・`npm test` と `npm run build` が通る)を引き継ぐ。コミット・push・リリースは、じゅまが依頼したときだけ。
- `main.ts` の設定は、`data.json` のキーを1つずつ読む作り(`onload`)。新しい設定は、そこにも足す。

## Review Focus

1. 返事が空・text ブロックなし・`refusal`・HTTP 401/429/5xx のとき: 日本語のエラーになり、`Rules/` には何も書かれない。(Task 3, 4)
2. AI が存在しないノードや、別のカード名を書いたとき: 1回やり直し、それでもだめなら保存せず、理由を出す。(Task 4)
3. API キーが未設定のとき: 通信せず、設定を開くよう案内する。(Task 7)
4. すでに `Rules/<カード名>.md` があるカード: 画面では未チェックで始まる。チェックして実行したときだけ、退避してから上書きする。AI が失敗したときは、元のファイルを変えない。(Task 6, 7)
5. `## 未対応` つきの md を読み書きしたとき: 内容が往復し、状況レポートでは `partial` になる。(Task 1)

---

## File Structure

- `src/battle/ruleMd.ts` — 修正: `## 未対応` の節
- `src/battle/node.ts` — 修正: `CardRule.unsupported?: string[]`
- `src/battle/coverage.ts` — 修正: 未対応があれば `partial`
- `src/battle/prompt.ts` — 新規: 指示文の組み立て
- `src/battle/claude.ts` — 新規: Messages API の呼び出し
- `src/battle/build.ts` — 新規: 検証つきのやり直しループ
- `src/battle/select.ts` — 新規: 画面に出す行と、初期のチェック
- `src/BuildRulesModal.ts` — 新規: カードを選ぶ画面
- `src/settings.ts` / `src/main.ts` — 修正: 設定とコマンド
- `test/battle-ai-*.test.ts`

---

### Task 1: `## 未対応` の節

**Files:**
- Modify: `src/battle/node.ts`、`src/battle/ruleMd.ts`、`src/battle/coverage.ts`
- Test: `test/battle-md.test.ts`、`test/battle-coverage.test.ts`(追記)

**Interfaces:**
- Produces: `CardRule.unsupported?: string[]`。md では `## 未対応` の下の箇条書き1行 = 1項目(ノード呼び出しではなく、文章のまま)。`parseRule` が読み、`writeRule` が最後に書く。

- [ ] **Step 1: テストを追記する**
  - `## 呪文能力` + `- counter target=$t` のあとに `## 未対応` + `- 対象の呪文のコントローラーが{2}を払うなら打ち消さない` を持つ md を `parseRule` → `unsupported` が `["対象の呪文のコントローラーが{2}を払うなら打ち消さない"]`。`writeRule` で往復が一致。
  - `unsupported` が無い md は、これまでどおり `unsupported` が `undefined`。
  - `cardStatus` は、ノードがすべて実装済みでシナリオが通っても、`unsupported` があれば `partial` で、`reasons[0]` が `"未対応: "` で始まる。
- [ ] **Step 2:** `npm test` で追記分が FAIL。
- [ ] **Step 3:** `HEADINGS` に特別扱いの見出し「未対応」を足す(能力の見出しとは別に処理し、箇条書きを文字列のまま集める)。`cardStatus` は、`checkCall` を通ったあと、`unsupported?.length` なら `partial` を返す(先に判定。`未実装:` の理由より前に並べる)。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 2: 指示文の組み立て

**Files:**
- Create: `src/battle/prompt.ts`
- Test: `test/battle-ai-prompt.test.ts`

**Interfaces:**
- Consumes: `allNodes`(Task 1/2 of plan 1)、`SAMPLE_RULES`
- Produces:
```ts
export function buildPrompt(card: string, oracle: string): { system: string; user: string };
```
  `system`: 役割(カードのテキストを、ノードの組み合わせの md に直す)、書式の説明(見出し=4分類、箇条書き=ノード1行、`as=` と `$名前`、値の書き方)、使えるノードの一覧(`allNodes()` から id・日本語名・説明・各引数の型/必須/選択肢)、規則(一覧に無いノードを作らない / カード専用の組み立てを避け汎用ノードの引数で表す / 表せない部分は `## 未対応` に書く / 返事は md 1つだけを ```md の囲みで)、例として `SAMPLE_RULES["Negate"]`。`user`: カード名とオラクルテキスト。

- [ ] **Step 1: テストを書く**
  - `registerBuiltinNodes()` したうえで `buildPrompt("Negate","Counter target noncreature spell.")` → `system` に `target` と `counter` の id、`notType` と `mv` の引数名、`## 未対応`、`SAMPLE_RULES` の Negate の本文を含む。`user` にカード名とオラクルテキストを含む。
  - 新しく `defineNode` したノードが、次の呼び出しで `system` に出る(一覧がレジストリ由来であること)。
  - ノードが1つも無いとき throw しない。
- [ ] **Step 2:** `npm test` で FAIL。
- [ ] **Step 3:** `prompt.ts` を実装する(文字列の組み立てだけ)。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 3: Messages API の呼び出し

**Files:**
- Create: `src/battle/claude.ts`
- Test: `test/battle-ai-claude.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Msg { role: "user" | "assistant"; content: string }
export type Http = (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; json: any }>;
export class ClaudeError extends Error {}
export async function askClaude(o: { apiKey: string; model: string; system: string; messages: Msg[]; http: Http }): Promise<string>;
export const obsidianHttp: Http; // requestUrl (throw: false) を包む。main から渡す
```
  送るもの: Global Constraints のとおり。成功時は `type:"text"` のブロックをつないだ文字列。エラーは `ClaudeError`(日本語): 401 → `APIキーが無効`、429 → `レート制限`、5xx/529 → `API が混雑している`、そのほか → `HTTP <status>` + `error.message`、`stop_reason:"refusal"` → `AI が応答を拒否した`、text が空 → `空の返事`。

- [ ] **Step 1: テストを書く**(`http` に偽物を渡す)
  - 正常: 返事の text ブロック2つ(間に thinking ブロック)がつながって返る。送った `url`・ヘッダ(`x-api-key`・`anthropic-version`)・body(`model`・`max_tokens===16000`・`system`・`messages`)を偽物の側で検証し、body に `temperature` と `thinking` が無い。
  - 401 / 429 / 529 / 400(`error.message` つき)/ `stop_reason:"refusal"` / content が空、のそれぞれで `ClaudeError` と、上のメッセージ。
  - エラーメッセージに `apiKey` の文字列が含まれない。
- [ ] **Step 2:** `npm test` で FAIL。
- [ ] **Step 3:** 実装する。`obsidianHttp` は `requestUrl({ url, method: "POST", headers, body, throw: false })` を包む。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 4: 検証つきのやり直しループ

**Files:**
- Create: `src/battle/build.ts`
- Test: `test/battle-ai-build.test.ts`

**Interfaces:**
- Consumes: `buildPrompt`(Task 2)、`askClaude`/`Msg`(Task 3)、`parseRule`、`checkCall`
- Produces:
```ts
export class BuildError extends Error { constructor(message: string, public problems: string[]) }
export async function buildRule(o: { card: string; oracle: string; ask: (system: string, messages: Msg[]) => Promise<string> }): Promise<{ md: string; attempts: number }>;
```
  流れ: `buildPrompt` → `ask` → 返事から ```md ... ``` の中身を取り出す(囲みが無ければ全体)→ `parseRule`(`RuleParseError`)→ `rule.card === card` → 全ノード呼び出しを `checkCall`。問題がなければ `{md, attempts}`(`md` は取り出した本文のまま)。問題があれば、`assistant`(前の返事)と `user`(問題を箇条書きにして「直して、md だけ返して」)を足してもう1回だけ聞く。2回目もだめなら `BuildError`(`problems` に最後の問題)。

- [ ] **Step 1: テストを書く**(`ask` に偽物を渡す)
  - 1回目で通る: `attempts===1`、`md` が返事の囲みの中身。
  - 1回目が未知のノード `teleport`、2回目が正しい md: `attempts===2`、2回目の `messages` の最後の `user` に `"未知のノード: teleport"` と行番号を含む。
  - 1回目が `card:` 違い(`Essence Scatter` を `Negate` として返す)→ 問題に `card:` の不一致。2回続けてだめなら `BuildError`、`problems.length>0`、`ask` は2回だけ呼ばれる(Review Focus 2)。
  - 囲みなしの返事でも通る。`## 未対応` つきの md も通る。
  - `ask` が `ClaudeError` を投げたら、そのまま伝わる(やり直さない)。
- [ ] **Step 2:** `npm test` で FAIL。
- [ ] **Step 3:** 実装する。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 5: 設定(API キーはキーチェーンに保存)

**Files:**
- Modify: `src/settings.ts`、`src/main.ts`(`onload` の設定読み込み)
- Test: なし(Obsidian 上の確認。`npm run build` が通ること)

**Interfaces:**
- Produces: `Settings.claudeKeySecret: string`(キーチェーン上の名前。既定 `""`)、`Settings.claudeModel: string`(既定 `"claude-opus-5-5"`)。`export const claudeKey = (app: App, s: Settings): string | null`(`s.claudeKeySecret` が空なら null、そうでなければ `app.secretStorage.getSecret(...)`)。

- [ ] **Step 1:** `Settings` と `DEFAULT_SETTINGS` に2項目を足し、`main.ts` の設定読み込み(`d.claudeKeySecret ?? ...`)にも足す。
- [ ] **Step 2:** `SettingsTab.display()` の末尾に、見出し「AI(ノードの組み立て)」の下で2つ足す。(a) 「API キー / Claude API key」: `new Setting(...).addComponent((el) => new SecretComponent(this.app, el).setValue(this.settings.claudeKeySecret).onChange(async (id) => { this.settings.claudeKeySecret = id ?? ""; await this.save(); }))`。説明に「Obsidian のキーチェーンに保存される。このプラグインの設定には、保存先の名前だけが残る」と書く。(b) 「モデル / Model」: テキスト欄(既定 `claude-opus-5-5`、説明に「安く済ませたいときは `claude-sonnet-5-5` など」)。
- [ ] **Step 3:** `npm test` と `npm run build` が通る。
- [ ] **Step 4(じゅまの確認):** 設定画面に「API キー」の欄が出て、キーの入力・選択ができる。入力後、`data.json` にキーそのものが無く、名前だけが残っている。

### Task 6: 画面に出す行と、初期のチェック

**Files:**
- Create: `src/battle/select.ts`
- Test: `test/battle-ai-select.test.ts`

**Interfaces:**
- Consumes: `CardStatus`(`coverage.ts`)
- Produces:
```ts
export interface Row { card: string; hasRule: boolean; status: Status | "none" }  // none = ルールのノートが無い
export function toRows(cards: string[], statuses: Map<string, CardStatus>): Row[];   // 名前順
export const initialChecked = (rows: Row[]): Set<string>;   // ルールのノートが無いカードだけ
export const filterRows = (rows: Row[], q: string): Row[];   // 名前の部分一致 (大文字小文字を区別しない)
```
  `toRows`: `statuses` に無いカード、または `reasons` が `["ルールのノートが無い"]` のカードは `hasRule:false` / `status:"none"`。ほかは `hasRule:true` で、状況はそのまま。

- [ ] **Step 1: テストを書く**
  - 3枚(ルール無し / `ok` / `unbuilt`(壊れた md))→ `initialChecked` は、ルール無しの1枚だけ。壊れた md のカードは `hasRule:true` なので、チェックされない。
  - `toRows` は名前順で、`status` が `"none" | "ok" | "partial" | "unbuilt"` に分かれる。
  - `filterRows(rows, "neg")` が `Negate` を含み、`Island` を含まない。空文字は全部。
  - 全カードにルールがあるとき、`initialChecked` は空。
- [ ] **Step 2:** `npm test` で FAIL。
- [ ] **Step 3:** 実装する。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。

### Task 7: 画面とコマンド

**Files:**
- Create: `src/BuildRulesModal.ts`
- Modify: `src/main.ts`
- Test: なし(Obsidian 上の確認。ロジックは Task 2〜4・6 でテスト済み)

**Interfaces:**
- Consumes: `buildRule`(Task 4)、`askClaude`/`obsidianHttp`(Task 3)、`claudeKey`(Task 5)、`toRows`/`initialChecked`/`filterRows`(Task 6)、`cardStatus`(`coverage.ts`)、既存の `localCards` / `oracleEnglish`(`cards.ts`)、`RULES_DIR`
- Produces:
```ts
export class BuildRulesModal extends Modal {
  constructor(app: App, rows: Row[], onRun: (names: string[]) => void);
}
```

- [ ] **Step 1: `BuildRulesModal`**: 上に絞り込み欄(`filterRows`)、「全部チェック」「全部外す」「ルールが無いカードだけ」(`initialChecked` に戻す)のボタン。行ごとにチェックボックス、カード名、状況の表示(ルールなし / ok / partial / unbuilt)。ルールがあるカードには「上書きされる」と薄く添える。下に「選んだ N 枚で実行」ボタン(0枚なら押せない)。押したら閉じて `onRun(チェックされた名前)`。チェックは、絞り込みで一覧から消えても保持する。初期のチェックは `initialChecked`。
- [ ] **Step 2: 共通の private メソッド** `buildRulesFor(names: string[])`(`main.ts`): キーが無ければ `Notice("設定で API キーを選んでください")` を出して終わる(通信しない)。`names` を順に処理する。各カードは `oracleEnglish` を読み、`buildRule` を呼ぶ。成功したら、`Rules/<名前>.md` がすでにあれば、その内容を `Rules/_backup/<名前>.md` に書いて(あれば上書き)から `modify`、無ければ `create`。失敗は `Notice` に理由(`ClaudeError`/`BuildError` のメッセージ。キーは出さない)を出し、元のファイルは変えずに次のカードへ。最後に「作った N 枚 / 上書きした M 枚 / 失敗 K 枚」を `Notice` で出す。
- [ ] **Step 3: コマンド「Battle: build rules with AI」**: `localCards` の全カード名と、`Rules/<名前>.md` の読み込み → `cardStatus`(「Battle: rules coverage」と同じ作り方)から `toRows` を作り、`new BuildRulesModal(app, rows, (names) => void this.buildRulesFor(names)).open()`。キーが未設定なら、画面を開く前に `Notice` で案内する。
- [ ] **Step 4:** `npm test` と `npm run build` が通る。
- [ ] **Step 5(じゅま確認):** (a) キー未設定でコマンド → 設定を案内する通知。(b) キーを設定して実行 → 画面が開き、`Rules/` の無いカードにだけチェックが入っている。絞り込み・全部チェック・全部外す・「ルールが無いカードだけ」が動く。(c) 1〜2枚だけチェックして実行 → 選んだカードだけ `Rules/` ができる(API の料金がかかるので、まず1枚)。(d) すでにルールがあるカード(例: Negate)をチェックして実行 → `Rules/_backup/Negate.md` に元の内容が残り、`Rules/Negate.md` が書き換わる。(e) 実行後に「Battle: rules coverage」で状況が変わる。

---

## Self-Review

- **Spec coverage:** 4.10 の各項目 — キーチェーン保存=Task 5 / コマンドから頼む・チェックしたカードだけ・初期チェックはルールの無いカード・退避つきの上書き=Task 6, 7 / ノード一覧を指示文に・一覧外を使わせない・`## 未対応`=Task 1, 2, 4 / 検証を通ったものだけ保存・1回やり直し=Task 4 / `requestUrl`=Task 3 / モデルを設定で選ぶ=Task 5。ギャップなし。
- **Type consistency:** `Msg`・`Http`・`ClaudeError`・`buildPrompt`・`buildRule`・`BuildError`・`claudeKey` の名前と型は、定義した Task と使う Task で一致。
- **見送り(意図どおり)**: 返事のストリーミング、`fallbacks`(拒否時の別モデルへの切り替え)、コストの事前見積もり。拒否は `ClaudeError` として表に出す。
- **既知の限界:** 1回のやり直しで通らないカードは `Rules/` に作られない(理由が通知に出る)。再実行すると、AI が違う答えを出す可能性がある。
