import { RunCtx, Value } from "./node";
import { defineCondition, defineNode, getNode } from "./registry";
import { Perm, keywordsOf, playersOf } from "./state";

// 実装済みの基本ノード。打ち消しは「対象」+「打ち消す」の組み合わせで、カードごとの違いは対象の条件 (引数) だけ

// 「キーワードを得る」で選べるキーワード能力 (増やすときはここへ)
const KEYWORDS = ["flying", "hexproof", "flash", "haste", "vigilance", "trample", "lifelink", "deathtouch", "firstStrike", "doubleStrike", "reach", "menace", "defender", "prowess", "indestructible"];

export function registerBuiltinNodes(): void {
  if (getNode("target")) return;

  // 条件: 呪文を唱えたときの記録 (キッカー・チームワークを使ったか)
  defineCondition({ id: "kicked", title: "キッカーされた", summary: "この呪文がキッカーされて唱えられた", test: (ctx) => !!ctx.item.cast.kicked });
  defineCondition({ id: "teamwork", title: "チームワークを用いた", summary: "この呪文がチームワークを用いて唱えられた", test: (ctx) => !!ctx.item.cast.teamwork });

  // 対象を決める。唱えるときに選んだ対象 (ctx.item.targets[as]) が、いまも条件に合っていれば id を返す。合わなければ空
  defineNode({
    id: "target",
    title: "対象",
    summary: "対象を決める。zone=stack + kind=spell(スタックの呪文) / zone=battlefield + kind=permanent(戦場のパーマネント) / zone=player + kind=player(プレイヤー。draw や discard の player=target と使う)。type=型 / notType=その型でない / mv=マナ総量 / controller=you(この呪文のコントローラーのもの)・opponents(それ以外) で絞る",
    params: {
      zone: { type: "string", required: true, choices: ["stack", "battlefield", "player"] },
      kind: { type: "string", required: true, choices: ["spell", "permanent", "player"] },
      type: { type: "string" },
      notType: { type: "string" },
      mv: { type: "number" },
      controller: { type: "string", choices: ["you", "opponents"] },
    },
    outputs: { id: "id" },
    isTarget: true,
    run: (ctx, a): Record<string, Value> => {
      const id = ctx.item.targets[ctx.call.as ?? ""];
      if (a.zone === "player" && a.kind === "player") return ctx.game.players.includes(id) ? { id } : {}; // プレイヤーは型・マナ総量で絞らない
      // zone と kind の組み合わせは stack+spell / battlefield+permanent だけ。それ以外は対象無し
      // (スタックの起動型能力は呪文ではないので、kind=spell には含めない)
      const hit = a.zone === "stack" && a.kind === "spell" ? ctx.game.stack.find((s) => s.id === id && !s.ability) : a.zone === "battlefield" && a.kind === "permanent" ? ctx.game.battlefield.find((p) => p.id === id) : undefined;
      if (!hit) return {};
      const line = hit.card.typeLine.toLowerCase();
      if (typeof a.type === "string" && !line.includes(a.type.toLowerCase())) return {};
      if (typeof a.notType === "string" && line.includes(a.notType.toLowerCase())) return {};
      if (typeof a.mv === "number" && hit.card.mv !== a.mv) return {};
      // 呪禁: 相手のコントロールする呪文や能力の対象にならない
      if (a.zone === "battlefield" && keywordsOf(hit as Perm).includes("hexproof") && hit.controller !== ctx.item.controller) return {};
      if (typeof a.controller === "string" && (a.controller === "you") !== (hit.controller === ctx.item.controller)) return {};
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
    params: { player: who, target: targetPlayer, count: { type: "number", required: true, min: 0 } },
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
    params: { player: who, target: targetPlayer, count: { type: "number", required: true, min: 0 } },
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

  // タップ / アンタップ。戦場のパーマネントの状態。対象が戦場に無ければ何もしない
  for (const [id, title, tapped] of [["tap", "タップする", true], ["untap", "アンタップする", false]] as const) {
    defineNode({
      id,
      title,
      summary: `対象のパーマネントを${title}`,
      params: { target: { type: "ref", required: true } },
      outputs: {},
      run: (ctx, a): Record<string, Value> => {
        const p = ctx.game.battlefield.find((x) => x.id === a.target);
        if (p) p.tapped = tapped;
        return {};
      },
    });
  }

  // 修整 (+X/+Y) とキーワードを得る。持続は「ターン終了時まで」か forever。対象が戦場に無ければ何もしない
  const duration = { type: "string" as const, required: true, choices: ["endOfTurn", "forever"] };
  defineNode({
    id: "modify",
    title: "修整を受ける",
    summary: "対象のクリーチャーが +power/+toughness の修整を受ける。duration=endOfTurn(ターン終了時まで) / forever",
    params: { target: { type: "ref", required: true }, power: { type: "number", required: true }, toughness: { type: "number", required: true }, duration },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const p = ctx.game.battlefield.find((x) => x.id === a.target);
      if (p) (p.mods ??= []).push({ power: Number(a.power), toughness: Number(a.toughness), until: a.duration as "endOfTurn" | "forever" });
      return {};
    },
  });
  defineNode({
    id: "grant",
    title: "キーワードを得る",
    summary: "対象のクリーチャーがキーワード能力を得る。duration=endOfTurn(ターン終了時まで) / forever",
    params: { target: { type: "ref", required: true }, keyword: { type: "string", required: true, choices: KEYWORDS }, duration },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const p = ctx.game.battlefield.find((x) => x.id === a.target);
      if (p) (p.mods ??= []).push({ power: 0, toughness: 0, keyword: String(a.keyword), until: a.duration as "endOfTurn" | "forever" });
      return {};
    },
  });

  // コスト。起動型能力の最初に書く (cost) と、呪文を唱えるときに払ってもよい追加コスト (additionalCost: キッカー・チームワーク)。
  // 払う処理は、能力を起動する・呪文を唱えるエンジン側が行う (ここは宣言)。マナの色はまだ区別しない
  defineNode({
    id: "cost",
    title: "コスト",
    summary: "起動型能力のコスト(能力の最初に書く)。mana=払うマナの数 / tap=このパーマネントをタップ / sacrifice=このパーマネントを生け贄に捧げる / tapCreatures=パワーの合計がこの値以上になるよう、自分のクリーチャーをタップ",
    params: { mana: { type: "number", min: 0 }, tap: { type: "boolean" }, sacrifice: { type: "boolean" }, tapCreatures: { type: "number", min: 0 } },
    outputs: {},
    declaration: true,
    only: ["activated"],
    run: (): Record<string, Value> => ({}),
  });
  defineNode({
    id: "additionalCost",
    title: "追加コスト(任意)",
    summary: "呪文を唱えるときに払ってもよい追加コスト(キッカー・チームワーク)。flag=kicked / teamwork。払って唱えると、if=<flag> のノードが実行される。mana=マナ / tapCreatures=パワーの合計がこの値以上になるよう、自分のクリーチャーをタップ",
    params: { flag: { type: "string", required: true, choices: ["kicked", "teamwork"] }, mana: { type: "number", min: 0 }, tapCreatures: { type: "number", min: 0 } },
    outputs: {},
    declaration: true,
    only: ["spell"],
    run: (): Record<string, Value> => ({}),
  });
  // マナを加える。マナだけの起動型能力は、スタックを使わずに即座に解決する
  defineNode({
    id: "addMana",
    title: "マナを加える",
    summary: "コントローラーがマナを amount 点加える(色はまだ区別しない)",
    params: { amount: { type: "number", required: true, min: 0 } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const p = ctx.item.controller;
      ctx.game.mana[p] = (ctx.game.mana[p] ?? 0) + Number(a.amount);
      return {};
    },
  });

  // 打ち消す。対象の呪文をスタックから取り除き、持ち主の墓地へ置く
  defineNode({
    id: "counter",
    title: "打ち消す",
    summary: "対象の呪文を打ち消す (スタックから取り除いて、持ち主の墓地へ)。unlessPay=N を付けると「そのコントローラーが N を支払わないかぎり」",
    params: { target: { type: "ref", required: true }, unlessPay: { type: "number", min: 0 } },
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
