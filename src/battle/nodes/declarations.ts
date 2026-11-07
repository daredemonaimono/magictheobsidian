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

  defineCondition({ id: "noManaSpent", title: "マナを使わずに唱えられた", summary: "引き金になった呪文 (when event=cast の誘発で) が、マナを1点も使わずに唱えられた (別のコスト・0 のコスト)。Lavinia, Azorius Renegade", test: (ctx) => { const s = ctx.game.stack.find((x) => x.id === ctx.item.trigger && !x.ability); return !!s && s.cast.paid === 0; } });

  defineCondition({ id: "teamwork", title: "チームワークを用いた", summary: "この呪文がチームワークを用いて唱えられた", test: (ctx) => !!ctx.item.cast.teamwork });

  for (let i = 1; i <= 5; i++) defineCondition({ id: `mode${i}`, title: `モード${i}が選ばれた`, summary: `この呪文のモード${i}が選ばれて唱えられた (modes の宣言と使う)`, test: (ctx) => !!ctx.item.cast.modes?.includes(i) });

  // 宣言のノード (エンジンが読む): コスト、追加コスト、モード。払う・選ぶ処理は、能力を起動する・呪文を唱えるエンジン側が行う。マナの色はまだ区別しない
  node({
    id: "cost",
    core: true,
    title: "コスト",
    summary: "起動型能力のコスト(能力の最初に書く)。mana=払う汎用マナの数 / manaCost=色つきのマナコスト(\"{1}{U}\") / tap=このパーマネントをタップ / sacrifice=このパーマネントを生け贄に捧げる / life=N点のライフを払う (フェッチランド) / tapCreatures=パワーの合計がこの値以上になるよう、自分のクリーチャーをタップ / loyalty=忠誠度を足す(+1 は loyalty=1、−2 は loyalty=-2。プレインズウォーカーの能力。ソーサリーのタイミングで1ターンに1回) / loyaltyX=true で −X(X は起動時に選び、効果の中で $X として参照する) / removeCounter=カウンターの種類(+1/+1 など)を 1 個取り除く / discardSelf=true で、このカードを手札から捨てる(手札から起動する能力: サイクリング。cost mana=2 discardSelf=true → draw) / exileSelf=true で、このカードを墓地から追放する(墓地から起動する能力)",
    params: { mana: { type: "number", min: 0 }, manaCost: { type: "string" }, tap: { type: "boolean" }, sacrifice: { type: "boolean" }, life: { type: "number", min: 0 }, tapCreatures: { type: "number", min: 0 }, loyalty: { type: "number" }, loyaltyX: { type: "boolean" }, removeCounter: { type: "string" }, discardSelf: { type: "boolean" }, exileSelf: { type: "boolean" } },
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
    summary: "呪文を唱えるときの追加コスト。任意(キッカー・チームワーク): flag=kicked / teamwork。払って唱えると、if=<flag> のノードが実行される。mana / manaCost=\"{1}{U}\" / tapCreatures=パワーの合計がこの値以上になるよう自分のクリーチャーをタップ。必須: required=true と、sacrifice=型(クリーチャーなどを生け贄に捧げる。Final Vengeance) か、forage=true と manaCost(探索=墓地のカード3枚を追放か食物を生け贄にするか、manaCost を支払う。Feed the Cycle)",
    params: { flag: { type: "string", choices: ["kicked", "teamwork"] }, mana: { type: "number", min: 0 }, manaCost: { type: "string" }, tapCreatures: { type: "number", min: 0 }, required: { type: "boolean" }, sacrifice: { type: "string" }, forage: { type: "boolean" } },
    check: (a) => {
      if (a.required === true ? a.sacrifice === undefined && a.forage !== true : a.flag === undefined) return a.required === true ? "required には sacrifice か forage が要る" : "flag が要る (kicked / teamwork)";
      try { if (typeof a.manaCost === "string") parseManaCost(a.manaCost); return null; } catch (e) { return (e as Error).message; }
    },
    outputs: {},
    declaration: true,
    only: ["spell"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "altCost",
    core: true,
    title: "別のコスト",
    summary: "呪文を唱えるとき、マナコストのかわりに払ってもよい別のコスト(Force of Will・召喚者)。払って唱えると、if=alt のノードが実行される。mana=汎用のマナ / manaCost=色つきのマナコスト / life=払うライフ / exile=手札から追放するカードの枚数(exileColor=W・U・B・R・G でその色のカード。唱える呪文自身は数えない) / notYourTurn=true で、自分のターンでないときだけ / exileX=true で、追放したカードのマナ総量が X になる(Sickening Shoal。$X で読む) / oppSpells=N で、相手がこのターンに N 個以上呪文を唱えていたときだけ(Mindbreak Trap。mana=0 と使う)。パーマネントなら Evoke: 出たとき if=alt で生け贄に(Grief)",
    params: { mana: { type: "number", min: 0 }, manaCost: { type: "string" }, life: { type: "number", min: 0 }, exile: { type: "number", min: 1 }, exileColor: { type: "string", choices: ["W", "U", "B", "R", "G"] }, notYourTurn: { type: "boolean" }, exileX: { type: "boolean" }, oppSpells: { type: "number", min: 1 } },
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

  // 遅延誘発: このノードより後ろのノードは、いまではなく、次の、そのステップの開始時に実行される
  node({
    id: "delay",
    title: "あとで (遅延誘発)",
    summary: "誘発型能力の途中に書く。このノードより後ろのノードを、いまではなく、次の step(upkeep・draw・main1・combat・main2・end)の開始時(だれのターンでも、次のそれ)に実行する。「次の終了ステップの開始時に、戦場に戻す」(Prized Amalgam)は、delay step=end → self → move to=battlefield tapped=true",
    params: { step: { type: "string", required: true, choices: ["upkeep", "draw", "main1", "combat", "main2", "end"] } },
    outputs: {},
    only: ["triggered", "activated", "spell"],
    run: (): Record<string, Value> => ({}),
  });

  // 戦場の選択: 「出るとき、色を 1 つ選ぶ」(Heraldic Banner)。選んだ色は、affect の color=chosen・addMana の color=chosen で使う
  node({
    id: "chooseColor",
    title: "色を選ぶ",
    summary: "常在型能力。このパーマネントが戦場に出るとき、色を 1 つ選ぶ。選んだ色は、affect color=chosen(その色のクリーチャーに及ぶ)・addMana color=chosen(その色のマナ)で使う",
    params: {},
    declaration: true,
    only: ["static"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });

  // 護法を無視する (継続効果)
  node({
    id: "ignoreWard",
    title: "護法を無視する",
    summary: "常在型能力。who=opponents のパーマネント(対戦相手のクリーチャーなど)の護法は、誘発しない(Nowhere to Run)。呪禁は、いまのエンジンでは、対象を制限しないので、書かなくてよい",
    params: { who: { type: "string", choices: ["you", "opponents", "all"] } },
    declaration: true,
    only: ["static"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });

  // 墓地から唱えられる
  node({
    id: "castFromGraveyard",
    title: "墓地から唱えられる",
    summary: "常在型能力。このカードを、墓地から唱えてよい。alt=true なら、別のコスト(altCost。ワープなど)でだけ。唱えるのは、墓地のカードの一覧から (Timeline Culler)",
    params: { alt: { type: "boolean" } },
    declaration: true,
    only: ["static"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });

  // 戦闘: ブロックできない (継続効果)
  node({
    id: "cantBlock",
    title: "ブロックできない",
    summary: "常在型能力。このクリーチャーは、ブロックできない(Forsaken Miner)",
    params: {},
    declaration: true,
    only: ["static"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });

  // そうしたとき (反射誘発)
  node({
    id: "reflexive",
    title: "そうしたとき",
    summary: "「そうしたとき、〜」。if=$名前 を付けて、あとのノードを、新しい誘発型能力として、いまスタックに積む。対象 (target) は、このとき選ぶ(捨てたあとで選ぶ対象など)。ここまでの $名前 は、あとのノードには渡らない。Inti は、discard optional=true as=d → reflexive if=$d → target … → addCounter …",
    params: {},
    outputs: {},
    only: ["triggered", "activated", "spell"],
    run: (): Record<string, Value> => ({}),
  });

  // ライフを得られない (継続効果)
  node({
    id: "cantGainLife",
    title: "ライフを得られない",
    summary: "常在型能力。プレイヤーは、ライフを得られない(絆魂・ライフを得る効果も何も起きない)。who=all(全員。既定) / you(このパーマネントのコントローラー) / opponents (Sunspine Lynx)",
    params: { who: { type: "string", choices: ["you", "opponents", "all"] } },
    declaration: true,
    only: ["static"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });

  // エンジン始動! (速度): 戦場に出たとき、速度が無ければ 1 から始まる
  node({
    id: "startEngines",
    title: "エンジン始動!",
    summary: "常在型能力。このパーマネントが戦場に出たとき、自分に速度が無ければ、速度が 1 から始まる。速度は、自分のターンに相手がライフを失うと、1 ターンに 1 回 1 上がる(最高 4)。「最高速度のあいだ〜」は、affect minSpeed=4 と書く",
    params: {},
    declaration: true,
    only: ["static"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });

  // 墓地に行くかわりに追放 (置換)。戦場にあるあいだ働く
  node({
    id: "exileInstead",
    title: "墓地に行くかわりに追放",
    summary: "常在型能力。カードが墓地に置かれるかわりに、追放される(どこから置かれるときでも)。who=opponents(相手の墓地に行くカード。Leyline of the Void) / you / all(だれの墓地でも。Rest in Peace)。戦場にあるあいだ働く",
    params: { who: { type: "string", required: true, choices: ["opponents", "you", "all"] } },
    outputs: {},
    declaration: true,
    only: ["static"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "ignoreLegendRule",
    title: "伝説のルールを無視する",
    summary: "常在型能力。伝説のルール(同名の伝説のパーマネントは 1 つだけ)が、働かなくなる。who=all(だれのパーマネントにも。Mirror Gallery) / you(このパーマネントのコントローラーのものだけ) / opponents / self(このパーマネント自身だけ)。能力を失っていると、働かない",
    params: { who: { type: "string", required: true, choices: ["all", "you", "opponents", "self"] } },
    outputs: {},
    declaration: true,
    only: ["static"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "startOnBattlefield",
    title: "開始時に戦場に出す",
    summary: "常在型能力。このカードが、ゲーム開始時の手札にあるなら、ゲームを戦場に出して始められる(Leyline of the Void)。マリガンが終わったあとに、戦場に出る",
    params: {},
    outputs: {},
    declaration: true,
    only: ["static"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "mulliganExile",
    title: "マリガンのかわりに手札を入れ替える",
    summary: "常在型能力。マリガンできるとき、このカードが手札にあれば、手札を全部追放して、同じ枚数を引いてもよい(マリガンの回数には数えない。Serum Powder)",
    params: {},
    outputs: {},
    declaration: true,
    only: ["static"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "entersWith",
    core: true,
    title: "カウンターつきで出る",
    summary: "戦場に出るとき、kind のカウンターが置かれた状態で出る(常在型能力)。x=true で、唱えるときに選んだ X 個(Chalice of the Void)/ count=N 個 / zone=graveyard + type=creature で、自分の墓地のその型のカード 1 枚につき 1 個(Golgari Grave-Troll)。出た直後から、カウンターが載っている",
    params: { kind: { type: "string", required: true }, x: { type: "boolean" }, count: { type: "number", min: 1 }, zone: { type: "string", choices: ["graveyard"] }, type: { type: "string" } },
    check: (a) => (a.x === true || a.count !== undefined || a.zone !== undefined ? null : "x か count か zone が要る"),
    outputs: {},
    declaration: true,
    only: ["static"],
    run: (): Record<string, Value> => ({}),
  });

  node({
    id: "dredge",
    core: true,
    title: "Dredge",
    summary: "Dredge の宣言(常在型能力。amount=N)。このカードが墓地にあるとき、カードを引くかわりに、ライブラリーの上から N 枚を墓地に置いて、このカードを手札に戻してもよい(ライブラリーが N 枚以上のとき)。Stinkweed Imp・Golgari Thug・Shambling Shell・Golgari Grave-Troll",
    params: { amount: { type: "number", required: true, min: 1 } },
    outputs: {},
    declaration: true,
    only: ["static"],
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
      "誘発型能力の最初に書く、誘発のきっかけ。event=cast / enters(from=graveyard) / leaves(to=graveyard=死亡) / moved(from=hand to=graveyard=捨てた・from=graveyard=墓地を離れた) / damaged(combat=true) / attacks / blocks / targeted(by=you) / drew / crime(相手側を対象に) / unlock(部屋の扉。door=1・2) / step(step=upkeep〜end)。zone=graveyard は墓地にあるあいだだけ。絞り込み: who=you・opponents / type・notType / turn=yours・opponents / self / other(ほかの) / maxPower=N / alone / first / once(同じ宣言で1回) / oncePerTurn / requires=印(gainAbility・扉の door1)。eventPerm は引き金のもの",
    params: {
      event: { type: "string", required: true, choices: ["cast", "enters", "leaves", "moved", "damaged", "step", "attacks", "blocks", "targeted", "drew", "crime", "unlock"] },
      combat: { type: "boolean" },
      hit: { type: "string", choices: ["creature", "player", "planeswalker"] },
      zone: { type: "string", choices: ["battlefield", "graveyard"] },
      from: { type: "string", choices: ["library", "hand", "graveyard", "stack", "battlefield"] },
      to: { type: "string", choices: ["library", "hand", "graveyard", "exile", "battlefield"] },
      castFrom: { type: "string" },
      step: { type: "string", choices: ["upkeep", "draw", "main1", "combat", "main2", "end"] },
      who: { type: "string", choices: ["you", "opponents"] },
      type: { type: "string" },
      notType: { type: "string" },
      turn: { type: "string", choices: ["yours", "opponents"] },
      self: { type: "boolean" },
      alone: { type: "boolean" },
      first: { type: "boolean" },
      once: { type: "boolean" },
      requires: { type: "string" },
      other: { type: "boolean" },
      door: { type: "number", min: 1, max: 2 },
      oncePerTurn: { type: "boolean" },
      maxPower: { type: "number" },
      by: { type: "string", choices: ["you"] },
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
    summary: "呪文のコストを amount 減らす(マナ総量から引く)。who=you(このパーマネントのコントローラーの呪文。既定) / opponents / all。type・notType で呪文の型を絞る。affect は要らない。self=true は、このカード自身を唱えるときの軽減(「この呪文は〜安くなる」)で、per=discarded を付けると、このターンに捨てた・サイクリングしたカード 1 枚につき amount 減る(Hollow One)",
    params: { amount: { type: "number", required: true, min: 1 }, who: { type: "string", choices: ["you", "opponents", "all"] }, type: { type: "string" }, notType: { type: "string" }, self: { type: "boolean" }, per: { type: "string", choices: ["discarded"] } },
    ...cont,
  });

  // 制限・置換の枠 (常在型能力。affect は要らない)。戦場にあるあいだ、エンジンが、そのつど調べる
  node({
    id: "castLimit",
    title: "唱えられる数の制限",
    summary: "1ターンに唱えられる呪文の数を、プレイヤーごとに amount 以下にする(Archon of Emeria は amount=1)。who=all(全員。既定) / you / opponents。affect は要らない",
    params: { amount: { type: "number", required: true, min: 0 }, who: { type: "string", choices: ["you", "opponents", "all"] } },
    ...cont,
  });

  node({
    id: "cantCast",
    title: "唱えられない呪文",
    summary: "条件に合う呪文を、唱えられなくする。who=opponents(対戦相手が唱える呪文。all 既定 / you)。type・notType で呪文の型を絞る。mvOverLands=true なら、マナ総量が、そのプレイヤーがコントロールする土地の数より大きい呪文だけ(Lavinia は who=opponents notType=creature mvOverLands=true)。from=graveyard|library で、そのゾーンから唱えるときだけ(Grafdigger's Cage)。affect は要らない",
    params: { who: { type: "string", choices: ["you", "opponents", "all"] }, type: { type: "string" }, notType: { type: "string" }, mvOverLands: { type: "boolean" }, from: { type: "string" } },
    ...cont,
  });

  node({
    id: "cantActivate",
    title: "起動できない能力",
    summary: "条件に合うパーマネントの起動型能力(マナ能力も)を、起動できなくする。type・notType でパーマネントの型を絞る(Collector Ouphe は type=artifact)。who で、能力を起動するプレイヤーを絞る(既定は all)。affect は要らない",
    params: { who: { type: "string", choices: ["you", "opponents", "all"] }, type: { type: "string" }, notType: { type: "string" } },
    ...cont,
  });

  node({
    id: "entersTapped",
    title: "タップ状態で出る",
    summary: "条件に合うカードが、タップ状態で戦場に出る(Archon of Emeria の「対戦相手の基本でない土地」は who=opponents type=land notType=Basic)。who は、戦場に出るカードのコントローラー(既定は all)。affect は要らない",
    params: { who: { type: "string", choices: ["you", "opponents", "all"] }, type: { type: "string" }, notType: { type: "string" } },
    ...cont,
  });

  node({
    id: "cantEnter",
    title: "戦場に出られない",
    summary: "from(graveyard / library。graveyard|library のように並べられる)にある、条件に合うカードが、戦場に出られなくする(Grafdigger's Cage は from=graveyard|library type=creature)。探して戦場に出す(search)で効く。affect は要らない",
    params: { from: { type: "string", required: true }, type: { type: "string" }, notType: { type: "string" } },
    ...cont,
  });

  node({
    id: "upkeepTax",
    title: "維持コスト",
    summary: "条件に合うパーマネントは、そのコントローラーのアップキープの開始時に、汎用マナ mana を支払わないかぎり、else=sacrifice(生け贄に捧げる) / destroy(破壊される)(Energy Flux は type=artifact mana=2 else=sacrifice、The Tabernacle at Pendrell Vale は type=creature mana=1 else=destroy)。who は、パーマネントのコントローラー(既定は all)。マナは、払えるなら自動でタップして払い、払うかどうかを聞く。affect は要らない",
    params: { mana: { type: "number", required: true, min: 1 }, else: { type: "string", required: true, choices: ["sacrifice", "destroy"] }, who: { type: "string", choices: ["you", "opponents", "all"] }, type: { type: "string" }, notType: { type: "string" } },
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
    summary: "起動型能力の起動の制限(能力の最初に書く)。sorcery=true なら、ソーサリーのタイミングだけ(装備など) / oncePerTurn=true なら、1ターンに1回だけ / oppLostLife=true なら、相手がこのターンにライフを失っているときだけ / lockedDoor=1・2 なら、その扉が閉じているときだけ(部屋)",
    params: { sorcery: { type: "boolean" }, oncePerTurn: { type: "boolean" }, oppLostLife: { type: "boolean" }, lockedDoor: { type: "number", min: 1, max: 2 } },
    check: (a) => (a.sorcery !== undefined || a.oncePerTurn !== undefined || a.oppLostLife !== undefined || a.lockedDoor !== undefined ? null : "sorcery・oncePerTurn・oppLostLife・lockedDoor のどれかが要る"),
    declaration: true,
    only: ["activated"],
    outputs: {},
    run: (): Record<string, Value> => ({}),
  });
}
