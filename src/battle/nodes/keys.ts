import { allNodes } from "../registry";

// ノードの「言い方」(キー)。ノードごとに、同じ意味の言い方を、ひとまとめにして持たせる (「ごめんね」「すまん」「悪かった」→ 謝罪、のように)。
//   keys     = 日本語の言い方 (概念のキー)。Jev・AI への質問と、ノードの一覧 (docs/nodes.md) に出る
//   patterns = 英語の効果テキストの言い回し (正規表現。小文字にした節に当てる)。効果テキストを節に切る段 (splitText) が、ここから、ノードの候補を出す
// ノードを足すときは、ここに、そのノードの言い方を足す (または、ノードの定義に、keys / patterns を直接書いてもよい)。足さなければ、そのノードは、切る段に拾われない。
// 数を表す語 (a / one / two … / X / 数字) は、NUM
const NUM = "(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\\d+)";

export const NODE_KEYS: Record<string, { keys: string[]; patterns: string[] }> = {
  draw: { keys: ["引く", "ドロー", "カードを引く", "手札に加える (ライブラリーから)"], patterns: [`\\bdraws? ${NUM} (?:additional |more |extra )?cards?\\b|\\bdraws? (?:that many|cards)\\b`] },
  discard: { keys: ["捨てる", "ディスカード", "手札を捨てる"], patterns: ["\\bdiscards?\\b"] },
  gainLife: { keys: ["ライフを得る", "回復", "ライフを回復"], patterns: [`\\bgains? ${NUM} life\\b|\\bgains? life equal\\b`] },
  loseLife: { keys: ["ライフを失う", "ライフを払う", "ライフ損失"], patterns: [`\\bloses? ${NUM} life\\b|\\bloses? life equal\\b|\\bpay ${NUM} life\\b`] },
  damage: { keys: ["ダメージを与える", "ダメージ", "焼く"], patterns: [`\\bdeals? ${NUM} damage\\b|\\bdeals? damage\\b`] },
  counter: { keys: ["打ち消す", "カウンター (呪文を打ち消す)"], patterns: ["\\bcounter (?:target|that|it)\\b"] },
  destroy: { keys: ["破壊する", "壊す"], patterns: ["\\bdestroy\\b"] },
  exile: { keys: ["追放する", "追放"], patterns: ["\\bexile\\b"] },
  bounce: { keys: ["手札に戻す", "バウンス", "持ち主の手札に戻す"], patterns: ["\\breturn [^.]* to (?:its owner's|their owner's|your|their) hands?\\b"] },
  move: { keys: ["動かす", "墓地に置く", "ライブラリーの上・下に置く", "墓地から戻す"], patterns: ["\\breturn [^.]* from (?:a|your|your|their|target) graveyard\\b|\\bputs? [^.]* into (?:your|their) hand\\b|\\bputs? [^.]* (?:on top of|on the bottom of|into) [^.]*(?:library|graveyard)\\b|\\bput the rest\\b|\\bputs? all the cards\\b"] },
  createToken: { keys: ["トークンを作る", "トークンを生成"], patterns: ["\\bcreates? [^.]*tokens?\\b"] },
  addCounter: { keys: ["カウンターを置く", "+1/+1 カウンター"], patterns: ["\\bputs? [^.]*counters? on\\b"] },
  look: { keys: ["見る", "占術", "諜報", "ライブラリーの上を見る"], patterns: ["\\bscry\\b|\\bsurveil\\b|\\blook at the top\\b|\\breveal the top\\b"] },
  search: { keys: ["探す", "サーチ", "ライブラリーから探す"], patterns: ["\\bsearch (?:your|their|target player's) library\\b"] },
  shuffle: { keys: ["切る", "シャッフル"], patterns: ["\\bshuffles?\\b"] },
  addMana: { keys: ["マナを加える", "マナ"], patterns: ["\\badd \\{|\\badds? (?:one|two|three|\\{)"] },
  modify: { keys: ["修整を受ける", "+X/+X", "パワー・タフネスの修整"], patterns: ["\\bgets? [+-][\\dx]+\\/[+-][\\dx]+\\b"] },
  sacrifice: { keys: ["生け贄に捧げる", "生け贄"], patterns: ["\\bsacrifices?\\b"] },
  untap: { keys: ["アンタップする"], patterns: ["\\buntap\\b"] },
  tap: { keys: ["タップする"], patterns: ["\\btaps?\\b"] },
  attach: { keys: ["付ける", "装備する", "オーラ"], patterns: ["\\battach\\b"] },
  copySpell: { keys: ["呪文をコピーする", "コピー"], patterns: ["\\bcopy (?:target|that|it|this) (?:instant|sorcery|spell)\\b|\\bcopy target spell\\b"] },
  extraTurn: { keys: ["追加のターン"], patterns: ["\\bextra turn\\b"] },
  exchangeControl: { keys: ["コントロールを交換する"], patterns: ["\\bexchange control\\b"] },
  lookHand: { keys: ["手札を見る", "手札を公開させる"], patterns: ["\\blook at (?:target (?:player|opponent)'s|their|that player's|your opponent's) hands?\\b|\\breveals? (?:their|your|his or her) hand\\b"] },
  payOrMove: { keys: ["ライフを払うか、戻す"], patterns: ["\\bpay \\d+ life or put\\b"] },
  becomes: { keys: ["〜になる", "変身させる"], patterns: ["\\bbecomes? (?:a|an|the)\\b"] },
  grant: { keys: ["能力を得る", "飛行を得る"], patterns: ["\\bgains? (?:flying|first strike|deathtouch|haste|trample|vigilance|lifelink|hexproof|indestructible|reach|menace)\\b"] },
  choose: { keys: ["選ぶ", "その中から選ぶ"], patterns: ["\\bchoose (?:up to |one |two |three )?(?:of|from|a card|target)\\b|\\byou may put\\b|\\bchoose \\w+ of them\\b|\\b(?:one|two|three|that many) of them\\b|\\bof those cards\\b"] },
};

// 組み込みのノードに、キーと言い回しを、取り付ける (ノードの定義に、直接書いてあるものは、そちらを優先)。表にあるのに、ノードが無い id は、書き間違い: 例外
export function applyNodeKeys(): void {
  const byId = new Map(allNodes().map((n) => [n.id, n]));
  for (const [id, k] of Object.entries(NODE_KEYS)) {
    const def = byId.get(id);
    if (!def) throw new Error(`nodes/keys.ts: ノード ${id} が無い (id の書き間違い)`);
    def.keys ??= k.keys;
    def.patterns ??= k.patterns;
  }
}
