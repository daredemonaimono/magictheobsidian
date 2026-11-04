import { RunCtx, Value } from "./node";
import { defineNode, getNode } from "./registry";
import { playersOf } from "./state";

// 実装済みの基本ノード。打ち消しは「対象」+「打ち消す」の組み合わせで、カードごとの違いは対象の条件 (引数) だけ

export function registerBuiltinNodes(): void {
  if (getNode("target")) return;

  // 対象を決める。唱えるときに選んだ対象 (ctx.item.targets[as]) が、いまも条件に合っていれば id を返す。合わなければ空
  defineNode({
    id: "target",
    title: "対象",
    summary: "対象を決める。zone=stack + kind=spell(スタックの呪文) / zone=battlefield + kind=permanent(戦場のパーマネント) / zone=player + kind=player(プレイヤー。draw や discard の player=target と使う)。type=型 / notType=その型でない / mv=マナ総量 で絞る",
    params: {
      zone: { type: "string", required: true, choices: ["stack", "battlefield", "player"] },
      kind: { type: "string", required: true, choices: ["spell", "permanent", "player"] },
      type: { type: "string" },
      notType: { type: "string" },
      mv: { type: "number" },
    },
    outputs: { id: "id" },
    isTarget: true,
    run: (ctx, a): Record<string, Value> => {
      const id = ctx.item.targets[ctx.call.as ?? ""];
      if (a.zone === "player" && a.kind === "player") return ctx.game.players.includes(id) ? { id } : {}; // プレイヤーは型・マナ総量で絞らない
      // zone と kind の組み合わせは stack+spell / battlefield+permanent だけ。それ以外は対象無し
      const hit = a.zone === "stack" && a.kind === "spell" ? ctx.game.stack.find((s) => s.id === id) : a.zone === "battlefield" && a.kind === "permanent" ? ctx.game.battlefield.find((p) => p.id === id) : undefined;
      if (!hit) return {};
      const line = hit.card.typeLine.toLowerCase();
      if (typeof a.type === "string" && !line.includes(a.type.toLowerCase())) return {};
      if (typeof a.notType === "string" && line.includes(a.notType.toLowerCase())) return {};
      if (typeof a.mv === "number" && hit.card.mv !== a.mv) return {};
      return { id: hit.id };
    },
  });

  const who = { type: "string" as const, required: true, choices: ["you", "opponents", "target"] };
  const targetPlayer = { type: "ref" as const }; // player=target のとき、target ノード (zone=player) の出力を渡す

  // player 引数を、実際のプレイヤーに直す。target で対象が無ければ、記録を残して空
  const playersFor = (ctx: RunCtx, a: Record<string, Value>): string[] => {
    if (a.player !== "target") return playersOf(ctx.game, ctx.item.controller, String(a.player));
    if (typeof a.target === "string" && ctx.game.players.includes(a.target)) return [a.target];
    ctx.game.log.push("対象のプレイヤーが無い");
    return [];
  };

  // 引く。ライブラリーが足りなければ、引ける分だけ引いて記録を残す
  defineNode({
    id: "draw",
    title: "引く",
    summary: "プレイヤーがカードを count 枚引く。player=you(呪文のコントローラー) / opponents(全相手) / target(target ノードで選んだプレイヤー。target=$名前 を渡す)",
    params: { player: who, target: targetPlayer, count: { type: "number", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      for (const p of playersFor(ctx, a)) {
        for (let i = 0; i < Number(a.count); i++) {
          const top = g.libraries[p].shift();
          if (!top) {
            g.log.push(`${p}: ライブラリーが空で引けなかった`);
            break;
          }
          g.hands[p].push(top);
        }
      }
      return {};
    },
  });

  // 捨てる。捨てるカードは g.decide.discard で選べる。既定は手札の後ろから (shortcut: 本来は持ち主が選ぶ。判断の入力を作るときに置き換える)
  defineNode({
    id: "discard",
    title: "捨てる",
    summary: "プレイヤーが手札を count 枚捨てる。player=you / opponents / target(draw と同じ)",
    params: { player: who, target: targetPlayer, count: { type: "number", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      for (const p of playersFor(ctx, a)) {
        const n = Math.min(Number(a.count), g.hands[p].length);
        const picked = (g.decide?.discard?.(g, p, n) ?? g.hands[p].slice(g.hands[p].length - n)).filter((c) => g.hands[p].includes(c)).slice(0, n);
        g.hands[p] = g.hands[p].filter((c) => !picked.includes(c));
        g.graveyards[p].push(...picked);
      }
      return {};
    },
  });

  // 手札に戻す。戦場のパーマネントを、持ち主の手札へ。対象が戦場に無ければ何もしない
  defineNode({
    id: "bounce",
    title: "手札に戻す",
    summary: "対象のパーマネントを持ち主の手札に戻す",
    params: { target: { type: "ref", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const i = ctx.game.battlefield.findIndex((p) => p.id === a.target);
      if (i < 0) return {};
      const [gone] = ctx.game.battlefield.splice(i, 1);
      ctx.game.hands[gone.card.owner].push(gone.card);
      ctx.game.log.push(`${gone.card.name} を手札に戻した`);
      return {};
    },
  });

  // 打ち消す。対象の呪文をスタックから取り除き、持ち主の墓地へ置く
  defineNode({
    id: "counter",
    title: "打ち消す",
    summary: "対象の呪文を打ち消す (スタックから取り除いて、持ち主の墓地へ)。unlessPay=N を付けると「そのコントローラーが N を支払わないかぎり」",
    params: { target: { type: "ref", required: true }, unlessPay: { type: "number" } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const i =ctx.game.stack.findIndex((s) => s.id === a.target);
      if (i < 0) return {};
      const g = ctx.game;
      if (typeof a.unlessPay === "number") {
        // shortcut: マナの色は区別しない。払うかどうかは g.decide.pay (既定は払えるなら払う)。判断の入力を作るときに置き換える
        const p = g.stack[i].controller;
        if (g.mana[p] >= a.unlessPay && (g.decide?.pay?.(g, p, a.unlessPay) ?? true)) {
          g.mana[p] -= a.unlessPay;
          g.log.push(`${p} が ${a.unlessPay} を支払い、${g.stack[i].card.name} は打ち消されなかった`);
          return {};
        }
      }
      const [gone] = ctx.game.stack.splice(i, 1);
      ctx.game.graveyards[gone.card.owner].push(gone.card);
      ctx.game.log.push(`${gone.card.name} を打ち消した`);
      return {};
    },
  });
}
