# agent.md — Magic the Obsidian の、作業の決まり

このファイルは、チャットが切り替わっても、このプラグインでの決まりが抜けないための記録。作業を始める前に読む。

> **更新の決まり**: ルールや設計が変わったら、そのつど、このファイルを添削して、最新に保つ。古い記述を残さない。

## 1. これは何か

Obsidian を Magic: The Gathering 専用のソフトにするプラグイン。カード(Scryfall)、デッキ、コレクション、価格、デッキ構築画面に加えて、**対戦の核**(カードの能力をノードで組み、エンジンで動かす)を作っている。作者は「じゅま」(以下、ユーザー)。BRAT で配布する(GitHub: `daredemonaimono/magictheobsidian`)。

## 2. 今の状態

- デッキ・コレクション・価格・カード一覧は完成していて、README に使い方がある。
- **対戦機能は「核」まで**。対戦の画面・Bot・戦闘・ライフ/勝敗は、まだ無い。0.40.0 までの古い実装は捨てて作り直した(旧実装は git タグ `archive/battle-rules-0.40.0`。参照は `git show archive/battle-rules-0.40.0:src/<ファイル>`)。
- 設計は `docs/superpowers/specs/2026-11-04-battle-core-design.md`。ノードを足す順番は `docs/superpowers/plans/2026-11-05-deck-node-roadmap.md`(デッキ「Gentry Mono U」のカードを組めるかで決める。第1〜11弾まで実装済み。これからの順番はロードマップの末尾 (対戦の画面。エンジンは `startGame` で始め、`declareAttackers` などの入口を呼ぶ。`Game.strictTurns` と `payManaCosts` は、画面の側で真にする))。小さな手順の計画は `docs/superpowers/plans/` の各ファイル。ROADMAP.md は、デッキ側の予定。
- 雑魚 CPU (段階5): `src/battle/cpu.ts` (`cpuMulligan`/`cpuAct`)。`BattleController.next` が、CPU の優先権のときに `cpuAct` を呼ぶ (土地・呪文。同じ局面なら同じ動き)。設定 `battleOpponent` (cpu / passive)。攻撃とブロックは `cpuAttack`/`cpuBlock` (段階6a)。人の攻撃・ブロックの選択は `BattleController.declareAttackers/declareBlockers` と `BoardModel.choice`。ダメージの割り振りは `assignDamage` (engine) / `BattleController.assign` / `CombatChoice.kind="assign"` (段階6b 前半)。ダメージ数の拡大の演出・相手の手札の演出は未対応 (段階6b 後半)。
- 対戦の画面は段階4cまで (マリガン: `src/battle/mulligan.ts` と `Game.mulligan`、`BattleController.mulligan/keep/bottom`。「次へ」は次のステップまで (`BattleController.next`)。設定 `battleStops` (smart / always) は、時間ゲージで自動で進めるかだけを決める (`BoardModel.idle` = `canRespond` が偽。`canRespond` は、マナだけの起動型能力を全部使ったと仮定する)。自分の攻撃・ブロックの指定の段階は、`idle` が偽で、ゲージで自動で進まない。入力待ち: `src/battle/input.ts` の `makeDecider`/`NeedInput` と `BattleController.pending/answer/cancel`。操作はコピーした局面で実行し、質問が出たら止まり、答えを足して最初からやり直す): 自分のターンの操作 (`src/battle/actions.ts` = いまできる行動の判定、`src/battle/play.ts` の `BattleController` = 使う・起動する・次へ)。対象を取るカードは、対象を選んで使える (段階4a。`engine.ts` の `targetSlots`)。攻撃とブロックの選択 (段階6)・優先権の設定 (段階4c) は未対応。相手は何もしない。
- 第11弾までの未対応: 先手後手の決め方、追加ターン、対戦の画面、多人数戦(「各対戦相手」は1対1の `max=1` で近似)、紋章の常在型能力。

## 3. 対戦の核の仕組み (`src/battle/`)

