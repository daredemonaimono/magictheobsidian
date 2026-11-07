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
