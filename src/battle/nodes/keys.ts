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
  dredge: { keys: ["ドレッジ", "引くかわりに墓地から戻す", "引く代わりにライブラリーを削って手札に戻す"] },
  delay: { keys: ["次の終了ステップの開始時に", "あとで", "遅延誘発"] },
  lifeGained: { keys: ["このターンにライフを得た", "ライフを得ていたら"] },
  math: { keys: ["計算する", "−X/−X (X を負にする)", "足す・引く・かける"] },
  entersWith: { keys: ["カウンターが置かれた状態で出る", "出るときにカウンター"] },
  counterCount: { keys: ["カウンターの数", "カウンターが何個"] },
  regenerate: { keys: ["再生する", "再生の盾"] },
  exileInstead: { keys: ["墓地に行くかわりに追放", "墓地に置かれるかわりに追放する"] },
  startOnBattlefield: { keys: ["ゲームの開始時に戦場に出してよい", "開始時の手札にあれば戦場に"] },
  mulliganExile: { keys: ["マリガンのかわりに手札を追放して引く", "マリガンできるとき手札を入れ替える"] },
  ignoreLegendRule: { keys: ["伝説のルールを無視する", "伝説のルールは適用されない", "レジェンド・ルール"] },
  mill: { keys: ["墓地に置く (ライブラリーから)", "切削", "ミル", "ライブラリーの上から N 枚を墓地へ"] },
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

// ノードの「役割」: そのノードが、対戦で何をするか。カードの能力のノードの役割を集めると、そのカードの働き (除去・ドロー・墓地を肥やす…) が、コードだけで分かる。
// AI への行動の分析 (候補ごとの「役割」) に出る。ノードを足すときは、ここに、役割を足す (無い部品 (対象・条件・計算) は []。足し忘れは、テストが見つける)。
// removal = 相手のものを取り除く / counterSpell = 呪文を打ち消す / damage = ダメージ / lifeGain・lifeLoss = ライフ / cardAdvantage = 引く・探す / cardSelection = 見る・選ぶ /
// discard = 捨てる / graveyardFill = 墓地に置く / graveyardValue = 墓地で働く / graveyardHate = 相手の墓地を邪魔する / zoneChange = カードを動かす / mana = マナ /
// boardGrowth = 盤面を増やす・強くする / statChange = 修整 / tempo = タップ・アンタップ / control = コントロール・変身 / protection = 守る / sacrifice = 生け贄 /
// handDisruption = 相手の手札に触れる / restriction = 制限 / costReduction = コスト軽減 / alternativeCost = 別のコスト / replacement = 置換 / opening = ゲーム開始時 /
// extraTurn / copy / storm / continuous = 継続効果 / rulesException = ルールの例外
export const NODE_ROLES: Record<string, string[]> = {
  // 宣言・コスト・条件
  cost: [], additionalCost: [], altCost: ["alternativeCost"], delve: ["alternativeCost"], storm: ["storm"], modes: [], when: [], keyword: [], timing: [], delay: [],
  reduceCost: ["costReduction"], castLimit: ["restriction"], cantCast: ["restriction"], cantActivate: ["restriction"], entersTapped: ["restriction"], cantEnter: ["restriction"], upkeepTax: ["restriction"],
  ward: ["protection"], untapDuring: ["tempo"], exileInstead: ["graveyardHate", "replacement"], ignoreLegendRule: ["rulesException"], startOnBattlefield: ["opening"], mulliganExile: ["opening"],
  entersWith: ["boardGrowth"], dredge: ["graveyardValue", "replacement"],
  // 対象・数える・絞り込む
  target: [], select: [], countCards: [], statOf: [], counterCount: [], controllerOf: [], filter: [], spentColors: [], compare: [], math: [], eventPerm: [], self: [],
  // カードの移動・ライブラリー・手札
  draw: ["cardAdvantage"], exilePlay: ["cardAdvantage"], discard: ["discard"], look: ["cardSelection"], lookHand: ["handDisruption"], shuffle: [], choose: [], move: ["zoneChange"], mill: ["graveyardFill"], zoneCards: [], drawnCards: [],
  payOrMove: ["cardSelection"], bounce: ["removal"], sacrifice: ["sacrifice"], destroy: ["removal"], search: ["cardAdvantage"], exile: ["removal"],
  // パーマネント・トークン・カウンター
  tap: ["tempo"], untap: ["tempo"], modify: ["statChange"], becomes: ["control"], exchangeControl: ["control"], grant: ["boardGrowth"], prepareSpell: [], entersPrepared: [], prepare: [], attach: ["boardGrowth"],
  emblem: ["continuous"], createEmblem: ["continuous"], createToken: ["boardGrowth"], regenerate: ["protection"], addCounter: ["boardGrowth"],
  // ダメージ・ライフ・マナ・打ち消し
  gainLife: ["lifeGain"], loseLife: ["lifeLoss"], lifeGained: [], lifeLost: [], startEngines: ["speed"], ignoreWard: ["restriction"], unlockDoor: ["boardGrowth"], chooseColor: ["colorChoice"], castFromGraveyard: ["graveyardValue"], cantBlock: ["restriction"], playerRemoves: ["removal"], payMana: [], staticAddType: ["continuous"], gainAbility: ["boardGrowth"], cantGainLife: ["restriction"], reflexive: [], spellsCast: [], hasKeyword: [], hasType: [], castWith: [], damage: ["damage"], addMana: ["mana"], extraTurn: ["extraTurn"], copySpell: ["copy"], counter: ["counterSpell"],
  // 継続効果
  affect: [], staticModify: ["continuous"], staticGrant: ["continuous"], staticMana: ["continuous"], loseAbilities: ["continuous"], setBaseStats: ["continuous"], setTypes: ["continuous"], setColors: ["continuous"], setName: ["continuous"], extraTriggers: ["continuous"],
};

// 組み込みのノードに、キーと言い回しを、取り付ける (ノードの定義に、直接書いてあるものは、そちらを優先)。表にあるのに、ノードが無い id は、書き間違い: 例外
export function applyNodeKeys(): void {
  const byId = new Map(allNodes().map((n) => [n.id, n]));
  for (const [id, k] of Object.entries(NODE_KEYS)) {
    const def = byId.get(id);
    if (!def) throw new Error(`nodes/keys.ts: ノード ${id} が無い (id の書き間違い)`);
    def.keys ??= k.keys;
  }
  for (const [id, r] of Object.entries(NODE_ROLES)) {
    const def = byId.get(id);
    if (!def) throw new Error(`nodes/keys.ts: NODE_ROLES の ${id} が、ノードに無い (id の書き間違い)`);
    def.roles ??= r;
  }
}
