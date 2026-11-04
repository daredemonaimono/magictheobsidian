# ノードの追加(引く・捨てる / 手札に戻す / 支払わないかぎり打ち消す) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** 設計書 5 節の「未実装のノードを順に実装する」の第1弾。`draw` / `discard` / `bounce` と、`counter` の `unlessPay` 引数を足し、AI が組めるカードを増やす。

**Architecture:** ゲーム状態に最小限の領域を足す(ライブラリー・戦場・マナ)。ノードは汎用のまま(カード専用なし)。`counter` は新しいノードを作らず、引数 `unlessPay` を足す。指示文はレジストリから作られるので、AI は新しいノードを自動で知る。

**Spec:** `docs/superpowers/specs/2026-11-04-battle-core-design.md`(4.2 ノードの粒度、5 進め方)

## Global Constraints

- 1/2・2/2 の制約を引き継ぐ(カード専用ノード禁止、`npm test` と `npm run build` が通る、日本語のコメント、コミット・push・リリースはじゅまの依頼があったときだけ)。
- プレイヤーはリスト+`opponentsOf`。`player` 引数は `"you"`(呪文のコントローラー)か `"opponents"`(全相手)。
- 選択と支払いの「人の判断」は、まだ入力の仕組みが無い。`Game.decide` が差し替え口で、既定は決まった動き(捨てる=手札の後ろから、支払う=払えるなら払う)。これは仕様の簡略化で、コードに `shortcut:` コメントを残す。

## Review Focus

1. ライブラリーが足りないとき: 引ける分だけ引き、例外は出さず、記録を残す。
2. 手札が足りないとき: 捨てられる分だけ捨てる。
3. 戦場から消えた対象を `bounce` が指す: 何もしない(例外なし)。
4. `unlessPay` で払えないとき: 打ち消される。払えるとき: マナが減り、打ち消されない。

---

### Task 1: ゲーム状態の領域

**Files:** Modify `src/battle/state.ts`、Test `test/battle-game.test.ts`(追記)

**Interfaces:**
```ts
export interface Perm { id: string; card: GameCard; controller: PlayerId; tapped?: boolean; attacking?: boolean }
export interface Decider { discard?(g: Game, p: PlayerId, n: number): GameCard[]; pay?(g: Game, p: PlayerId, n: number): boolean }
// Game に追加: libraries (先頭が一番上) / battlefield: Perm[] / mana: Record<PlayerId, number> / decide?: Decider
```
- [ ] テスト: `createGame(["A","B"])` が `libraries` / `mana`(各 0)を持ち、`battlefield` が空。
- [ ] 実装 → `npm test` と `npm run build`。

### Task 2: `draw` と `discard`

**Files:** Modify `src/battle/nodes.ts`、`src/battle/engine.ts`(`playersOf`)、Test `test/battle-nodes.test.ts`

**Interfaces:** `draw` / `discard`: 引数 `player`(`"you"|"opponents"`・必須)、`count`(number・必須)。`export function playersOf(g: Game, item: StackItem, who: string): PlayerId[]`。

- [ ] テスト: ライブラリーに3枚ある A が `draw you 2` → 手札2枚・ライブラリー1枚。足りないとき(1枚で `count=2`)は1枚だけ引いてログ。`opponents` は相手に効く。`discard you 1` は手札の後ろ1枚が墓地へ。手札が足りなければ、ある分だけ。`decide.discard` の差し替えが効く。
- [ ] 実装 → `npm test` と `npm run build`。

### Task 3: `target` の拡張と `bounce`

**Files:** Modify `src/battle/nodes.ts`、Test `test/battle-nodes.test.ts`(追記)

**Interfaces:** `target` の `zone` に `"battlefield"`、`kind` に `"permanent"` を足す(`stack`+`spell`、`battlefield`+`permanent` の組だけ有効。それ以外は対象無し)。`bounce`: 引数 `target`(ref・必須)。戦場の `Perm` を持ち主の手札へ。

- [ ] テスト: 戦場の非土地パーマネントを `bounce` → 持ち主の手札へ。`notType=land` で土地は対象にならない(`castSpell` が `RuleError`)。解決前に対象が戦場から消えたら何もしない(例外なし)。
- [ ] 実装 → `npm test` と `npm run build`。

### Task 4: `counter` の `unlessPay`

**Files:** Modify `src/battle/nodes.ts`、Test `test/battle-nodes.test.ts`(追記)

**Interfaces:** `counter` に任意の引数 `unlessPay`(number)。

- [ ] テスト: 相手が `mana=4` で `unlessPay=4` → 払って打ち消されない(マナ 0、対象はスタックに残る)。`mana=3` → 打ち消される。`unlessPay` 無しは従来どおり。`decide.pay` が `false` を返すと、払えても打ち消される。
- [ ] 実装 → `npm test` と `npm run build`。

### Task 5: 仕上げ

- [ ] README に、増えたノードを1行で追記する。`npm test` と `npm run build` を通し、最終レビュー(独立したレビュアー)を受ける。
