import { characteristics } from "../continuous";
import { NodeDef, Value } from "../node";
import { defineNode as define } from "../registry";
import { Game, Perm, normKeyword, playersOf, typeIn } from "../state";
import { KEYWORDS, filterParams, findCard, idList, matches, who } from "./shared";

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
      "対象を決める。zone=stack + kind=spell(スタックの呪文) / zone=battlefield + kind=permanent(戦場のパーマネント) / zone=player + kind=player(プレイヤー。draw や discard の player=target と使う。controller=opponents で対戦相手) / zone=graveyard + kind=card(墓地のカード。type=creature などで絞る。controller=you は、自分の墓地) / zone=any + kind=any(「any target」。プレイヤー・クリーチャー・プレインズウォーカー。damage と使う)。" +
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
        if (a.zone === "player" && a.kind === "player") return g.players.includes(id) && (typeof a.controller !== "string" || (a.controller === "you") === (id === ctx.item.controller)); // プレイヤーは、型・マナ総量では絞らない。controller=you / opponents だけで絞る (「対象の対戦相手」)
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
    summary: "zone(hand / graveyard / library / exile / battlefield)のカードの枚数を、n として出力する(who=you・opponents・all。type・notType・color・token=true で絞る)。「〜1つにつき」「〜の数に等しい」は、これを as= で受けて、count=$名前・amount=$名前・power=$名前 に渡す。常在型能力は、staticModify の perZone などで書く",
    params: { zone: { type: "string", required: true, choices: ["hand", "graveyard", "library", "exile", "battlefield"] }, who: { type: "string", choices: ["you", "opponents", "all"] }, type: { type: "string" }, notType: { type: "string" }, color: { type: "string", choices: ["W", "U", "B", "R", "G"] }, token: { type: "boolean" } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => ({ n: countCardsOf(ctx.game, ctx.item.controller, a) }),
  });

  // そのターンの出来事を数える: 条件の語 (raid・morbid・「このターンに〜した」) に使う
  node({
    id: "turnStat",
    title: "このターンの出来事",
    summary: "そのターンに起きたことの数を、n として出力する。stat=creaturesDied(死んだクリーチャーの数) / attacked(攻撃したなら 1) / landsPlayed(出した土地) / spellsCast(唱えた呪文) / cardsDrawn(引いたカード) / lifeGained / lifeLost。player=you・opponents・all。「このターンに攻撃していたなら」(raid)・「クリーチャーが死んでいたなら」(morbid)は、これを as= で受けて、compare op=ge b=1 と if=$名前",
    params: { stat: { type: "string", required: true, choices: ["creaturesDied", "attacked", "landsPlayed", "spellsCast", "cardsDrawn", "lifeGained", "lifeLost"] }, player: { type: "string", required: true, choices: ["you", "opponents", "all"] } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const ps = a.player === "all" ? g.players : playersOf(g, ctx.item.controller, String(a.player));
      const sum = (f: (p: string) => number) => ps.reduce((s, p) => s + f(p), 0);
      const n = a.stat === "creaturesDied" ? sum((p) => g.died?.[p] ?? 0) : a.stat === "attacked" ? sum((p) => (g.attacked?.[p] ? 1 : 0)) : a.stat === "landsPlayed" ? (ps.includes(g.active) ? g.landsPlayed : 0) : a.stat === "spellsCast" ? sum((p) => g.spellsBy?.[p] ?? 0) : a.stat === "cardsDrawn" ? sum((p) => g.drawn?.[p]?.length ?? 0) : a.stat === "lifeGained" ? sum((p) => g.gained?.[p] ?? 0) : sum((p) => g.lostLife?.[p] ?? 0);
      return { n };
    },
  });

  // 墓地にあるカードの種類の数 (Delirium: 4 種類以上)
  node({
    id: "graveyardTypes",
    title: "墓地のカードの種類の数",
    summary: "プレイヤー (player=you / opponents) の墓地にあるカードの、カードタイプ(土地・クリーチャー・アーティファクト・エンチャント・インスタント・ソーサリー・プレインズウォーカー)の種類の数を、n として出力する。Delirium(4 種類以上)は、これを as= で受けて、compare op=ge b=4",
    params: { player: { type: "string", required: true, choices: ["you", "opponents"] } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => {
      const kinds = new Set<string>();
      for (const p of playersOf(ctx.game, ctx.item.controller, String(a.player))) for (const c of ctx.game.graveyards[p] ?? []) for (const t of ["Land", "Creature", "Artifact", "Enchantment", "Instant", "Sorcery", "Planeswalker", "Battle"]) if (new RegExp(`\\b${t}\\b`).test(c.typeLine)) kinds.add(t);
      return { n: kinds.size };
    },
  });

  // 自分・相手のライフの合計 (「あなたのライフに等しい」「ライフが 10 以下なら」)
  node({
    id: "lifeTotal",
    title: "ライフの点数",
    summary: "プレイヤー (player=you / opponents) のいまのライフの点数を、n として出力する(複数なら合計)。「あなたのライフの点数に等しい」「相手のライフが 10 以下なら」は、これを as= で受けて、amount=$名前 や compare に渡す",
    params: { player: { type: "string", required: true, choices: ["you", "opponents"] } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => ({ n: playersOf(ctx.game, ctx.item.controller, String(a.player)).reduce((s, p) => s + (ctx.game.life[p] ?? 0), 0) }),
  });

  // 対象のパーマネントの、パワー・タフネス・マナ総量 (いまの値。複数なら、合計) を、数として出す。「そのパワーに等しいライフ」は、追放・破壊の前に、これで読む (戦場を離れたあとは、読めない)
  node({
    id: "statOf",
    title: "数値を読む",
    summary: "対象(複数なら、合計。スタックの呪文のマナ総量も)のパワー・タフネス・マナ総量を、n として出力する (stat=power / toughness / mv)。戦場を離れる効果の前に使う: 「そのパワーに等しいライフを得る」(Swords to Plowshares)は、statOf → exile → gainLife amount=$名前",
    params: { target: { type: "ref", required: true }, stat: { type: "string", required: true, choices: ["power", "toughness", "mv"] } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      let n = 0;
      for (const id of idList(a.target)) {
        const perm = g.battlefield.find((x) => x.id === id);
        if (!perm) {
          const sp = a.stat === "mv" ? g.stack.find((x) => x.id === id && !x.ability) : undefined; // スタックの呪文のマナ総量 (Chalice of the Void)
          if (sp) n += sp.card.mv;
          continue;
        }
        const now = characteristics(g, perm, ctx.rules);
        n += a.stat === "mv" ? perm.card.mv : a.stat === "toughness" ? now.toughness ?? 0 : now.power ?? 0;
      }
      return { n };
    },
  });

  // パーマネントの上のカウンターの数
  node({
    id: "counterCount",
    title: "カウンターの数",
    summary: "対象のパーマネント(複数なら合計)の上にある kind のカウンターの数を、n として出力する。「カウンターの数に等しいマナ総量」(Chalice of the Void)は、self as=s → counterCount target=$s kind=charge → compare",
    params: { target: { type: "ref", required: true }, kind: { type: "string", required: true } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => ({ n: idList(a.target).reduce((s, id) => s + (ctx.game.battlefield.find((x) => x.id === id)?.counters?.[String(a.kind)] ?? 0), 0) }),
  });

  // 対象のパーマネントの、コントローラー。「そのコントローラーは、〜」は、これを player=target の、target に渡す
  node({
    id: "controllerOf",
    title: "コントローラーを読む",
    summary: "対象のパーマネント(複数なら、先頭)のコントローラーを、id として出力する。「そのコントローラーは、ライフを得る」は、controllerOf as=名前 → gainLife player=target target=$名前。戦場を離れる効果の前に使う",
    params: { target: { type: "ref", required: true } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const id = idList(a.target)[0];
      const perm = ctx.game.battlefield.find((x) => x.id === id);
      const spell = perm ? undefined : ctx.game.stack.find((x) => x.id === id); // スタックの呪文 (eventPerm が、唱えられた呪文を返す): そのコントローラー
      return perm ? { id: perm.controller } : spell ? { id: spell.controller } : {};
    },
  });

  node({
    id: "filter",
    title: "絞り込む",
    summary: "from(look / choose などの出力)のカードのうち、type(| は または)に合い、notType(| は どれでもない)に合い、color(W U B R G)の色を持つものだけを、出力する。except(self などの出力)に渡したカードは除く",
    params: { from: { type: "ref", required: true }, type: { type: "string" }, notType: { type: "string" }, color: { type: "string" }, except: { type: "ref" } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => ({
      id: idList(a.from)
        .filter((id) => {
          const c = findCard(ctx.game, id);
          return !!c && (typeof a.type !== "string" || typeIn(c.typeLine, a.type)) && (typeof a.notType !== "string" || !typeIn(c.typeLine, a.notType)) && (typeof a.color !== "string" || (c.colors ?? []).includes(a.color)) && !idList(a.except).includes(id);
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

  // 対象の状態を調べる (条件に使う true / false): キーワード・型・どう唱えられたか
  node({
    id: "hasKeyword",
    title: "キーワードを持つか",
    summary: "対象のクリーチャー(複数なら先頭)が、いま keyword を持っているかを、ok として出力する。as= で受けて、if=$名前 (否定は if=!$名前)。「飛行を持つなら 2 倍」(Cut Propulsion)は、hasKeyword keyword=flying",
    params: { target: { type: "ref", required: true }, keyword: { type: "string", required: true, choices: KEYWORDS } },
    outputs: { ok: "boolean" },
    run: (ctx, a): Record<string, Value> => {
      const perm = ctx.game.battlefield.find((x) => x.id === idList(a.target)[0]);
      return { ok: !!perm && characteristics(ctx.game, perm, ctx.rules).keywords.includes(normKeyword(String(a.keyword))) };
    },
  });

  node({
    id: "hasType",
    title: "型を持つか",
    summary: "対象のパーマネント(複数なら先頭)の、いまの型行に type (型・サブタイプ。| は または) があるかを、ok として出力する。as= で受けて、if=$名前。「斥候なら」(Kellan)は、hasType type=Scout",
    params: { target: { type: "ref", required: true }, type: { type: "string", required: true } },
    outputs: { ok: "boolean" },
    run: (ctx, a): Record<string, Value> => {
      const perm = ctx.game.battlefield.find((x) => x.id === idList(a.target)[0]);
      return { ok: !!perm && typeIn(characteristics(ctx.game, perm, ctx.rules).typeLine, String(a.type)) };
    },
  });

  node({
    id: "castWith",
    title: "どう唱えられたか",
    summary: "対象のパーマネント(複数なら先頭)が、flag の形で唱えられて出たかを、ok として出力する。flag=alt(別のコスト。ワープなど) / kicked。as= で受けて、if=$名前。「ワープのコストで唱えられたなら」(Full Bore)は、castWith flag=alt",
    params: { target: { type: "ref", required: true }, flag: { type: "string", required: true, choices: ["alt", "kicked"] } },
    outputs: { ok: "boolean" },
    run: (ctx, a): Record<string, Value> => {
      const perm = ctx.game.battlefield.find((x) => x.id === idList(a.target)[0]);
      return { ok: !!perm?.cast?.[a.flag as "alt" | "kicked"] };
    },
  });

  // このターンに唱えた呪文の数 (型で絞れる)
  node({
    id: "spellsCast",
    title: "このターンに唱えた呪文の数",
    summary: "プレイヤー (player=you / opponents / target) が、このターンに唱えた呪文の数 (いま唱えたものも含む) を、n として出力する。type・notType で型を絞る(「クリーチャーでない呪文」は notType=creature)。target=プレイヤーの id (controllerOf の出力) と player=target で、そのプレイヤー。Magebane Lizard",
    params: { player: who, target: { type: "ref" }, type: { type: "string" }, notType: { type: "string" } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const ps = a.player === "target" ? idList(a.target) : playersOf(g, ctx.item.controller, String(a.player));
      const types = ps.flatMap((p) => g.castTypes?.[p] ?? []);
      return { n: types.filter((t) => (typeof a.type !== "string" || typeIn(t, a.type)) && (typeof a.notType !== "string" || !typeIn(t, a.notType))).length };
    },
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

  // 数の計算 (X を負にする、足す、引く、かける)
  node({
    id: "math",
    title: "数を計算する",
    summary: "a と b を、op (add = a+b / sub = a−b / mul = a×b) で計算して、n として出力する。as= で受けて、count=$名前・power=$名前 などに渡す。「−X/−X」は、math a=$X op=mul b=-1 → modify power=$名前 toughness=$名前",
    params: { a: { type: "number", required: true }, b: { type: "number", required: true }, op: { type: "string", required: true, choices: ["add", "sub", "mul"] } },
    outputs: { n: "number" },
    run: (_ctx, a): Record<string, Value> => ({ n: a.op === "add" ? Number(a.a) + Number(a.b) : a.op === "sub" ? Number(a.a) - Number(a.b) : Number(a.a) * Number(a.b) }),
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

// 枚数を数える (countCards と、常在型能力の staticModify perZone で共通)。who=you / opponents / all は、c (数える人) から見て。zone=battlefield は、パーマネントを数える
export function countCardsOf(g: Game, c: string, a: { zone?: unknown; who?: unknown; type?: unknown; notType?: unknown; color?: unknown; token?: unknown }): number {
  const who = a.who === "all" ? g.players : playersOf(g, c, a.who === "opponents" ? "opponents" : "you");
  const cards = who.flatMap((p) => (a.zone === "battlefield" ? g.battlefield.filter((x) => x.controller === p).map((x) => x.card) : ((a.zone === "hand" ? g.hands : a.zone === "graveyard" ? g.graveyards : a.zone === "exile" ? g.exile : g.libraries)[p] ?? [])));
  return cards.filter((x) => (typeof a.type !== "string" || typeIn(x.typeLine, a.type)) && (typeof a.notType !== "string" || !typeIn(x.typeLine, a.notType)) && (typeof a.color !== "string" || (x.colors ?? []).includes(a.color)) && (a.token !== true || !!x.token)).length;
}
