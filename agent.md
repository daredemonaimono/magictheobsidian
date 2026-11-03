# agent.md — Magic the Obsidian の、作業の決まり

このファイルは、チャットが切り替わっても、このプラグインでの決まりが抜けないための記録。作業を始める前に読む。

> **更新の決まり**: ルールや設計が変わったら、そのつど、このファイルを添削して、最新に保つ。古い記述を残さない。

## 1. これは何か

Obsidian を Magic: The Gathering 専用のソフトにするプラグイン。カード(Scryfall)、デッキ、コレクション、価格、デッキ構築画面を、1つのプラグインで行う。作者は「じゅま」(以下、ユーザー)。BRAT で配布する。

## 2. 今の状態

**対戦・Bot・ルールブック・カード処理の記録は、すべて白紙に戻した(0.41.0)。** 0.40.0 までの実装 (対戦エンジン、AI が書く記録、関数と名詞、ルールブック画面) は、git タグ `archive/battle-rules-0.40.0` に残してある。参照するときは `git show archive/battle-rules-0.40.0:src/<ファイル>`。

- 理由: ルールを見直したところ、その仕様のままでは、あとで整合性が取れなくなると分かったため。
- **ユーザーが「ルールを読み直して、崩れない仕様を決めた」と言うまで、対戦・ルールの実装は始めない。** 仕様を決める相談は、歓迎。
- ユーザーの vault に、古い実装が作ったデータが残っている (`.obsidian/plugins/magictheobsidian/rulebook/`、`Bot/` のノート)。プラグインはもう読まない。**消すのはユーザー** (アプリを通さずに書き換えない)。

## 3. 作業の決まり

- **確認はユーザーがする**。自分は、ビルドとテスト(`npm test`)まで。画面を動かしていなければ、「動かしていない」と、はっきり言う。
- **リリースは、ユーザーが「リリースして」と言ったときだけ**。手順: `manifest.json` / `package.json` / `versions.json` の版を上げる → `npm run build` → `npm test` → コミット(`git -c user.name=daredemonai -c user.email=daredemonai@gmail.com`、末尾に Co-Authored-By) → `git push` → `gh release create <版> main.js manifest.json styles.css`。README も、同じ版で更新する。
- **画面クラス(`*View.ts`)のメンバー名**: Obsidian 本体の `open` `close` `load` などと重ねない(画面が空白になる。`test/viewnames.test.ts` が確かめる)。
- **ファイルを書くときの注意**: シェルの heredoc で TypeScript を書くと、バックスラッシュ(正規表現の `\{` や `\n`)が二重になりやすい。長いコードは、Write ツールか python で書き、`\\` を grep して確かめる。
- 日本語で、簡潔に答える。ユーザーは、細かい仕様を自分で決めたい人。決める点は、推奨つきで聞く。
- ユーザーの Westeros の決まり(`../../CLAUDE.md`)も守る。`citadel/` は読むだけ。

## 4. 残っているもの

カードの取得 (`scryfall.ts` `cards.ts`)、デッキ (`deck.ts` `DeckView.ts` `DeckListView.ts` `import.ts`)、フォーマットのルール(デッキ構築用。`rules.ts`)、コレクション (`collection.ts` `CollectionView.ts`)、価格 (`prices.ts`)、サイドバーの一覧 (`CardListView.ts`)、カード一覧 (`CardsView.ts` `wiki.ts`)、ダッシュボード、設定。手順の全体像は `ROADMAP.md`。

---
**もう一度: ルールや設計が変わったら、このファイルを添削して、最新に保つ。**
