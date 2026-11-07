import { Ability } from "./node";
import { getNode } from "./registry";
import { RuleBook } from "./state";

// カード・能力の「役割」: 能力のノードの役割 (NODE_ROLES) を集める。コードだけで、カードの働き (除去・ドロー・墓地で働く…) が分かる。ルールの無いカードは、役割なし
const uniq = (xs: string[]) => [...new Set(xs)];

export function abilityRoles(ab: Ability): string[] {
  const roles = ab.body.flatMap((c) => getNode(c.node)?.roles ?? []);
  // 墓地にあるあいだ働く誘発型能力 (when zone=graveyard) は、墓地で働く
  if (ab.body.some((c) => c.node === "when" && c.args.zone === "graveyard")) roles.push("graveyardValue");
  // 「ライブラリーから墓地に置かれたとき」に働く誘発 (Narcomoeba・Creeping Chill): 切削・Dredge で落とすと得 (millPayoff)
  if (ab.body.some((c) => c.node === "when" && c.args.event === "moved" && c.args.from === "library" && c.args.zone === "graveyard")) roles.push("millPayoff");
  return uniq(roles);
}

export interface CardRoles {
  spell: string[];
  activated: string[][]; // 起動型能力ごと (起動型能力の並び順)
  all: string[]; // カード全体
}

export function cardRoles(rules: RuleBook, cardName: string): CardRoles {
  const abs = rules.get(cardName)?.abilities ?? [];
  return {
    spell: uniq(abs.filter((a) => a.kind === "spell").flatMap(abilityRoles)),
    activated: abs.filter((a) => a.kind === "activated").map(abilityRoles),
    all: uniq(abs.flatMap(abilityRoles)),
  };
}

// 役割の重み (AI・CPU の機械的な判断の元): 大きいほど、手元に残したい・先に出したい・先に除去したい。負は、手放してよい (墓地で働くカードは、捨てても損しない)。
// カード名・デッキごとの値ではなく、ノードの役割だけから決める。ノードに新しい役割を付けたら、ここに重みを足す (無い役割は 0)
export const ROLE_WEIGHT: Record<string, number> = {
  extraTurn: 5,
  removal: 4, counterSpell: 4, control: 4,
  cardAdvantage: 3,
  damage: 2, handDisruption: 2, boardGrowth: 2, evasion: 2, copy: 2, replacement: 2,
  tempo: 1, graveyardHate: 1, lifeGain: 1, mana: 1, cardSelection: 1, continuous: 1, protection: 1, restriction: 1, costReduction: 1, speed: 1, storm: 1, alternativeCost: 1,
  graveyardValue: -3, millPayoff: -4,
};
export const roleValue = (roles: string[]): number => roles.reduce((s, r) => s + (ROLE_WEIGHT[r] ?? 0), 0);

// 重みを 0 と決めた役割 (どちらとも言えない)。新しい役割を足したら、ROLE_WEIGHT か、ここに入れる (テストが見張る)
export const NEUTRAL_ROLES = ["zoneChange", "opening", "colorChoice", "discard", "lifeLoss", "graveyardFill", "sacrifice", "rulesException", "statChange", "emblem", "createToken"];
