import { NodeData } from "../node/md";

// 組み終わったノードの例。AI への手引き (docs/ai-guide.md) の「例」になる。
// **ノードを組んだら、ここに追記する** (人間も AI も共通のルール)。追記したら、`npm run guide` で、手引きを更新する。
// テストが、すべての例を検証する (定義にある部品だけで書けているか)。source = 原文の 1 行 (英語。そのまま)。
export interface Example {
  card: string; // カード名
  node: NodeData;
}
const call = (id: string, args: Record<string, string> = {}) => ({ node: false as const, id, args });
const KW13 = "flying|fear|first-strike|double-strike|deathtouch|haste|landwalk|lifelink|protection|reach|trample|shroud|vigilance";

export const EXAMPLES: Example[] = [
  { card: "Changeling の例", node: { name: "Changeling", source: "Changeling", kind: "keyword", timing: "always", keyword: "changeling", steps: [call("all-creature-types")] } },
  { card: "Flying の例", node: { name: "Flying", source: "Flying", kind: "keyword", timing: "always", keyword: "flying", steps: [] } },
  { card: "Menace の例", node: { name: "Menace", source: "Menace", kind: "keyword", timing: "always", steps: [call("block-requirement", { "min-blockers": "2" })] } },
  {
    card: "Ferocious の例 (誘発型・条件つき)",
    node: {
      name: "Whenever this creature attacks, if you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.",
      source: "Whenever this creature attacks, if you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.",
      kind: "triggered", timing: "attacks", target: "self", condition: { id: "controls-power-at-least", args: { n: "4" } },
      steps: [call("modify-pt", { power: "2", toughness: "2", duration: "until-eot" })],
    },
  },
  {
    card: "Thought Reflection (置換効果)",
    node: { name: "If you would draw a card, draw two cards instead.", source: "If you would draw a card, draw two cards instead.", kind: "static", timing: "replace-draw", steps: [call("draw", { amount: "2" })] },
  },
  {
    card: "Cairn Wanderer (墓地のキーワード。複数のキーワードは、| でつなぐ)",
    node: {
      name: "As long as a creature card with flying is in a graveyard, this creature has flying. The same is true for fear, first strike, double strike, deathtouch, haste, landwalk, lifelink, protection, reach, trample, shroud, and vigilance.",
      source: "As long as a creature card with flying is in a graveyard, this creature has flying. The same is true for fear, first strike, double strike, deathtouch, haste, landwalk, lifelink, protection, reach, trample, shroud, and vigilance.",
      kind: "static", timing: "always", target: "self",
      condition: { id: "graveyard-has-keyword-creature", args: { keyword: KW13 } },
      steps: [call("grant-keyword", { keyword: KW13 })],
    },
  },
  {
    card: "Charging Rhino (ブロックの上限)",
    node: { name: "Charging Rhino can't be blocked by more than one creature.", source: "Charging Rhino can't be blocked by more than one creature.", kind: "static", timing: "always", target: "self", steps: [call("max-blockers", { "max-blockers": "1" })] },
  },
  {
    card: "Force of Will 1 行目 (代替コスト。手順 = 支払うコスト)",
    node: {
      name: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.",
      source: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.",
      kind: "static", timing: "alternative-cost", steps: [call("pay-life", { amount: "1" }), call("exile-from-hand", { count: "1", color: "blue" })],
    },
  },
  {
    card: "Force of Will 2 行目 (呪文能力。何を打ち消すかは、対象の欄)",
    node: { name: "Counter target spell.", source: "Counter target spell.", kind: "spell", timing: "resolves", target: "target-spell", steps: [call("counter")] },
  },
  {
    card: "Chandra, Acolyte of Flame 0 (忠誠度能力・トークン・遅延誘発。「それら」= 生成したトークン)",
    node: {
      name: "0: Create two 1/1 red Elemental creature tokens. They gain haste. Sacrifice them at the beginning of the next end step.",
      source: "0: Create two 1/1 red Elemental creature tokens. They gain haste. Sacrifice them at the beginning of the next end step.",
      kind: "activated", timing: "loyalty", loyalty: "0", target: "created-tokens",
      steps: [call("create-token", { count: "2", token: "Elemental Token (1-1 R)" }), call("grant-keyword", { keyword: "haste" }), call("delayed-trigger", { when: "end-step" }), call("sacrifice")],
    },
  },
  {
    card: "Chandra, Acolyte of Flame 0 (「各〜」= 対象を取らない)",
    node: {
      name: "0: Put a loyalty counter on each red planeswalker you control.",
      source: "0: Put a loyalty counter on each red planeswalker you control.",
      kind: "activated", timing: "loyalty", loyalty: "0", target: "each", targetArgs: { controller: "you", type: "planeswalker", color: "red" },
      steps: [call("add-counter", { kind: "loyalty", amount: "1" })],
    },
  },
  {
    card: "Chandra, Acolyte of Flame −2 (忠誠度のコスト −2・墓地のカードを対象にする・唱えてもよい・置換)",
    node: {
      name: "−2: You may cast target instant or sorcery card with mana value 3 or less from your graveyard. If that spell would be put into your graveyard, exile it instead.",
      source: "−2: You may cast target instant or sorcery card with mana value 3 or less from your graveyard. If that spell would be put into your graveyard, exile it instead.",
      kind: "activated", timing: "loyalty", loyalty: "-2", target: "target-object",
      targetArgs: { controller: "you", zone: "graveyard", type: "instant|sorcery", color: "any", "mana-value-max": "3" },
      steps: [call("may-cast", { duration: "this-turn" }), call("exile-instead-of-graveyard", { duration: "this-turn" })],
    },
  },
  {
    card: "Mana Vault 1 (アンタップしない。「ステップに〜しない」)",
    node: { name: "Mana Vault doesn't untap during your untap step.", source: "Mana Vault doesn't untap during your untap step.", kind: "static", timing: "always", target: "self", steps: [call("does-not-untap")] },
  },
  {
    card: "Mana Vault 2 (「支払ってもよい。そうしたなら」= mayPay の後ろが、支払ったときの手順)",
    node: {
      name: "At the beginning of your upkeep, you may pay {4}. If you do, untap Mana Vault.",
      source: "At the beginning of your upkeep, you may pay {4}. If you do, untap Mana Vault.",
      kind: "triggered", timing: "upkeep", target: "self", steps: [call("may-pay", { mana: "{4}" }), call("untap")],
    },
  },
  {
    card: "Mana Vault 3 (誘発型の「〜なら」= condition (誘発したときと、解決するときに確かめる)。ダメージを受けるのは、対象の `you`)",
    node: {
      name: "At the beginning of your draw step, if Mana Vault is tapped, it deals 1 damage to you.",
      source: "At the beginning of your draw step, if Mana Vault is tapped, it deals 1 damage to you.",
      kind: "triggered", timing: "draw-step", target: "you", condition: { id: "is-tapped", args: {} }, steps: [call("deal-damage", { amount: "1" })],
    },
  },
  {
    card: "Mana Vault 4 (起動型。コスト = cost の欄、効果 = steps。マナ能力 (605): 対象を取らず、マナを加える)",
    node: { name: "{T}: Add {C}{C}{C}.", source: "{T}: Add {C}{C}{C}.", kind: "activated", timing: "anytime", cost: [{ id: "tap-self", args: {} }], steps: [call("add-mana", { mana: "{C}{C}{C}" })] },
  },
  {
    card: "Black Lotus (コストに「生け贄に捧げる」= sacrificeCost。「好きな 1 色のマナを N 点」= addManaOfAnyOneColor。コストの全文を、cost に)",
    node: {
      name: "{T}, Sacrifice this artifact: Add three mana of any one color.",
      source: "{T}, Sacrifice this artifact: Add three mana of any one color.",
      kind: "activated", timing: "anytime",
      cost: [{ id: "tap-self", args: {} }, { id: "sacrifice-cost", args: { what: "self" } }],
      steps: [call("add-mana-any-color", { amount: "3" })],
    },
  },
  {
    card: "Oko, Thief of Crowns +2 (「〜になる」= becomeToken。何になるかは、登録済みのトークンのカード名。対象は、タイプを複数選べる)",
    node: {
      name: "+2: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.",
      source: "+2: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.",
      kind: "activated", timing: "loyalty", loyalty: "+2", target: "target-object",
      targetArgs: { controller: "any", zone: "battlefield", type: "artifact|creature", color: "any" },
      steps: [call("become-token", { token: "Elk Token (3-3 G)", duration: "indefinite" })],
    },
  },
  {
    card: "Oko, Thief of Crowns −5 (対象が 2 つ: target = 最初の対象、alsoTarget = もう1つの対象。「パワーが 3 以下」= power-max。exchangeControl は、対象 1 と対象 2 を使う)",
    node: {
      name: "−5: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.",
      source: "−5: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.",
      kind: "activated", timing: "loyalty", loyalty: "-5", target: "target-object",
      targetArgs: { controller: "you", zone: "battlefield", type: "artifact|creature", color: "any" },
      alsoTargets: [{ id: "target-object", args: { controller: "opponent", zone: "battlefield", type: "creature", color: "any", "power-max": "3" } }],
      steps: [call("exchange-control")],
    },
  },
];
