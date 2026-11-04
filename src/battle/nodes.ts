import { RunCtx, Value } from "./node";
import { defineCondition, defineNode, getNode } from "./registry";
import { Game, GameCard, Perm, keywordsOf, playersOf, untapPerm } from "./state";

// 実装済みの基本ノード。打ち消しは「対象」+「打ち消す」の組み合わせで、カードごとの違いは対象の条件 (引数) だけ

// 「キーワードを得る」で選べるキーワード能力 (増やすときはここへ)
const KEYWORDS = ["flying", "hexproof", "flash", "haste", "vigilance", "trample", "lifelink", "deathtouch", "firstStrike", "doubleStrike", "reach", "menace", "defender", "prowess", "indestructible"];

// 対象・選択の出力は、id をカンマでつないだ文字列 (複数の対象・集合のため)。空なら空文字
const idList = (v: Value | undefined): string[] => (v === undefined || v === "" ? [] : String(v).split(","));

// 場所を問わずカードを探す (ライブラリー・手札・墓地)。見つかれば取り除いて返す
function takeCard(g: Game, id: string): GameCard | undefined {
  for (const zone of [g.libraries, g.hands, g.graveyards]) {
    for (const p of Object.keys(zone)) {
      const i = zone[p].findIndex((c) => c.id === id);
      if (i >= 0) return zone[p].splice(i, 1)[0];
    }
  }
  return undefined;
}
const findCard = (g: Game, id: string): GameCard | undefined => [g.libraries, g.hands, g.graveyards].flatMap((z) => Object.values(z).flat()).find((c) => c.id === id);

// target と select が共有する絞り込み (型・マナ総量・コントローラー・攻撃中・タップ状態)
const filterParams = {
  type: { type: "string" as const },
  notType: { type: "string" as const },
  mv: { type: "number" as const },
  controller: { type: "string" as const, choices: ["you", "opponents"] },
  attacking: { type: "boolean" as const },
  tapped: { type: "boolean" as const },
};
function matches(ctx: RunCtx, a: Record<string, Value>, hit: { card: GameCard; controller: string }): boolean {
  const line = hit.card.typeLine.toLowerCase();
  if (typeof a.type === "string" && !line.includes(a.type.toLowerCase())) return false;
  if (typeof a.notType === "string" && line.includes(a.notType.toLowerCase())) return false;
  if (typeof a.mv === "number" && hit.card.mv !== a.mv) return false;
  if (typeof a.controller === "string" && (a.controller === "you") !== (hit.controller === ctx.item.controller)) return false;
  const perm = hit as Perm;
  if (typeof a.attacking === "boolean" && !!perm.attacking !== a.attacking) return false;
  if (typeof a.tapped === "boolean" && !!perm.tapped !== a.tapped) return false;
  return true;
}

