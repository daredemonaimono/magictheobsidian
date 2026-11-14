import { CardData } from "./node/card";

// カードの枠の色 (組み込みの、CSS の簡易な枠: styles.css の .mtg-color-*)。
// 枠の差し替え (自分で置いた枠を読み込む) は、予定 (agent.md の「予定」)。いまは、組み込みの枠だけ。

// カードの色 (WUBRG の順)。マナ・コストの記号から (混成 {W/U} は両方、{2/W}・{W/P} は W)。トークンは、名前の「(1-1 R)」から
export function colorsOf(c: Pick<CardData, "mana" | "name" | "token">): string[] {
  const found = new Set<string>();
  if (c.token) for (const ch of /\((?:\d+-\d+ )?([WUBRGC]+)\)$/.exec(c.name)?.[1] ?? "") found.add(ch);
  for (const m of (c.mana ?? "").matchAll(/\{([^}]+)\}/g)) for (const ch of m[1]) if ("WUBRG".includes(ch)) found.add(ch);
  return [...found].filter((x) => "WUBRG".includes(x)).sort((a, b) => "WUBRG".indexOf(a) - "WUBRG".indexOf(b));
}

// 枠の種類のキー: 土地 L / 2 色以上 M (金) / 1 色 W U B R G / 無色のアーティファクト A / それ以外の無色 C
export type LayerKey = "W" | "U" | "B" | "R" | "G" | "M" | "C" | "A" | "L";
export function layerKeyFor(c: Pick<CardData, "mana" | "name" | "token" | "typeLine">): LayerKey {
  const colors = colorsOf(c);
  if (/\bLand\b/i.test(c.typeLine ?? "")) return "L";
  if (colors.length >= 2) return "M";
  if (colors.length === 1) return colors[0] as LayerKey;
  return /\bArtifact\b/i.test(c.typeLine ?? "") ? "A" : "C";
}

// 枠の特別な種類 (組み込みの CSS の枠): 伝説 (金の二重の縁・冠) / プレインズウォーカー (暗い金属の枠・忠誠度の印)
export function frameKinds(c: Pick<CardData, "typeLine" | "typeLineJa">): { legendary: boolean; planeswalker: boolean } {
  const t = `${c.typeLine ?? ""} ${c.typeLineJa ?? ""}`;
  return { legendary: /\bLegendary\b|伝説/.test(t), planeswalker: /\bPlaneswalker\b|プレインズウォーカー/.test(t) };
}

// 忠誠度能力のコスト (+2 / 0 / -5) を、印の文字と種類にする (マイナスは、U+2212 の「−」)
export function loyaltyBadge(loyalty: string): { text: string; kind: "plus" | "minus" | "zero" } {
  const n = Number(loyalty.replace(/[−–]/g, "-"));
  if (!Number.isFinite(n) || n === 0) return { text: Number.isFinite(n) ? "0" : loyalty, kind: "zero" };
  return n > 0 ? { text: `+${n}`, kind: "plus" } : { text: `−${Math.abs(n)}`, kind: "minus" };
}
