import { NodeDef } from "../node";
import { defineNode as define } from "../registry";
import { KEYWORDS, cont, who } from "./shared";

// ノード: 継続効果
const CATEGORY = "継続効果";
const node = (def: Omit<NodeDef, "category">) => define({ ...def, category: CATEGORY });

export function registerContinuous(): void {
  // 継続効果 (常在型能力・装備・オーラ): 常在型能力の最初に affect を書き、その後ろに効果のノードを並べる。エンジン (continuous.ts) が、レイヤーの順に計算する。
  // 宣言のノードなので、if= は付けられない。reduceCost は affect が要らない

  node({
    id: "affect",
    core: true,
    title: "及ぶ先",
    summary: "継続効果の常在型能力の最初に書く、効果が及ぶ先。who=attached(このパーマネントが付いているもの。装備・オーラ) / self(このパーマネント自身) / yours(自分のパーマネント) / all(すべて)。type・notType で型を絞る。turn=yours で、そのコントローラーのターンのあいだだけ(「自分のターンのあいだ、先制攻撃を持つ」)/ opponents で、相手のターンのあいだだけ。minSpeed=4 で、速度が 4 (最高速度) のあいだだけ",
    params: { who: { type: "string", required: true, choices: ["attached", "self", "yours", "all"] }, type: { type: "string" }, notType: { type: "string" }, turn: { type: "string", choices: ["yours", "opponents"] }, minSpeed: { type: "number" } },
    ...cont,
  });

  node({ id: "staticModify", title: "修整(継続)", summary: "及ぶ先が、+power/+toughness の修整を受ける(レイヤー7)", params: { power: { type: "number", required: true }, toughness: { type: "number", required: true } }, ...cont });

  node({ id: "staticGrant", title: "キーワードを与える(継続)", summary: "及ぶ先が、キーワード能力を持つ(レイヤー6)。prowess を与えると、果敢として働く", params: { keyword: { type: "string", required: true, choices: KEYWORDS } }, ...cont });

  node({ id: "loseAbilities", title: "すべての能力を失う", summary: "及ぶ先が、すべての能力を失う(誘発型・起動型・常在型・キーワード。レイヤー6)", params: {}, ...cont });

  node({ id: "setBaseStats", title: "基本のパワー・タフネス", summary: "及ぶ先の基本のパワー・タフネスを power/toughness にする(レイヤー7b。カウンターや修整は、そのあとで足される)", params: { power: { type: "number", required: true }, toughness: { type: "number", required: true } }, ...cont });

  node({ id: "setTypes", title: "型行を変える", summary: "及ぶ先の型行を types にする(例: \"Creature — Citizen\"。レイヤー4)", params: { types: { type: "string", required: true } }, ...cont });

  node({ id: "setColors", title: "色を変える", summary: "及ぶ先の色を colors にする(空白区切り。例: \"G W\"。レイヤー5)", params: { colors: { type: "string", required: true } }, ...cont });

  node({ id: "setName", title: "名前を変える", summary: "及ぶ先の名前を name にする(レイヤー4。表示用)", params: { name: { type: "string", required: true } }, ...cont });

  node({ id: "extraTriggers", title: "誘発の追加", summary: "及ぶ先の誘発型能力が、追加で amount 回誘発する", params: { amount: { type: "number", required: true, min: 1 } }, ...cont });
}
