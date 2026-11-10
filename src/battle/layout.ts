// 対戦の画面の、列の重なりの計算 (DOM を持たない。テストで確かめる)。列の幅に収まるように、カードを重ねる量を決める

// カードの大きさ (px)。盤面のカードと、手前の手札。CSS の変数 (--cw / --ch) は、画面を作るときに、これらから入れる
export const CARD_W = 76; // 盤面のカード (設定「カード全体」): 縦長
export const CARD_H = 106;
export const CARD_ASPECT = 680 / 488; // カード画像の、縦 / 横
export const FRAME_W = 88; // 盤面のカード (設定「オリジナルフレーム」): 枠・名前の帯は CSS で描き、絵は、カード画像の絵の部分だけを切り出す
export const FRAME_H = 74; // 横長 (Arena の見本は、およそ 1.2 : 1)
export const FRAME_T = 5; // 枠の太さ
export const FRAME_NAME_H = 12; // 名前の帯の高さ
// カード画像の中の、絵の枠の位置 (割合。標準のカードの枠。見ながら調整)
// 枠の線 (角の小さい長方形)。座標は、カード (88 x 74) の中。FRAME_W / FRAME_H を変えたら、ここも直す
export const FRAME_OUTLINE = "M4 .7H84A3.3 3.3 0 0 1 87.3 4V70A3.3 3.3 0 0 1 84 73.3H4A3.3 3.3 0 0 1 .7 70V4A3.3 3.3 0 0 1 4 .7Z";
// カード画像の URL から、絵の部分だけの画像 (Scryfall の art_crop) の URL を作る。作れないとき (別のサイトの画像など) は undefined
// 赤い立体筋の線 (座標は 88 x 74): 絵の窓のふちと、名前の帯のふちを、一本でつなぐ。帯 (左右 4・上 4.5・下 12) と、絵の窓 (左右 6.4・上 13・下 64.2) の、外側のふちに沿う。FRAME_W / FRAME_H や、CSS の位置を変えたら、ここも直す
export const FRAME_LINE = "M6.4 64.2V12.5H5.3V12A1.3 3.75 0 0 1 5.3 4.5H82.7A1.3 3.75 0 0 1 82.7 12V12.5H81.6V64.2ZM6.4 12.5H81.6";
export const cropUrl = (url: string | undefined): string | undefined => (url && /^https:\/\/cards\.scryfall\.io\/(normal|large|small)\//.test(url) ? url.replace(/\/(normal|large|small)\//, "/art_crop/").replace(/\.png(\?|$)/, ".jpg$1") : undefined);
export const FRAME_ART_INSET = 6.75; // 絵の窓の左右の余白 (px)。名前の帯の両端の丸みに、絵が届かないように
export const FRAME_ART = { x: 0.07, w: 0.858, y: 0.113 };
// 絵の窓 (枠の内側・名前の帯の下) に、カード画像の絵の部分が合うように、画像の大きさと位置 (px) を決める
export const frameImage = (): { width: number; left: number; top: number } => {
  const width = (FRAME_W - 2 * FRAME_ART_INSET) / FRAME_ART.w;
  return { width, left: -width * FRAME_ART.x, top: -width * CARD_ASPECT * FRAME_ART.y };
};
// 盤の大きさに合わせた、カードの倍率 (オリジナルフレームのとき)。基準は、幅 900px・高さ 560px で 1 倍。画面が広いほど大きく (幅と高さの、小さいほうに合わせる)。0.8〜2.4 倍
export const REF_W = 900;
export const REF_H = 560;
export const boardScale = (w: number, h: number): number => (w > 0 && h > 0 ? Math.round(Math.min(2.4, Math.max(0.8, Math.min(w / REF_W, h / REF_H))) * 20) / 20 : 1);
// 土地の大きさの倍率 (クリーチャーに対して。いつも小さめ)。土地の枚数が増えるほど小さく: 3 枚まで 0.85 倍 → 15 枚以上 0.55 倍 (その間は、直線で)
export const landFactor = (n: number): number => Math.round(Math.min(0.85, Math.max(0.55, 0.85 - (Math.max(3, n) - 3) * 0.025)) * 100) / 100;
export const HAND_W = 120;
export const HAND_H = 168;
export const GAP = 10; // カードどうしの間
export const TAP_EXTRA = CARD_H - CARD_W; // タップして横向きになったカードが、列の中で余分に取る幅 (横長なので、負の値 = 倒すと、幅は狭くなる) (左右に半分ずつ)

// 列に必要な幅。cardW = カード1枚の幅、n = 枚数、tapped = そのうちタップしている枚数
export const rowNeed = (cardW: number, n: number, tapped: number, extra = TAP_EXTRA): number => n * cardW + Math.max(0, n - 1) * GAP + tapped * extra;

// 重ねる量 (px。隣との間の、負の余白)。need が avail に収まるなら 0。枚数が 1 以下・幅が測れない (0) ときも 0
export const overlapFor = (need: number, n: number, avail: number): number => (n > 1 && avail > 0 ? Math.max(0, Math.ceil((need - avail) / (n - 1))) : 0);

// 山札・墓地の厚み (重ねる層の数)。10 枚ごとに 1 層 (1〜10 枚 = 1 層、11〜20 枚 = 2 層 …)、上限 12。0 枚なら 0 (空の枠だけ)。枚数を、見た目でも確かめられるように (ドレッジなど)
export const MAX_LAYERS = 12;
export const LAYER_PX = 2; // 1 層の厚み (px)
// 山札・墓地の束を、きれいに揃えず、少しばらつかせる (層ごとの、ずれ dx・dy (px、盤の倍率前) と、傾き r (度))。同じ種と層なら、いつも同じ (描き直しても、ちらつかない)
export const pileScatter = (seed: number, i: number): { dx: number; dy: number; r: number } => {
  const h = (k: number) => {
    const x = Math.sin((i + 1) * 127.1 + seed * 311.7 + k * 74.7) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1; // -1 〜 1
  };
  return { dx: h(1) * 2.4, dy: h(2) * 1.8, r: h(3) * 3 };
};
// 使い込んだ見た目にするフォーマット (Vintage / Legacy)
export const isWornFormat = (format: string | undefined): boolean => /^(vintage|legacy)$/i.test(format ?? "");
export const pileLayers = (count: number): number => (count > 0 ? Math.min(MAX_LAYERS, Math.ceil(count / 10)) : 0);


// 優先権の時間ゲージ (真ん中の帯の底)。何もできないとき、この秒数で、左から右へ進んで、自動で次へ進む (設定が「使えるものがあるときだけ止まる」のとき)。「毎回止まる」は、動かない
export const GAUGE_SEC = 3;
