// キーワード能力の表示名。対戦エンジンは英語のキーワード (Scryfall の keywords / 英語のオラクルテキスト) で動くので、
// 各国語のカードでも判定は変わらない。この表は、画面に出す名前だけ。足りない言語・キーワードは英語のまま出る
export const KEYWORD_NAMES: Record<string, Record<string, string>> = {
  ja: {
    flying: "飛行", reach: "到達", haste: "速攻", vigilance: "警戒", flash: "瞬速", trample: "トランプル",
    "first strike": "先制攻撃", "double strike": "二段攻撃", deathtouch: "接死", lifelink: "絆魂", menace: "威迫",
    defender: "防衛", indestructible: "破壊不能", hexproof: "呪禁", shroud: "被覆", intimidate: "威嚇", fear: "畏怖",
    skulk: "忍び足", shadow: "影", islandwalk: "島渡り", swampwalk: "沼渡り", mountainwalk: "山渡り", forestwalk: "森渡り", plainswalk: "平地渡り",
  },
};

const title = (k: string) => k.replace(/\b\w/g, (c) => c.toUpperCase());

export function keywordLabel(keyword: string, lang: string): string {
  return KEYWORD_NAMES[lang]?.[keyword] ?? title(keyword);
}
