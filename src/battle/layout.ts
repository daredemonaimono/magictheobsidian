// 対戦の画面の、列の重なりの計算 (DOM を持たない。テストで確かめる)。列の幅に収まるように、カードを重ねる量を決める

// カードの大きさ (px)。盤面のカードと、手前の手札。CSS の変数 (--cw / --ch) は、画面を作るときに、これらから入れる
export const CARD_W = 76;
export const CARD_H = 106;
export const HAND_W = 120;
export const HAND_H = 168;
export const GAP = 10; // カードどうしの間
export const TAP_EXTRA = CARD_H - CARD_W; // タップして横向きになったカードが、列の中で余分に取る幅 (左右に半分ずつ)

// 列に必要な幅。cardW = カード1枚の幅、n = 枚数、tapped = そのうちタップしている枚数
export const rowNeed = (cardW: number, n: number, tapped: number): number => n * cardW + Math.max(0, n - 1) * GAP + tapped * TAP_EXTRA;

// 重ねる量 (px。隣との間の、負の余白)。need が avail に収まるなら 0。枚数が 1 以下・幅が測れない (0) ときも 0
export const overlapFor = (need: number, n: number, avail: number): number => (n > 1 && avail > 0 ? Math.max(0, Math.ceil((need - avail) / (n - 1))) : 0);

// 山札・墓地の厚み (重ねる層の数)。10 枚ごとに 1 層 (1〜10 枚 = 1 層、11〜20 枚 = 2 層 …)、上限 12。0 枚なら 0 (空の枠だけ)。枚数を、見た目でも確かめられるように (ドレッジなど)
export const MAX_LAYERS = 12;
export const LAYER_PX = 2; // 1 層の厚み (px)
export const pileLayers = (count: number): number => (count > 0 ? Math.min(MAX_LAYERS, Math.ceil(count / 10)) : 0);

// カードの裏面の絵。Scryfall の card_back_id (公式のカードの裏) は、普通のカードすべてで同じ。画像は backs.scryfall.io から読む (ブラウザが覚える。読めなければ、CSS の代わりの絵)
export const CARD_BACK_ID = "0aeebaf5-8c7d-4636-9e82-8c27447861f7";
export const cardBackUrl = (size: "small" | "normal" | "large" = "small"): string => `https://backs.scryfall.io/${size}/${CARD_BACK_ID[0]}/${CARD_BACK_ID[1]}/${CARD_BACK_ID}.jpg`;

// 優先権の時間ゲージ (真ん中の帯の底)。何もできないとき、この秒数で、左から右へ進んで、自動で次へ進む (設定が「使えるものがあるときだけ止まる」のとき)。「毎回止まる」は、動かない
export const GAUGE_SEC = 3;
