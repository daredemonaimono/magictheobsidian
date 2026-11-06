import { allNodes } from "../registry";

// ノードの「言い方」(キー)。ノードごとに、同じ意味の言い方を、ひとまとめにして持たせる (「ごめんね」「すまん」「悪かった」→ 謝罪、のように)。
// ルールを書かせる AI へのノード一覧 (言い方: …) と、ノードの一覧 (docs/nodes.md) に出る。言い方が増えるほど、AI が、ノードを取り違えにくい。
// ノードを足すときは、ここに、そのノードの言い方を足す (または、ノードの定義に、keys を直接書いてもよい)。

export const NODE_KEYS: Record<string, { keys: string[] }> = {
  draw: { keys: ["引く", "ドロー", "カードを引く", "手札に加える (ライブラリーから)"] },
  discard: { keys: ["捨てる", "ディスカード", "手札を捨てる"] },
  gainLife: { keys: ["ライフを得る", "回復", "ライフを回復"] },
  loseLife: { keys: ["ライフを失う", "ライフを払う", "ライフ損失"] },
  damage: { keys: ["ダメージを与える", "ダメージ", "焼く"] },
  counter: { keys: ["打ち消す", "カウンター (呪文を打ち消す)"] },
  destroy: { keys: ["破壊する", "壊す"] },
  exile: { keys: ["追放する", "追放"] },
  bounce: { keys: ["手札に戻す", "バウンス", "持ち主の手札に戻す"] },
  move: { keys: ["動かす", "墓地に置く", "ライブラリーの上・下に置く", "墓地から戻す"] },
  createToken: { keys: ["トークンを作る", "トークンを生成"] },
  addCounter: { keys: ["カウンターを置く", "+1/+1 カウンター"] },
  look: { keys: ["見る", "占術", "諜報", "ライブラリーの上を見る"] },
  search: { keys: ["探す", "サーチ", "ライブラリーから探す"] },
  shuffle: { keys: ["切る", "シャッフル"] },
  addMana: { keys: ["マナを加える", "マナ"] },
  modify: { keys: ["修整を受ける", "+X/+X", "パワー・タフネスの修整"] },
  sacrifice: { keys: ["生け贄に捧げる", "生け贄"] },
  untap: { keys: ["アンタップする"] },
  tap: { keys: ["タップする"] },
  attach: { keys: ["付ける", "装備する", "オーラ"] },
  copySpell: { keys: ["呪文をコピーする", "コピー"] },
  extraTurn: { keys: ["追加のターン"] },
  exchangeControl: { keys: ["コントロールを交換する"] },
  lookHand: { keys: ["手札を見る", "手札を公開させる"] },
  payOrMove: { keys: ["ライフを払うか、戻す"] },
  becomes: { keys: ["〜になる", "変身させる"] },
  grant: { keys: ["能力を得る", "飛行を得る"] },
  choose: { keys: ["選ぶ", "その中から選ぶ"] },
};

// 組み込みのノードに、キーと言い回しを、取り付ける (ノードの定義に、直接書いてあるものは、そちらを優先)。表にあるのに、ノードが無い id は、書き間違い: 例外
export function applyNodeKeys(): void {
  const byId = new Map(allNodes().map((n) => [n.id, n]));
  for (const [id, k] of Object.entries(NODE_KEYS)) {
    const def = byId.get(id);
    if (!def) throw new Error(`nodes/keys.ts: ノード ${id} が無い (id の書き間違い)`);
    def.keys ??= k.keys;
  }
}
