import { Value } from "./node";
import { defineNode, getNode } from "./registry";

// 実装済みの基本ノード。打ち消しは「対象」+「打ち消す」の組み合わせで、カードごとの違いは対象の条件 (引数) だけ

export function registerBuiltinNodes(): void {
  if (getNode("target")) return;

  // 対象を決める。唱えるときに選んだ対象 (ctx.item.targets[as]) が、いまも条件に合っていれば id を返す。合わなければ空
  defineNode({
    id: "target",
    title: "対象",
    summary: "スタックにある呪文を対象にする。type=型 / notType=その型でない / mv=マナ総量 で絞る",
    params: {
      zone: { type: "string", required: true, choices: ["stack"] },
      kind: { type: "string", required: true, choices: ["spell"] },
      type: { type: "string" },
      notType: { type: "string" },
      mv: { type: "number" },
    },
    outputs: { id: "id" },
    isTarget: true,
    run: (ctx, a): Record<string, Value> => {
      const hit = ctx.game.stack.find((s) => s.id === ctx.item.targets[ctx.call.as ?? ""]);
      if (!hit) return {};
      const line = hit.card.typeLine.toLowerCase();
      if (typeof a.type === "string" && !line.includes(a.type.toLowerCase())) return {};
      if (typeof a.notType === "string" && line.includes(a.notType.toLowerCase())) return {};
      if (typeof a.mv === "number" && hit.card.mv !== a.mv) return {};
      return { id: hit.id };
    },
  });

  // 打ち消す。対象の呪文をスタックから取り除き、持ち主の墓地へ置く
  defineNode({
    id: "counter",
    title: "打ち消す",
    summary: "対象の呪文を打ち消す (スタックから取り除いて、持ち主の墓地へ)",
    params: { target: { type: "ref", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const i =ctx.game.stack.findIndex((s) => s.id === a.target);
      if (i < 0) return {};
      const [gone] = ctx.game.stack.splice(i, 1);
      ctx.game.graveyards[gone.card.owner].push(gone.card);
      ctx.game.log.push(`${gone.card.name} を打ち消した`);
      return {};
    },
  });
}
