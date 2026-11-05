import { getNode } from "../registry";
import { registerCards } from "./cards";
import { registerCombat } from "./combat";
import { registerContinuous } from "./continuous";
import { registerDeclarations } from "./declarations";
import { registerPermanents } from "./permanents";
import { registerTargets } from "./targets";

// 実装済みの基本ノード。カテゴリーごとのファイルに分かれている (nodes/*.ts)。共有の部品は shared.ts。ノードを足すときは、そのカテゴリーのファイルへ (どれにも当てはまらなければ、新しいカテゴリー)
export function registerBuiltinNodes(): void {
  if (getNode("target")) return;
  registerDeclarations();
  registerTargets();
  registerCards();
  registerPermanents();
  registerCombat();
  registerContinuous();
}
