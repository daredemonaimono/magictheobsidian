import { NodeDef, Value } from "../node";
import { defineCondition, defineNode as define } from "../registry";
import { parseManaCost } from "../mana";
import { KEYWORDS, cont, who } from "./shared";

// ノード: 宣言・コスト・条件
const CATEGORY = "宣言・コスト・条件";
const node = (def: Omit<NodeDef, "category">) => define({ ...def, category: CATEGORY });

export function registerDeclarations(): void {
  // 条件: 呪文を唱えたときの記録 (キッカー・チームワーク・選んだモード)
  defineCondition({ id: "kicked", title: "キッカーされた", summary: "この呪文がキッカーされて唱えられた", test: (ctx) => !!ctx.item.cast.kicked });

  defineCondition({ id: "alt", title: "別のコストで唱えられた", summary: "この呪文 (出てきたパーマネントの誘発では、そのパーマネント) が、altCost の別のコストで唱えられた (召喚者・Force of Will など)", test: (ctx) => !!ctx.item.cast.alt });

  defineCondition({ id: "teamwork", title: "チームワークを用いた", summary: "この呪文がチームワークを用いて唱えられた", test: (ctx) => !!ctx.item.cast.teamwork });

  for (let i = 1; i <= 5; i++) defineCondition({ id: `mode${i}`, title: `モード${i}が選ばれた`, summary: `この呪文のモード${i}が選ばれて唱えられた (modes の宣言と使う)`, test: (ctx) => !!ctx.item.cast.modes?.includes(i) });

  // 宣言のノード (エンジンが読む): コスト、追加コスト、モード。払う・選ぶ処理は、能力を起動する・呪文を唱えるエンジン側が行う。マナの色はまだ区別しない
  node({
    id: "cost",
    core: true,
    title: "コスト",
    summary: "起動型能力のコスト(能力の最初に書く)。mana=払う汎用マナの数 / manaCost=色つきのマナコスト(\"{1}{U}\") / tap=このパーマネントをタップ / sacrifice=このパーマネントを生け贄に捧げる / life=N点のライフを払う (フェッチランド) / tapCreatures=パワーの合計がこの値以上になるよう、自分のクリーチャーをタップ / loyalty=忠誠度を足す(+1 は loyalty=1、−2 は loyalty=-2。プレインズウォーカーの能力。ソーサリーのタイミングで1ターンに1回) / loyaltyX=true で −X(X は起動時に選び、効果の中で $X として参照する)",
    params: { mana: { type: "number", min: 0 }, manaCost: { type: "string" }, tap: { type: "boolean" }, sacrifice: { type: "boolean" }, life: { type: "number", min: 0 }, tapCreatures: { type: "number", min: 0 }, loyalty: { type: "number" }, loyaltyX: { type: "boolean" } },
    check: (a) => { try { if (typeof a.manaCost === "string") parseManaCost(a.manaCost); return null; } catch (e) { return (e as Error).message; } },
    outputs: {},
    declaration: true,
    only: ["activated"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "additionalCost",
    core: true,
    title: "追加コスト(任意)",
    summary: "呪文を唱えるときに払ってもよい追加コスト(キッカー・チームワーク)。flag=kicked / teamwork。払って唱えると、if=<flag> のノードが実行される。mana=汎用のマナ / manaCost=色つきのマナコスト(\"{1}{U}\") / tapCreatures=パワーの合計がこの値以上になるよう、自分のクリーチャーをタップ",
    params: { flag: { type: "string", required: true, choices: ["kicked", "teamwork"] }, mana: { type: "number", min: 0 }, manaCost: { type: "string" }, tapCreatures: { type: "number", min: 0 } },
    check: (a) => { try { if (typeof a.manaCost === "string") parseManaCost(a.manaCost); return null; } catch (e) { return (e as Error).message; } },
    outputs: {},
    declaration: true,
    only: ["spell"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "altCost",
    core: true,
    title: "別のコスト",
    summary: "呪文を唱えるとき、マナコストのかわりに払ってもよい別のコスト(Force of Will・召喚者)。払って唱えると、if=alt のノードが実行される。mana=汎用のマナ / manaCost=色つきのマナコスト / life=払うライフ / exile=手札から追放するカードの枚数(exileColor=W・U・B・R・G でその色のカード。唱える呪文自身は数えない) / notYourTurn=true で、自分のターンでないときだけ",
    params: { mana: { type: "number", min: 0 }, manaCost: { type: "string" }, life: { type: "number", min: 0 }, exile: { type: "number", min: 1 }, exileColor: { type: "string", choices: ["W", "U", "B", "R", "G"] }, notYourTurn: { type: "boolean" } },
    check: (a) => { try { if (typeof a.manaCost === "string") parseManaCost(a.manaCost); } catch (e) { return (e as Error).message; } return a.exileColor !== undefined && a.exile === undefined ? "exileColor には exile (枚数) が要る" : null; },
    outputs: {},
    declaration: true,
    only: ["spell"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "delve",
    core: true,
    title: "Delve",
    summary: "Delve の宣言(呪文能力の最初に書く。引数なし)。唱えるとき、墓地のカードを何枚か追放して、その1枚につき汎用マナ {1} を払ったことにできる(Treasure Cruise・Dig Through Time)",
    params: {},
    outputs: {},
    declaration: true,
    only: ["spell"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "storm",
    core: true,
    title: "Storm",
    summary: "Storm の宣言(呪文能力の最初に書く。引数なし)。この呪文を唱えたとき、このターンにそれより前に唱えられた呪文(だれのものでも)の数だけ、この呪文をコピーする。コピーの対象は、元と同じ(Flusterstorm)",
    params: {},
    outputs: {},
    declaration: true,
    only: ["spell"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "modes",
    core: true,
    title: "モード",
    summary: "「以下から選ぶ」の宣言(呪文能力の最初に書く)。count=モードの数(最大5) / min・max=選ぶ数(「1つ」は min=1 max=1、「1つまたは両方」は min=1 max=2)。各モードのノードに if=mode1, if=mode2 … を付ける",
    params: { count: { type: "number", required: true, min: 1, max: 5 }, min: { type: "number", required: true, min: 1 }, max: { type: "number", required: true, min: 1 } },
    outputs: {},
    declaration: true,
    only: ["spell"],
    run: (): Record<string, Value> => ({}),
  });

  // 宣言のノード (誘発型・常在型): 誘発のきっかけ (when)、キーワード (keyword)。エンジンが読む
  node({
    id: "when",
    core: true,
    title: "どうなったら",
    summary:
      "誘発型能力の最初に書く、誘発のきっかけ。event=cast(呪文を唱えた) / enters(戦場に出た) / leaves(戦場を離れた) / attacks(攻撃した。「攻撃するたび」) / blocks(ブロックした) / step(ステップの開始時。step=upkeep・draw・main1・combat・main2・end を添える)。絞り込み: who=you・opponents(唱えた/コントロールするプレイヤー。attacks / blocks では、そのクリーチャーのコントローラー。step ではそのターンのプレイヤー) / type・notType(その呪文・パーマネントの型) / turn=yours・opponents(だれのターン中か) / self=true(このパーマネント自身のとき。enters / leaves / attacks / blocks) / alone=true(attacks で、そのクリーチャーだけが攻撃しているとき)",
    params: {
      event: { type: "string", required: true, choices: ["cast", "enters", "leaves", "step", "attacks", "blocks"] },
      step: { type: "string", choices: ["upkeep", "draw", "main1", "combat", "main2", "end"] },
      who: { type: "string", choices: ["you", "opponents"] },
      type: { type: "string" },
      notType: { type: "string" },
      turn: { type: "string", choices: ["yours", "opponents"] },
      self: { type: "boolean" },
      alone: { type: "boolean" },
    },
    outputs: {},
    declaration: true,
    only: ["triggered"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "keyword",
    core: true,
    title: "キーワード能力",
    summary: "常在型能力に書く、キーワード能力の宣言。name=flash なら瞬速で唱えられ、それ以外は戦場に出たときにそのキーワードを得る",
    params: { name: { type: "string", required: true, choices: KEYWORDS } },
    outputs: {},
    declaration: true,
    only: ["static"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "reduceCost",
    title: "コスト軽減",
    summary: "呪文のコストを amount 減らす(マナ総量から引く)。who=you(このパーマネントのコントローラーの呪文。既定) / opponents / all。type・notType で呪文の型を絞る。affect は要らない",
    params: { amount: { type: "number", required: true, min: 1 }, who: { type: "string", choices: ["you", "opponents", "all"] }, type: { type: "string" }, notType: { type: "string" } },
    ...cont,
  });

  node({
    id: "ward",
    title: "護法",
    summary: "護法 {N}(「このパーマネントが、対戦相手がコントロールする呪文や能力の対象になるたび、それを打ち消す。そのプレイヤーが {N} を支払わないかぎり」)。常在型能力に amount=N で書く(affect は要らない。汎用のマナ N 点だけ)",
    params: { amount: { type: "number", required: true, min: 1 } },
    ...cont,
  });

  node({
    id: "untapDuring",
    title: "他のプレイヤーのアンタップ",
    summary: "このパーマネントを、他のプレイヤーのアンタップ・ステップにもアンタップする(Bender's Waterskin など)。who=opponents(対戦相手のターン) / all。自分のアンタップ・ステップでは、ふつうにアンタップする。affect は要らない",
    params: { who: { type: "string", required: true, choices: ["opponents", "all"] } },
    ...cont,
  });

  // 起動のタイミング (装備など): sorcery=true なら、自分のメインフェイズで、スタックが空のときだけ起動できる
  node({
    id: "timing",
    core: true,
    title: "起動のタイミング",
    summary: "起動型能力の起動のタイミングの制限(能力の最初に書く)。sorcery=true なら、ソーサリーのタイミングだけ(装備など)",
    params: { sorcery: { type: "boolean", required: true } },
    declaration: true,
    only: ["activated"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });
}
