import { NodeDef, Value } from "../node";
import { defineNode as define } from "../registry";
import { dealDamage } from "../damage";
import { spendGeneric } from "../mana";
import { idList, playersFor, targetPlayer, who } from "./shared";

// ノード: ダメージ・ライフ・マナ・打ち消し
const CATEGORY = "ダメージ・ライフ・マナ・打ち消し";
const node = (def: Omit<NodeDef, "category">) => define({ ...def, category: CATEGORY });

export function registerCombat(): void {
  // ライフ。amount は 0 以上 (数の引数なので、countCards の出力なども渡せる)
  for (const [id, title, sign] of [["gainLife", "ライフを得る", 1], ["loseLife", "ライフを失う", -1]] as const) {
    node({
      id,
      title,
      summary: `プレイヤーが amount 点のライフを${sign > 0 ? "得る" : "失う"}。player=you / opponents / target(draw と同じ)`,
      params: { player: who, target: targetPlayer, amount: { type: "number", required: true, min: 0 } },
      outputs: {},
      run: (ctx, a): Record<string, Value> => {
        for (const p of playersFor(ctx, a)) ctx.game.life[p] += sign * Number(a.amount);
        return {};
      },
    });
  }

  // ダメージ。プレイヤー → ライフを失う / クリーチャー → ダメージが載る (タフネス以上で死ぬ。ターン終了時に消える) / プレインズウォーカー → 忠誠度カウンターを取り除く
  node({
    id: "damage",
    title: "ダメージを与える",
    summary: "対象 (target ノードの出力。zone=any なら、プレイヤー・クリーチャー・プレインズウォーカー) に amount 点のダメージを与える",
    params: { target: { type: "ref", required: true }, amount: { type: "number", required: true, min: 0 } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const source = ctx.item.ability ? g.battlefield.find((x) => x.id === ctx.item.source) : undefined; // 能力の発生源 (接死・絆魂が効く)。呪文なら、キーワードは無し
      for (const id of idList(a.target)) dealDamage(g, ctx.rules, source, id, Number(a.amount));
      return {};
    },
  });

  // マナを加える。マナだけの起動型能力は、スタックを使わずに即座に解決する
  node({
    id: "addMana",
    title: "マナを加える",
    summary:
      "コントローラーがマナを amount 点加える。color=W・U・B・R・G(その色) / C(無色。既定) / any(好きな色。どの色のコストにも使える)。spellType / spellNotType を添えると、そのマナは、その型の呪文(spellNotType ならその型でない呪文)を唱えるためにしか使えない(「クリーチャーでない呪文を唱えるためにしか使えない」は spellNotType=creature)",
    params: { amount: { type: "number", required: true, min: 0 }, color: { type: "string", choices: ["W", "U", "B", "R", "G", "C", "any"] }, spellType: { type: "string" }, spellNotType: { type: "string" } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const p = ctx.item.controller;
      const n = Number(a.amount);
      const key = a.color === "any" ? "A" : a.color === undefined || a.color === "C" ? undefined : (String(a.color) as "W" | "U" | "B" | "R" | "G"); // undefined = 無色
      if (typeof a.spellType === "string" || typeof a.spellNotType === "string") {
        g.restrictedMana[p] ??= [];
        g.restrictedMana[p].push({ amount: n, ...(key ? { color: key } : {}), ...(typeof a.spellType === "string" ? { type: a.spellType } : {}), ...(typeof a.spellNotType === "string" ? { notType: a.spellNotType } : {}) });
        return {};
      }
      g.mana[p] = (g.mana[p] ?? 0) + n;
      if (key) {
        g.pool[p] ??= {};
        g.pool[p][key] = (g.pool[p][key] ?? 0) + n;
      }
      return {};
    },
  });

  // 打ち消す。対象の呪文をスタックから取り除き、持ち主の墓地へ置く
  node({
    id: "counter",
    title: "打ち消す",
    summary: "対象の呪文を打ち消す (スタックから取り除いて、持ち主の墓地へ)。unlessPay=N を付けると「そのコントローラーが N を支払わないかぎり」",
    params: { target: { type: "ref", required: true }, unlessPay: { type: "number", min: 0 } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      for (const id of idList(a.target)) {
        const i = g.stack.findIndex((s) => s.id === id);
        if (i < 0) continue;
        if (typeof a.unlessPay === "number") {
          // 払うのは汎用の N 点 (色つきのマナでも払える)。払うかどうかは g.decide.pay (既定は払えるなら払う)。判断の入力を作るときに置き換える
          const p = g.stack[i].controller;
          if (spendGeneric(g, p, a.unlessPay, false) && (g.decide?.pay?.(g, p, a.unlessPay) ?? true)) {
            spendGeneric(g, p, a.unlessPay);
            g.log.push(`${p} が ${a.unlessPay} を支払い、${g.stack[i].card.name} は打ち消されなかった`);
            continue;
          }
        }
        const [gone] = g.stack.splice(i, 1);
        if (!gone.copy && !gone.ability) g.graveyards[gone.card.owner].push(gone.card); // 呪文のコピーと能力は、墓地に行かず消える
        g.log.push(`${gone.card.name} を打ち消した`);
      }
      return {};
    },
  });
}
