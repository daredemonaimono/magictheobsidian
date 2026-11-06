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
      "対象を決める。zone=stack + kind=spell(スタックの呪文) / zone=battlefield + kind=permanent(戦場のパーマネント) / zone=player + kind=player(プレイヤー。draw や discard の player=target と使う) / zone=graveyard + kind=card(墓地のカード。type=creature などで絞る。controller=you は、自分の墓地) / zone=any + kind=any(「any target」。プレイヤー・クリーチャー・プレインズウォーカー。damage と使う)。" +
      "type=型 / notType=その型でない / mv=マナ総量 / controller=you(この呪文のコントローラーのもの)・opponents(それ以外) / attacking=攻撃中か / tapped=タップ状態 で絞る。min / max = 対象の数(既定は1。「1体か2体」は min=1 max=2、「最大1つ」は min=0 max=1)",
    params: {
      zone: { type: "string", required: true, choices: ["stack", "battlefield", "player", "any", "graveyard"] },
      kind: { type: "string", required: true, choices: ["spell", "permanent", "player", "any", "card"] },
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
        if (a.zone === "graveyard" && a.kind === "card") {
          const c = Object.values(g.graveyards).flat().find((x) => x.id === id); // 墓地のカード (controller は、墓地の持ち主)
          return !!c && matches(ctx, a, { card: c, controller: c.owner });
        }
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

  // 対象のパーマネントの、パワー・タフネス・マナ総量 (いまの値。複数なら、合計) を、数として出す。「そのパワーに等しいライフ」は、追放・破壊の前に、これで読む (戦場を離れたあとは、読めない)
  node({
    id: "statOf",
    title: "数値を読む",
    summary: "対象(複数なら、合計)のパワー・タフネス・マナ総量を、n として出力する (stat=power / toughness / mv)。戦場を離れる効果の前に使う: 「そのパワーに等しいライフを得る」(Swords to Plowshares)は、statOf → exile → gainLife amount=$名前",
    params: { target: { type: "ref", required: true }, stat: { type: "string", required: true, choices: ["power", "toughness", "mv"] } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      let n = 0;
      for (const id of idList(a.target)) {
        const perm = g.battlefield.find((x) => x.id === id);
        if (!perm) continue;
        const now = characteristics(g, perm, ctx.rules);
        n += a.stat === "mv" ? perm.card.mv : a.stat === "toughness" ? now.toughness ?? 0 : now.power ?? 0;
      }
      return { n };
    },
  });

  // 対象のパーマネントの、コントローラー。「そのコントローラーは、〜」は、これを player=target の、target に渡す
  node({
    id: "controllerOf",
    title: "コントローラーを読む",
    summary: "対象のパーマネント(複数なら、先頭)のコントローラーを、id として出力する。「そのコントローラーは、ライフを得る」は、controllerOf as=名前 → gainLife player=target target=$名前。戦場を離れる効果の前に使う",
    params: { target: { type: "ref", required: true } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const perm = ctx.game.battlefield.find((x) => x.id === idList(a.target)[0]);
      return perm ? { id: perm.controller } : {};
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

  // この呪文を唱えるために払ったマナの色の数 (収束)
  node({
    id: "spentColors",
    title: "払ったマナの色の数",
    summary: "この呪文を唱えるために払ったマナの色の数 (W・U・B・R・G のうち、何色か) を出力する。収束 (Converge): Prismatic Ending。色の決まらない好きな色のマナで払った分は、数えない",
    params: {},
    outputs: { n: "number" },
    only: ["spell"],
    run: (ctx): Record<string, Value> => ({ n: ctx.item.cast.colors ?? 0 }),
  });

  // 2つの数を比べる
  node({
    id: "compare",
    title: "数を比べる",
    summary: "a と b を、op (lt = a<b / le = a≤b / eq = a=b / ge = a≥b / gt = a>b) で比べて、成り立てば true、でなければ false を出力する。as= で名前を付けて、if=$名前 で使う(「マナ総量が、払った色の数以下なら」は statOf と spentColors と使う)",
    params: { a: { type: "number", required: true }, b: { type: "number", required: true }, op: { type: "string", required: true, choices: ["lt", "le", "eq", "ge", "gt"] } },
    outputs: { ok: "boolean" },
    run: (_ctx, a): Record<string, Value> => {
      const x = Number(a.a);
      const y = Number(a.b);
      return { ok: a.op === "lt" ? x < y : a.op === "le" ? x <= y : a.op === "eq" ? x === y : a.op === "ge" ? x >= y : x > y };
    },
  });

  // 誘発の引き金になったパーマネント (「攻撃したクリーチャー」「出てきたクリーチャー」)
  node({
    id: "eventPerm",
    title: "引き金のパーマネント",
    summary: "誘発型能力の引き金になったものの id を出力する(event が enters / leaves / attacks / blocks ならそのパーマネント、cast なら唱えられた呪文)。as= を付けて target に渡す(「そのクリーチャーは +1/+1」「その呪文を打ち消す」など)",
    params: {},
    outputs: { id: "id" },
    only: ["triggered"],
    run: (ctx): Record<string, Value> => (ctx.item.trigger ? { id: ctx.item.trigger } : {}),
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
