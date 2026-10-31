# Magic the Obsidian

Obsidian を Magic: The Gathering のデッキ構築ツールにするプラグインです。カードは Scryfall から取得してノート(md)になります。

## できること

- コマンド「Fetch card from Scryfall」でカードを取得し、`Cards/` にノートを作る(カード名、マナコスト、タイプ、効果テキスト、画像、収録セットの一覧)。
- コマンド「Create deck」でデッキを作り、`Decks/` にノートを作る。専用のデッキ画面が開く。
  - 名前・効果テキスト・タイプ・色で絞り込み検索。`Cards/` に無ければ自動で Scryfall を検索し、追加したカードはノート化される。
  - メイン/サイドの枚数設定。タイプ別に重ねて表示。カードにホバーすると拡大画像と効果テキストが左に出る。
  - 🖼ボタンでイラスト(収録セット)を選べる。選んだ版は `4 [[Lightning Bolt]] (m11 149)` のようにデッキのノートに保存される。
- デッキのノートはカードへのリンクになるので、グラフビューでカードの採用率が見える。
- コマンド「Open collection」で所持カードを登録する画面が開く。デッキ画面と同じ操作で検索・追加でき、`Collection/<セット>.md`(セットごとのノート)に保存される。
- 既存のデッキのノートを画面で開くには、コマンド「Open current deck in deck view」。
- 設定で、効果テキストの言語とカード(画像)の言語を選べる。設定は新しく取得するカードから反映される。

## BRAT でのインストール

1. Obsidian に BRAT プラグインを入れる。
2. BRAT の「Add Beta plugin」に `daredemonaimono/magictheobsidian` を入力する。
3. 設定の Community plugins で「Magic the Obsidian」を有効にする。

## ビルド

```bash
npm install
npm run build   # main.js が生成される
```

## リリース

`manifest.json` の version と同じタグでリリースを作り、`main.js`・`manifest.json`・`styles.css` を添付します。

## クレジット

カードデータと画像は [Scryfall](https://scryfall.com/) の API を使っています。Magic: The Gathering は Wizards of the Coast の商標です。このプラグインは非公式です。