export function registerBuiltinNodes(): void {
  if (getNode("target")) return;

  // 条件: 呪文を唱えたときの記録 (キッカー・チームワーク・選んだモード)
  defineCondition({ id: "kicked", title: "キッカーされた", summary: "この呪文がキッカーされて唱えられた", test: (ctx) => !!ctx.item.cast.kicked });
  defineCondition({ id: "teamwork", title: "チームワークを用いた", summary: "この呪文がチームワークを用いて唱えられた", test: (ctx) => !!ctx.item.cast.teamwork });
  for (let i = 1; i <= 5; i++) defineCondition({ id: `mode${i}`, title: `モード${i}が選ばれた`, summary: `この呪文のモード${i}が選ばれて唱えられた (modes の宣言と使う)`, test: (ctx) => !!ctx.item.cast.modes?.includes(i) });

  // 対象を決める。唱えるときに選んだ対象 (ctx.item.targets[as]。複数ならカンマ区切り) が、いまも条件に合っていれば id を返す。合わなければ空
  defineNode({
    id: "target",
    title: "対象",
    summary:
      "対象を決める。zone=stack + kind=spell(スタックの呪文) / zone=battlefield + kind=permanent(戦場のパーマネント) / zone=player + kind=player(プレイヤー。draw や discard の player=target と使う)。" +
      "type=型 / notType=その型でない / mv=マナ総量 / controller=you(この呪文のコントローラーのもの)・opponents(それ以外) / attacking=攻撃中か / tapped=タップ状態 で絞る。min / max = 対象の数(既定は1。「1体か2体」は min=1 max=2、「最大1つ」は min=0 max=1)",
    params: {
      zone: { type: "string", required: true, choices: ["stack", "battlefield", "player"] },
      kind: { type: "string", required: true, choices: ["spell", "permanent", "player"] },
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
        // zone と kind の組み合わせは stack+spell / battlefield+permanent だけ。それ以外は対象無し (スタックの起動型能力は呪文ではない)
        const hit = a.zone === "stack" && a.kind === "spell" ? g.stack.find((s) => s.id === id && !s.ability) : a.zone === "battlefield" && a.kind === "permanent" ? g.battlefield.find((p) => p.id === id) : undefined;
        if (!hit || !matches(ctx, a, hit)) return false;
        // 呪禁: 相手のコントロールする呪文や能力の対象にならない
        return !(a.zone === "battlefield" && keywordsOf(hit as Perm).includes("hexproof") && hit.controller !== ctx.item.controller);
      };
      const ok = list.filter(legal);
      if (strict ? ok.length !== list.length : list.length > 0 && !ok.length) return {}; // 解決時は、残った合法な対象にだけ効く。全部が不正なら、解決しない
      return { id: ok.join(",") };
    },
  });

  // 対象を取らずに、条件に合うものすべてを集める (「すべての攻撃クリーチャー」)。呪禁には関係しない
  defineNode({
    id: "select",
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
      return { id: all.filter((x) => matches(ctx, a, x)).map((x) => x.id).join(",") };
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

  // ライブラリーの上から count 枚を見る (動かさない)。見たカードの id を出力する。足りなければ、ある分だけ
  defineNode({
    id: "look",
    title: "ライブラリーの上を見る",
    summary: "プレイヤーのライブラリーの上から count 枚を見る(動かさない)。出力を choose や move に渡す。player=you / opponents / target",
    params: { player: who, target: targetPlayer, count: { type: "number", required: true, min: 0 } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => ({ id: playersFor(ctx, a).flatMap((p) => ctx.game.libraries[p].slice(0, Number(a.count)).map((c) => c.id)).join(",") }),
  });

  // 見たカードの中から、count 枚を選ぶ。選ぶのは呪文のコントローラー。g.decide.choose で選べる。既定は先頭から (shortcut: 判断の入力を作るときに置き換える)
  defineNode({
    id: "choose",
    title: "選ぶ",
    summary: "from(look などの出力)の中から count 枚を選ぶ。選んだカードの id を出力する",
    params: { from: { type: "ref", required: true }, count: { type: "number", required: true, min: 0 } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const options = idList(a.from).flatMap((id) => findCard(g, id) ?? []);
      const n = Math.min(Number(a.count), options.length);
      const picked = (g.decide?.choose?.(g, ctx.item.controller, options, n) ?? options.slice(0, n)).filter((c) => options.includes(c)).slice(0, n);
      return { id: picked.map((c) => c.id).join(",") };
    },
  });

  // カードを動かす。cards の中から except を除いて、持ち主の手札・墓地・ライブラリーの上/底へ。順番は、並んでいる順 (shortcut: 「好きな順番で」の入力は、まだ無い)
  defineNode({
    id: "move",
    title: "カードを動かす",
    summary: "cards(look / choose の出力)を、持ち主の to へ動かす。to=hand / graveyard / top(ライブラリーの一番上) / bottom(一番下)。except に渡したカードは動かさない(「残りを底に」)",
    params: { cards: { type: "ref", required: true }, except: { type: "ref" }, to: { type: "string", required: true, choices: ["hand", "graveyard", "top", "bottom"] } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const skip = new Set(idList(a.except));
      const list = idList(a.cards).filter((id) => !skip.has(id));
      if (a.to === "top") list.reverse(); // 順番を保ったまま一番上に積む
      for (const id of list) {
        const c = takeCard(g, id);
        if (!c) continue;
        if (a.to === "hand") g.hands[c.owner].push(c);
        else if (a.to === "graveyard") g.graveyards[c.owner].push(c);
        else if (a.to === "top") g.libraries[c.owner].unshift(c);
        else g.libraries[c.owner].push(c);
      }
      return {};
    },
  });

  // 手札に戻す。戦場のパーマネントを、持ち主の手札へ。対象が戦場に無ければ何もしない
  defineNode({
    id: "bounce",
    title: "手札に戻す",
    summary: "対象(select の出力も可)のパーマネントを持ち主の手札に戻す",
    params: { target: { type: "ref", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      for (const id of idList(a.target)) {
        const i = ctx.game.battlefield.findIndex((p) => p.id === id);
        if (i < 0) continue;
        const [gone] = ctx.game.battlefield.splice(i, 1);
        ctx.game.hands[gone.card.owner].push(gone.card);
        ctx.game.log.push(`${gone.card.name} を手札に戻した`);
        ctx.game.events.push({ type: "leaves", perm: gone });
      }
      return {};
    },
  });

  // タップ / アンタップ。戦場のパーマネントの状態。対象が戦場に無ければ何もしない
  for (const [id, title, tapped] of [["tap", "タップする", true], ["untap", "アンタップする", false]] as const) {
    defineNode({
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
  defineNode({
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
  defineNode({
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

  // 宣言のノード (エンジンが読む): コスト、追加コスト、モード。払う・選ぶ処理は、能力を起動する・呪文を唱えるエンジン側が行う。マナの色はまだ区別しない
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
  defineNode({
    id: "modes",
    title: "モード",
    summary: "「以下から選ぶ」の宣言(呪文能力の最初に書く)。count=モードの数(最大5) / min・max=選ぶ数(「1つ」は min=1 max=1、「1つまたは両方」は min=1 max=2)。各モードのノードに if=mode1, if=mode2 … を付ける",
    params: { count: { type: "number", required: true, min: 1, max: 5 }, min: { type: "number", required: true, min: 1 }, max: { type: "number", required: true, min: 1 } },
    outputs: {},
    declaration: true,
    only: ["spell"],
    run: (): Record<string, Value> => ({}),
  });

  // 宣言のノード (誘発型・常在型): 誘発のきっかけ (when)、キーワード (keyword)。エンジンが読む
  defineNode({
    id: "when",
    title: "どうなったら",
    summary:
      "誘発型能力の最初に書く、誘発のきっかけ。event=cast(呪文を唱えた) / enters(戦場に出た) / leaves(戦場を離れた)。絞り込み: who=you・opponents(唱えた/コントロールするプレイヤー) / type・notType(その呪文・パーマネントの型) / turn=yours・opponents(だれのターン中か) / self=true(このパーマネント自身のとき。enters / leaves)",
    params: {
      event: { type: "string", required: true, choices: ["cast", "enters", "leaves"] },
      who: { type: "string", choices: ["you", "opponents"] },
      type: { type: "string" },
      notType: { type: "string" },
      turn: { type: "string", choices: ["yours", "opponents"] },
      self: { type: "boolean" },
    },
    outputs: {},
    declaration: true,
    only: ["triggered"],
    run: (): Record<string, Value> => ({}),
  });
  defineNode({
    id: "keyword",
    title: "キーワード能力",
    summary: "常在型能力に書く、キーワード能力の宣言。name=flash なら瞬速で唱えられ、それ以外は戦場に出たときにそのキーワードを得る",
    params: { name: { type: "string", required: true, choices: KEYWORDS } },
    outputs: {},
    declaration: true,
    only: ["static"],
    run: (): Record<string, Value> => ({}),
  });
  // このパーマネント自身 (誘発型・起動型能力の発生源)
  defineNode({
    id: "self",
    title: "このパーマネント",
    summary: "この能力の発生源のパーマネント自身の id を出力する(「このクリーチャーの上に」など。as= を付けて、target に渡す)",
    params: {},
    outputs: { id: "id" },
    run: (ctx): Record<string, Value> => ({ id: ctx.item.source ?? "" }),
  });
  // カウンターを置く。対象が戦場に無ければ何もしない
  defineNode({
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
      const g = ctx.game;
      for (const id of idList(a.target)) {
        const i = g.stack.findIndex((s) => s.id === id);
        if (i < 0) continue;
        if (typeof a.unlessPay === "number") {
          // shortcut: マナの色は区別しない。払うかどうかは g.decide.pay (既定は払えるなら払う)。判断の入力を作るときに置き換える
          const p = g.stack[i].controller;
          if (g.mana[p] >= a.unlessPay && (g.decide?.pay?.(g, p, a.unlessPay) ?? true)) {
            g.mana[p] -= a.unlessPay;
            g.log.push(`${p} が ${a.unlessPay} を支払い、${g.stack[i].card.name} は打ち消されなかった`);
            continue;
          }
        }
        const [gone] = g.stack.splice(i, 1);
        g.graveyards[gone.card.owner].push(gone.card);
        g.log.push(`${gone.card.name} を打ち消した`);
      }
      return {};
    },
  });
}
