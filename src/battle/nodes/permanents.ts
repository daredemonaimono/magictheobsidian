import { NodeDef, Value } from "../node";
import { defineNode as define } from "../registry";
import { parseManaCost } from "../mana";
import { prepareAbilityOf, GameCard, Perm, untapPerm } from "../state";
import { KEYWORDS, cont, idList } from "./shared";

// ノード: パーマネント・トークン・カウンター
const CATEGORY = "パーマネント・トークン・カウンター";
const node = (def: Omit<NodeDef, "category">) => define({ ...def, category: CATEGORY });

export function registerPermanents(): void {
  // タップ / アンタップ。戦場のパーマネントの状態。対象が戦場に無ければ何もしない
  for (const [id, title, tapped] of [["tap", "タップする", true], ["untap", "アンタップする", false]] as const) {
    node({
      id,
      title,
      summary: `対象(複数も可)のパーマネントを${title}`,
      params: { target: { type: "ref", required: true } },
      outputs: {},
      run: (ctx, a): Record<string, Value> => {
        for (const x of idList(a.target)) {
          const p = ctx.game.battlefield.find((y) => y.id === x);
          if (!p) continue;
          if (tapped) p.tapped = true;
          else untapPerm(ctx.game, p); // 麻痺カウンターがあれば、アンタップのかわりに取り除く
        }
        return {};
      },
    });
  }

  // 修整 (+X/+Y) とキーワードを得る。持続は「ターン終了時まで」か forever。対象が戦場に無ければ何もしない
  const duration = { type: "string" as const, required: true, choices: ["endOfTurn", "forever"] };

  node({
    id: "modify",
    title: "修整を受ける",
    summary: "対象のクリーチャーが +power/+toughness の修整を受ける。duration=endOfTurn(ターン終了時まで) / forever",
    params: { target: { type: "ref", required: true }, power: { type: "number", required: true }, toughness: { type: "number", required: true }, duration },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      for (const x of idList(a.target)) {
        const p = ctx.game.battlefield.find((y) => y.id === x);
        if (p) (p.mods ??= []).push({ power: Number(a.power), toughness: Number(a.toughness), until: a.duration as "endOfTurn" | "forever" });
      }
      return {};
    },
  });

  node({
    id: "grant",
    title: "キーワードを得る",
    summary: "対象のクリーチャーがキーワード能力を得る。duration=endOfTurn(ターン終了時まで) / forever",
    params: { target: { type: "ref", required: true }, keyword: { type: "string", required: true, choices: KEYWORDS }, duration },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      for (const x of idList(a.target)) {
        const p = ctx.game.battlefield.find((y) => y.id === x);
        if (p) (p.mods ??= []).push({ power: 0, toughness: 0, keyword: String(a.keyword), until: a.duration as "endOfTurn" | "forever" });
      }
      return {};
    },
  });

  // 準備 (prepared)。準備呪文 (kind=prepare の能力) を持つクリーチャーだけが、準備済になれる。準備済のあいだ、コントローラーは、その準備呪文のコピーを (追放領域から) 唱えられる (castPrepared)。
  const manaCostCheck = (a: Record<string, Value>): string | null => {
    try {
      if (typeof a.manaCost === "string") parseManaCost(a.manaCost);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  node({
    id: "prepareSpell",
    title: "準備呪文",
    summary: "準備呪文 (準備済のクリーチャーの、裏面の呪文) の最初に書く宣言。name=呪文の名前 / type=Instant か Sorcery / manaCost=マナコスト(\"{U}\")。そのあとに、呪文の効果のノードを書く",
    params: { name: { type: "string", required: true }, type: { type: "string", required: true, choices: ["Instant", "Sorcery"] }, manaCost: { type: "string" } },
    check: manaCostCheck,
    declaration: true,
    only: ["prepare"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "entersPrepared",
    title: "準備済で戦場に出る",
    summary: "「このクリーチャーは準備済状態で戦場に出る」。常在型能力に書く(affect は要らない)。準備呪文を持たないクリーチャーは、準備済にならない",
    params: {},
    ...cont,
  });

  node({
    id: "prepare",
    title: "準備済になる",
    summary: "このパーマネント自身が、準備済になる(「このクリーチャーは準備済状態になる」)。すでに準備済なら何も起きない(2つ目のコピーはできない)。準備呪文を持たないものは、なれない",
    params: {},
    only: ["spell", "activated", "triggered"], // 常在型能力に書いても働かない
    outputs: {},
    run: (ctx): Record<string, Value> => {
      const p = ctx.item.source ? ctx.game.battlefield.find((x) => x.id === ctx.item.source) : undefined;
      if (p && !p.prepared && prepareAbilityOf(ctx.rules, p.card.name)) {
        p.prepared = true;
        ctx.game.log.push(`${p.card.name} は準備済になった`);
      }
      return {};
    },
  });

  // 付ける。この能力の発生源 (装備品・オーラ) を、対象のパーマネントに付ける
  node({
    id: "attach",
    title: "付ける",
    summary: "この能力の発生源(装備品・オーラ)を、対象のパーマネントに付ける。オーラは、戦場に出てから付く",
    params: { target: { type: "ref", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const src = ctx.game.battlefield.find((p) => p.id === ctx.item.source);
      const to = ctx.game.battlefield.find((p) => p.id === idList(a.target)[0]);
      if (src && to) {
        src.attachedTo = to.id;
        ctx.game.log.push(`${src.card.name} を ${to.card.name} に付けた`);
      }
      return {};
    },
  });

  // 紋章: createEmblem で得る。紋章の能力は、同じカードのルールの中の、emblem name=… で始まる誘発型能力として書く
  node({
    id: "emblem",
    title: "紋章の能力",
    summary: "紋章の誘発型能力の最初に書く(そのあとに when)。name は、createEmblem の name と同じ。プレインズウォーカーなどのカードのルールの中に、紋章の能力を書く",
    params: { name: { type: "string", required: true } },
    outputs: {},
    declaration: true,
    only: ["triggered"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "createEmblem",
    title: "紋章を得る",
    summary: "コントローラーが紋章を得る。紋章は戦場の外に残り続け、元のカードのルールの、emblem name=<同じ name> で始まる誘発型能力が働く",
    params: { name: { type: "string", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      g.serial++;
      g.emblems.push({ id: `emblem#${g.serial}`, card: ctx.item.card, controller: ctx.item.controller, emblem: String(a.name) });
      g.log.push(`${ctx.item.controller} は紋章 ${a.name} を得た`);
      return {};
    },
  });

  // トークンを作る。戦場に出る(enters のイベントも出る)。戦場を離れると消える
  node({
    id: "createToken",
    title: "トークンを作る",
    summary: "コントローラーが、トークンのクリーチャーなどを count 個(既定は1)作る。name=名前 / types=型行(例: \"Creature — Illusion\") / power・toughness / colors=色(空白区切り。例: \"U\")",
    params: { name: { type: "string", required: true }, types: { type: "string", required: true }, power: { type: "number" }, toughness: { type: "number" }, colors: { type: "string" }, count: { type: "number", min: 1 } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const p = ctx.item.controller;
      for (let i = 0; i < (typeof a.count === "number" ? a.count : 1); i++) {
        g.serial++;
        const card: GameCard = {
          id: `token#${g.serial}`,
          name: String(a.name),
          typeLine: String(a.types),
          mv: 0,
          owner: p,
          token: true,
          ...(typeof a.power === "number" ? { power: a.power } : {}),
          ...(typeof a.toughness === "number" ? { toughness: a.toughness } : {}),
          ...(typeof a.colors === "string" ? { colors: a.colors.split(/[\s,]+/).filter(Boolean) } : {}),
        };
        const perm: Perm = { id: card.id, card, controller: p, enteredTurn: g.turn };
        g.battlefield.push(perm);
        g.events.push({ type: "enters", perm });
      }
      return {};
    },
  });

  // カウンターを置く。対象が戦場に無ければ何もしない
  node({
    id: "addCounter",
    title: "カウンターを置く",
    summary: "対象のパーマネントの上にカウンターを count 個置く。kind=+1/+1(パワー・タフネスに足される) / stun(麻痺。アンタップするかわりに1つ取り除く)",
    params: { target: { type: "ref", required: true }, kind: { type: "string", required: true, choices: ["+1/+1", "stun"] }, count: { type: "number", required: true, min: 0 } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      for (const x of idList(a.target)) {
        const p = ctx.game.battlefield.find((y) => y.id === x);
        if (p) {
          p.counters ??= {};
          p.counters[String(a.kind)] = (p.counters[String(a.kind)] ?? 0) + Number(a.count);
        }
      }
      return {};
    },
  });
}
