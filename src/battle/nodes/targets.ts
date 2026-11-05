import { characteristics } from "../continuous";
import { NodeDef, Value } from "../node";
import { defineNode as define } from "../registry";
import { Perm, playersOf, typeIn } from "../state";
import { filterParams, findCard, idList, matches, who } from "./shared";

// ノード: 対象・数える・絞り込む
const CATEGORY = "対象・数える・絞り込む";
const node = (def: Omit<NodeDef, "category">) => define({ ...def, category: CATEGORY });

export function registerTargets(): void {
  // 対象を決める。唱えるときに選んだ対象 (ctx.item.targets[as]。複数ならカンマ区切り) が、いまも条件に合っていれば id を返す。合わなければ空
  node({
    id: "target",
    core: true,
    title: "対象",
    summary:
      "対象を決める。zone=stack + kind=spell(スタックの呪文) / zone=battlefield + kind=permanent(戦場のパーマネント) / zone=player + kind=player(プレイヤー。draw や discard の player=target と使う) / zone=any + kind=any(「any target」。プレイヤー・クリーチャー・プレインズウォーカー。damage と使う)。" +
      "type=型 / notType=その型でない / mv=マナ総量 / controller=you(この呪文のコントローラーのもの)・opponents(それ以外) / attacking=攻撃中か / tapped=タップ状態 で絞る。min / max = 対象の数(既定は1。「1体か2体」は min=1 max=2、「最大1つ」は min=0 max=1)",
    params: {
      zone: { type: "string", required: true, choices: ["stack", "battlefield", "player", "any"] },
      kind: { type: "string", required: true, choices: ["spell", "permanent", "player", "any"] },
      ...filterParams,
      min: { type: "number", min: 0 },
      max: { type: "number", min: 1 },
    },
    outputs: { id: "id" },
    isTarget: true,
    run: (ctx, a): Record<string, Value> => {
      const list = idList(ctx.item.targets[ctx.call.as ?? ""]);
      const min = typeof a.min === "number" ? a.min : 1;
      const max = typeof a.max === "number" ? a.max : Math.max(1, min);
      if (list.length === 0 && min > 0) return {}; // 必要な対象が無い (誘発型能力は、誘発時に対象を選べない)
      const strict = ctx.phase === "cast"; // 唱えるときは、数も、すべての対象も合法でなければならない
      if (strict && (list.length < min || list.length > max || new Set(list).size !== list.length)) return {};
      const g = ctx.game;
      const legal = (id: string): boolean => {
        if (a.zone === "player" && a.kind === "player") return g.players.includes(id); // プレイヤーは型・マナ総量で絞らない
        if (a.zone === "any" && a.kind === "any" && g.players.includes(id)) return true;
        const anyHit = a.zone === "any" && a.kind === "any" ? g.battlefield.find((p) => p.id === id && /\b(Creature|Planeswalker)\b/.test(characteristics(g, p, ctx.rules).typeLine)) : undefined;
        // zone と kind の組み合わせは stack+spell / battlefield+permanent だけ。それ以外は対象無し (スタックの起動型能力は呪文ではない)
        const hit = a.zone === "stack" && a.kind === "spell" ? g.stack.find((s) => s.id === id && !s.ability) : (a.zone === "battlefield" && a.kind === "permanent") || anyHit ? g.battlefield.find((p) => p.id === id && (a.zone !== "any" || p === anyHit)) : undefined;
        if (!hit) return false;
        const now = a.zone === "battlefield" || a.zone === "any" ? characteristics(g, hit as Perm, ctx.rules) : undefined; // 継続効果をふまえた、いまの型・キーワード
        if (!matches(ctx, a, hit, now?.typeLine)) return false;
        // 呪禁: 相手のコントロールする呪文や能力の対象にならない
        return !(now && now.keywords.includes("hexproof") && hit.controller !== ctx.item.controller);
      };
      const ok = list.filter(legal);
      if (strict ? ok.length !== list.length : list.length > 0 && !ok.length) return {}; // 解決時は、残った合法な対象にだけ効く。全部が不正なら、解決しない
      return { id: ok.join(",") };
    },
  });

  // 対象を取らずに、条件に合うものすべてを集める (「すべての攻撃クリーチャー」)。呪禁には関係しない
  node({
    id: "select",
    core: true,
    title: "すべて選ぶ",
    summary: "対象を取らずに、条件に合うものすべてを選ぶ(「すべての〜」)。zone=battlefield + kind=permanent / zone=stack + kind=spell。絞り込みは target と同じ(type / notType / mv / controller / attacking / tapped)。bounce や tap などの target に渡せる",
    params: {
      zone: { type: "string", required: true, choices: ["stack", "battlefield"] },
      kind: { type: "string", required: true, choices: ["spell", "permanent"] },
      ...filterParams,
    },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const all = a.zone === "stack" && a.kind === "spell" ? g.stack.filter((s) => !s.ability) : a.zone === "battlefield" && a.kind === "permanent" ? g.battlefield : [];
      return { id: all.filter((x) => matches(ctx, a, x, a.zone === "battlefield" ? characteristics(g, x as Perm, ctx.rules).typeLine : undefined)).map((x) => x.id).join(",") };
    },
  });

  // 数える・絞り込む (値を作るノード)
  node({
    id: "countCards",
    title: "枚数を数える",
    summary: "zone(hand / graveyard / library / battlefield)のカードの枚数を、n として出力する(who=you・opponents。type・notType で絞る)。「手札の枚数に等しい X」は、これを as= で受けて、count=$名前 に渡す",
    params: { zone: { type: "string", required: true, choices: ["hand", "graveyard", "library", "battlefield"] }, who: { type: "string", choices: ["you", "opponents"] }, type: { type: "string" }, notType: { type: "string" } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const who = playersOf(g, ctx.item.controller, a.who === "opponents" ? "opponents" : "you");
      const cards = who.flatMap((p) => (a.zone === "battlefield" ? g.battlefield.filter((x) => x.controller === p).map((x) => x.card) : (a.zone === "hand" ? g.hands : a.zone === "graveyard" ? g.graveyards : g.libraries)[p] ?? []));
      return { n: cards.filter((c) => (typeof a.type !== "string" || typeIn(c.typeLine, a.type)) && (typeof a.notType !== "string" || !typeIn(c.typeLine, a.notType))).length };
    },
  });

  node({
    id: "filter",
    title: "絞り込む",
    summary: "from(look / choose などの出力)のカードのうち、type(| は または)に合い、notType(| は どれでもない)に合うものだけを、出力する",
    params: { from: { type: "ref", required: true }, type: { type: "string" }, notType: { type: "string" } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => ({
      id: idList(a.from)
        .filter((id) => {
          const c = findCard(ctx.game, id);
          return !!c && (typeof a.type !== "string" || typeIn(c.typeLine, a.type)) && (typeof a.notType !== "string" || !typeIn(c.typeLine, a.notType));
        })
        .join(","),
    }),
  });

  // このパーマネント自身 (誘発型・起動型能力の発生源)
  node({
    id: "self",
    core: true,
    title: "このパーマネント",
    summary: "この能力の発生源のパーマネント自身の id を出力する(「このクリーチャーの上に」など。as= を付けて、target に渡す)",
    params: {},
    outputs: { id: "id" },
    run: (ctx): Record<string, Value> => ({ id: ctx.item.source ?? "" }),
  });
}
