import { NodeDef, Value } from "../node";
import { defineNode as define } from "../registry";
import { spellBody, who as logWho } from "../engine/shared";
import { dealDamage } from "../damage";
import { spendGeneric } from "../mana";
import { lifeGainBlocked } from "../engine/restrict";
import { gainLife, loseLife, playersOf } from "../state";
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
        for (const p of playersFor(ctx, a)) {
          if (sign > 0 && lifeGainBlocked(ctx.game, ctx.rules, p)) {
            ctx.game.log.push(`${logWho(p)}は、ライフを得られない`);
            continue;
          }
          if (sign > 0) gainLife(ctx.game, p, Number(a.amount));
          else loseLife(ctx.game, p, Number(a.amount));
          if (Number(a.amount) > 0) ctx.game.log.push(`${logWho(p)}が ${a.amount} 点のライフを${sign > 0 ? "得た" : "失った"}`);
        }
        return {};
      },
    });
  }

  // ダメージ。プレイヤー → ライフを失う / クリーチャー → ダメージが載る (タフネス以上で死ぬ。ターン終了時に消える) / プレインズウォーカー → 忠誠度カウンターを取り除く
  // このターンに得たライフの量
  node({
    id: "lifeGained",
    title: "このターンに得たライフ",
    summary: "プレイヤー (player=you / opponents) が、このターンに得たライフの量 (合計) を、n として出力する。「3 点以上ライフを得ていたら」(Silversmote Ghoul)は、これを as= で受けて、compare op=ge と if=$名前",
    params: { player: { type: "string", required: true, choices: ["you", "opponents"] } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => ({ n: playersOf(ctx.game, ctx.item.controller, String(a.player)).reduce((s, p) => s + (ctx.game.gained?.[p] ?? 0), 0) }),
  });

  // このターンに失ったライフの量
  node({
    id: "lifeLost",
    title: "このターンに失ったライフ",
    summary: "プレイヤー (player=you / opponents) が、このターンに失ったライフの量 (合計。ダメージ・ライフの支払いも含む) を、n として出力する。「相手がこのターンにライフを失っていたら」は、これを as= で受けて、compare op=ge b=1 と if=$名前",
    params: { player: { type: "string", required: true, choices: ["you", "opponents"] } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => ({ n: playersOf(ctx.game, ctx.item.controller, String(a.player)).reduce((s, p) => s + (ctx.game.lostLife?.[p] ?? 0), 0) }),
  });

  node({
    id: "damage",
    title: "ダメージを与える",
    summary: "対象 (target ノードの出力。zone=any なら、プレイヤー・クリーチャー・プレインズウォーカー) に amount 点のダメージを与える。対象を取らないときは、player=you / opponents (「各対戦相手に」) を、target のかわりに書く",
    params: { target: { type: "ref" }, player: { type: "string", choices: ["you", "opponents"] }, amount: { type: "number", required: true, min: 0 } },
    outputs: {},
    check: (a) => (a.target !== undefined || a.player !== undefined ? null : "target か player が要る"),
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const source = ctx.item.ability ? g.battlefield.find((x) => x.id === ctx.item.source) : undefined; // 能力の発生源 (接死・絆魂が効く)。呪文なら、キーワードは無し
      const ids = a.player !== undefined ? playersOf(g, ctx.item.controller, String(a.player)) : idList(a.target);
      for (const id of ids) dealDamage(g, ctx.rules, source, id, Number(a.amount));
      return {};
    },
  });

  // マナを加える。マナだけの起動型能力は、スタックを使わずに即座に解決する
  node({
    id: "addMana",
    title: "マナを加える",
    summary:
      "コントローラーがマナを amount 点加える。colors=GWU(その中の好きな1色。「{G}、{W}、{U} のいずれか」)。color=W・U・B・R・G(その色) / C(無色。既定) / any(好きな色。どの色のコストにも使える)。spellType / spellNotType を添えると、そのマナは、その型の呪文(spellNotType ならその型でない呪文)を唱えるためにしか使えない(「クリーチャーでない呪文を唱えるためにしか使えない」は spellNotType=creature)",
    params: { amount: { type: "number", required: true, min: 0 }, color: { type: "string", choices: ["W", "U", "B", "R", "G", "C", "any"] }, colors: { type: "string" }, spellType: { type: "string" }, spellNotType: { type: "string" } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const p = ctx.item.controller;
      const n = Number(a.amount);
      const set = typeof a.colors === "string" ? [...new Set(a.colors.toUpperCase().split("").filter((c) => "WUBRG".includes(c)))].join("") : "";
      const key = set ? (`A:${set}` as const) : a.color === "any" ? "A" : a.color === undefined || a.color === "C" ? undefined : (String(a.color) as "W" | "U" | "B" | "R" | "G"); // undefined = 無色
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

  // 追加のターン (Time Walk)
  node({
    id: "extraTurn",
    title: "追加のターン",
    summary: "コントローラーが、このターンの次に、追加のターンを count 回(既定は1)得る(Time Walk)",
    params: { count: { type: "number", min: 1 } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      for (let i = 0; i < (typeof a.count === "number" ? a.count : 1); i++) (g.extraTurns ??= []).push(ctx.item.controller);
      g.log.push("追加のターンを得た");
      return {};
    },
  });

  // 呪文をコピーする (Storm・Fork)。コピーは、スタックの一番上に積まれ、元と同じ対象で、解決しても墓地に行かず消える
  node({
    id: "copySpell",
    title: "呪文をコピーする",
    summary: "スタックの呪文(target ノードの出力。zone=stack)を count 回(既定は1)コピーする。コピーは、能力のコントローラーのもので、元と同じ対象を持ち、解決しても墓地に行かず消える。shortcut: 対象は選び直せない",
    params: { target: { type: "ref" }, spell: { type: "string" }, count: { type: "number", min: 0 } },
    check: (a) => (a.target !== undefined || a.spell !== undefined ? null : "target (対象の呪文) が要る"),
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const ids = a.target !== undefined ? idList(a.target) : [String(a.spell)];
      for (const id of ids) {
        const orig = g.stack.find((s) => s.id === id && !s.ability);
        if (!orig) continue;
        const n = a.count === undefined ? 1 : Number(a.count);
        for (let k = 0; k < n; k++) {
          g.serial++;
          g.stack.push({ id: `${orig.id}~${g.serial}`, card: orig.card, controller: ctx.item.controller, targets: { ...orig.targets }, cast: { ...orig.cast }, body: orig.body ?? spellBody(ctx.rules, orig.card) ?? [], copy: true, ...(orig.x !== undefined ? { x: orig.x } : {}) });
        }
        if (n > 0) g.log.push(`${orig.card.name} を ${n} 回コピーした`);
      }
      return {};
    },
  });

  // 打ち消す。対象の呪文をスタックから取り除き、持ち主の墓地へ置く
  node({
    id: "counter",
    title: "打ち消す",
    summary: "対象の呪文を打ち消す (スタックから取り除いて、持ち主の墓地へ)。unlessPay=N を付けると「そのコントローラーが N を支払わないかぎり」。exile=true で「墓地に置くかわりに追放する」",
    params: { target: { type: "ref", required: true }, unlessPay: { type: "number", min: 0 }, exile: { type: "boolean" } },
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
        if (!gone.copy && !gone.ability) (a.exile === true ? g.exile : g.graveyards)[gone.card.owner].push(gone.card); // 呪文のコピーと能力は、墓地に行かず消える
        g.log.push(`${gone.card.name} を打ち消した`);
      }
      return {};
    },
  });
}
