// デッキ画面の見出し (タイプ別の欄) の並び。デッキ画面とサイドバーの一覧で共通。

// Land を先に判定する (Artifact Land は土地として扱う)
const TYPE_CHECK = ["Land", "Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment"];

// 見出しの並び (全てのデッキ画面で共通)。縦に重なる見出しは同じ列。Commander は統率者構築のときだけ出る。
// Creature は指定が無かったので1列目の最後に、Battle / Other は余りとして3・4列目の最後に置いた
export const COLUMNS = [
  ["Commander", "Planeswalker", "Creature"],
  ["Sorcery", "Instant"],
  ["Artifact", "Enchantment", "Battle"],
  ["Land", "Other"],
  ["Token"], // Land の右
];

const ORDER = COLUMNS.flat();

export const isToken = (typeLine: string) => /^Token\b/.test(typeLine);

export const groupOf = (typeLine: string, commander = false): string =>
  commander ? "Commander" : isToken(typeLine) ? "Token" : TYPE_CHECK.find((t) => typeLine.includes(t)) ?? "Other";

// 見出しのアイコン (Obsidian 標準の lucide)。デッキ画面の見出しは、文字のかわりに、このアイコンと枚数を出す。名前は、カーソルを合わせたときに出る
export const GROUP_ICONS: Record<string, { icon: string; ja: string }> = {
  Commander: { icon: "crown", ja: "コマンダー" },
  Planeswalker: { icon: "star", ja: "プレインズウォーカー" },
  Creature: { icon: "swords", ja: "クリーチャー" },
  Sorcery: { icon: "flame", ja: "ソーサリー" },
  Instant: { icon: "zap", ja: "インスタント" },
  Artifact: { icon: "gem", ja: "アーティファクト" },
  Enchantment: { icon: "sparkles", ja: "エンチャント" },
  Battle: { icon: "shield", ja: "バトル" },
  Land: { icon: "mountain", ja: "土地" },
  Other: { icon: "layers", ja: "その他" },
  Token: { icon: "circle-dot", ja: "トークン" },
};

// 見出しの並び順での位置 (左の列の上から)
export const groupRank = (group: string) => ORDER.indexOf(group);
