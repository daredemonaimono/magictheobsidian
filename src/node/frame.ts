import { CardData } from "./card";

// カードの枠の時代 (プレビューのフォントを、時代に合わせる)。取り込んだ絵の版 (card.scryfall = 主な版) の発売日で決める。
//   old    = 旧枠 (〜2003-07-27。アルファ版〜第 7 版)
//   eighth = 8 版枠 (2003-07-28 〜 2014-07-17。第 8 版〜基本セット 2014)
//   modern = 現行・新枠 (2014-07-18〜。基本セット 2015〜)。版が分からないときも、これ
export type FrameEra = "old" | "eighth" | "modern";
export const EIGHTH_EDITION = "2003-07-28"; // 第 8 版の発売日
export const MAGIC_2015 = "2014-07-18"; // 基本セット 2015 の発売日

export const eraOf = (released: string | undefined): FrameEra => (!released ? "modern" : released < EIGHTH_EDITION ? "old" : released < MAGIC_2015 ? "eighth" : "modern");

export function frameEra(c: Pick<CardData, "scryfall" | "prints">): FrameEra {
  return eraOf(c.prints?.find((p) => p.id === c.scryfall)?.released);
}