- **ノード** (`node.ts` `registry.ts` `nodes.ts`): カード専用の関数は作らない。汎用のノードを組み合わせる。`NodeDef`(id・params・outputs・`only` で書ける能力の種類・`run`)を `registry` に登録する。呼び出しは `NodeCall {node, as?, if?, args}`。参照は `$名前` で、前のノードの `as` を指す。数の引数だけ参照を書ける(`$X` は −X の忠誠度能力の中だけ)。対象を選ぶノードと宣言のノードには参照を書けない。
- **能力の種類**: spell / activated / triggered / static。タイミングは、カードタイプに従うので、ノードにしない。誘発型は最初が `when`(紋章は `emblem` のあとに `when`)、継続効果の常在型は最初が `affect`。
- **条件** (`if=`): kicked / teamwork / mode1..5 / `<場所>:<型>:<数>[+|-]` など。`!` で否定。
- **md の形式** (`ruleMd.ts`): `Rules/<カード名>.md`。`## 呪文能力` `## 起動型能力` `## 誘発型能力` `## 常在型能力` の見出しの下に `- node as=x key=value` の箇条書き。ノードで表せない部分は `## 未対応`。未対応の見出し(ノードが空)は「未設定」扱い。
- **検証**: `checkCall`(引数)、`placementProblem`(置いてよい能力か)、`structureProblem`(能力の構造)、`refProblems`(参照・`as` の重複)。ノード設定画面 (`editor.ts`)・AI の返事の検証 (`build.ts`)・状況レポート (`coverage.ts`) が、同じ検査を使う。**検査を足すときは `registry.ts` に1か所だけ足し、3か所とも通ることを確かめる**。
- **エンジン** (`engine.ts` `state.ts` `continuous.ts`): 呪文を唱える・起動する・土地を出す・解決・誘発・状況起因処理・優先権とステップ。継続効果(レイヤー)は `continuous.ts` の `characteristics` で導く。紋章は継続効果の影響を受けない。
- **AI** (`prompt.ts` `glossary.ts` `build.ts` `claude.ts` `select.ts`): Claude API でカード → md を作る。API キーは Obsidian の SecretStorage(設定で選ぶ)。システムプロンプトは、レジストリのノード一覧と用語集から作る。用語集は英語(`glossary.ts` が既定、ユーザーが `Rules/_glossary.md` で足せる)。検証に通らなければ、問題を渡して1回だけやり直させる。**ノードを足したら、プロンプトに載るか(`only`・summary・params の説明)を確かめる**。
- **履歴** (`history.ts`): ルールが書き換わる前の内容を `Rules/_backup/<カード名>/<日時>-<種類>.md` に残す。AI が書き直したとき(ユーザーが裁定後のテキストを渡す)と、ノード設定画面で「保存」したときに、システムが保存する。ユーザーに md を手で直させない(保存のタイミングが分からなくなるため)。
- **画面とコマンド**: ノード設定画面 (`RuleEditorView.ts`)、AI 構築 (`BuildRulesModal.ts`)、復元 (`RestoreRuleModal.ts`)。コマンドは `Battle: create sample rules` / `build rules with AI` / `rules coverage`(`Rules/_coverage.md` を書く)。

## 4. 作業の決まり

- **確認はユーザーがする**。自分は、ビルドとテスト(`npm test`)まで。Obsidian の画面と実際の API 呼び出しは動かしていないので、「動かしていない」と、はっきり言う。
- **進め方**: ロードマップの順に、1弾ずつ。テストを先に書いて失敗を確かめ(RED)→ 実装 → `npm test` と `npm run build` → レビューを別のエージェントに頼む → 重要な指摘は直し、軽微なものは持ち越して報告する。
- **リリースは、ユーザーが「リリースする」「リリースして」と言ったときだけ。コミット・push も同じ**。手順: `manifest.json` / `package.json` / `versions.json` の版を上げる → `npm run build` → `npm test` → コミット(`git -c user.name=daredemonai -c user.email=daredemonai@gmail.com`、末尾に Co-Authored-By) → `git push` → `gh release create <版> main.js manifest.json styles.css`。README も、同じ版で更新する。コミットとプッシュは別の手順に分ける。
- **画面クラス(`*View.ts`)のメンバー名**: Obsidian 本体の `open` `close` `load` などと重ねない(画面が空白になる。`test/viewnames.test.ts` が確かめる)。
- **ファイルを書くときの注意**: シェルの heredoc で TypeScript を書くと、バックスラッシュが二重になりやすい。長いコードは、Write / Edit ツールか python で書く。テンプレートリテラル(`prompt.ts`)の中のバッククォートは `\`` と書く。macOS の `sed -i` には `''` が要る。
- **`src/wiki.ts`** は、カードのページを開くだけの機能。慎重に扱う。
- ファイルは Read ツールで読む(`cat` などで読まない)。
- 日本語で、簡潔に答える。ユーザーは、細かい仕様を自分で決めたい人。決める点は、推奨つきで聞く。
- ユーザーの Westeros の決まり(`../../CLAUDE.md`)も守る。`citadel/` は読むだけ。公開(push・リリース)は、ユーザーの依頼があったときだけ。
- vault 側のデータ(`Rules/` `Cards/` `Decks/`、`.obsidian/plugins/magictheobsidian/` の古い `rulebook/` や `Bot/`)は、アプリを通さずに書き換えない。消すのはユーザー。

## 5. 残っているもの(デッキ側)

カードの取得 (`scryfall.ts` `cards.ts`)、デッキ (`deck.ts` `DeckView.ts` `DeckListView.ts` `import.ts`)、フォーマットのルール(デッキ構築用。`rules.ts`)、コレクション (`collection.ts` `CollectionView.ts`)、価格 (`prices.ts`)、サイドバーの一覧 (`CardListView.ts`)、カード一覧 (`CardsView.ts` `wiki.ts`)、ダッシュボード、設定。

---
**もう一度: ルールや設計が変わったら、このファイルを添削して、最新に保つ。**
