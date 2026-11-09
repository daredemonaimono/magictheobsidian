// 盤面のカードのフレーム (アリーナ風)。カードの色・タイプから、CSS のクラスを決める (画像素材は使わず、フレームは CSS で描く)
export interface FrameInput {
  colors?: string[]; // 色 (W U B R G)。無ければ、マナコストの色から
  manaCost?: string;
  typeLine: string;
}

const ORDER = ["W", "U", "B", "R", "G"];
const BASIC: Record<string, string> = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };

const colorsOf = (c: FrameInput): string[] => {
  const raw = c.colors ?? [...(c.manaCost ?? "").matchAll(/[WUBRG]/g)].map((m) => m[0]);
  return ORDER.filter((x) => raw.includes(x));
};

// 戻り値のクラス: 土地 = "f-land" (+ 基本土地タイプが 1 種類なら "f-W" など)。色ありは、1 色 "f-R"・多色 "f-M"。色なしは、アーティファクト "f-art"・それ以外 "f-C"
export function frameClass(c: FrameInput): string {
  if (/\bLand\b|土地/.test(c.typeLine)) {
    const lands = ORDER.filter((x) => Object.entries(BASIC).some(([name, col]) => col === x && c.typeLine.includes(name)));
    return lands.length === 1 ? `f-land f-${lands[0]}` : lands.length > 1 ? "f-land f-M" : "f-land";
  }
  const cs = colorsOf(c);
  if (cs.length === 1) return `f-${cs[0]}`;
  if (cs.length > 1) return "f-M";
  return /\bArtifact\b|アーティファクト/.test(c.typeLine) ? "f-art" : "f-C";
}
