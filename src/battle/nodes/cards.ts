import { characteristics } from "../continuous";
import { NodeDef, Value } from "../node";
import { defineNode as define } from "../registry";
import { nextRandom } from "../rng";
import { discardCards, drawCards, Game, Perm, typeIn } from "../state";
import { findCard, idList, playersFor, takeCard, targetPlayer, who } from "./shared";

// ノード: カードの移動・ライブラリー・手札
const CATEGORY = "カードの移動・ライブラリー・手札";
const node = (def: Omit<NodeDef, "category">) => define({ ...def, category: CATEGORY });

export function registerCards(): void {
  // 引く。ライブラリーが足りなければ、引ける分だけ引いて記録を残す
  node({
    id: "draw",
    title: "引く",
    summary: "プレイヤーがカードを count 枚引く。player=you(呪文のコントローラー) / opponents(全相手) / target(target ノードで選んだプレイヤー。target=$名前 を渡す)",
    params: { player: who, target: targetPlayer, count: { type: "number", required: true, min: 0 } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      for (const p of playersFor(ctx, a)) drawCards(ctx.game, p, Number(a.count));
      return {};
    },
  });

  // 捨てる。捨てるカードは g.decide.discard で選べる。既定は手札の後ろから (shortcut: 本来は持ち主が選ぶ。判断の入力を作るときに置き換える)
  node({
    id: "discard",
    title: "捨てる",
    summary: "プレイヤーが手札を count 枚捨てる。player=you / opponents / target(draw と同じ)",
    params: { player: who, target: targetPlayer, count: { type: "number", required: true, min: 0 } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      for (const p of playersFor(ctx, a)) discardCards(ctx.game, p, Number(a.count));
      return {};
    },
  });

  // ライブラリーの上から count 枚を見る (動かさない)。見たカードの id を出力する。足りなければ、ある分だけ
  node({
    id: "look",
    title: "ライブラリーの上を見る",
    summary: "プレイヤーのライブラリーの上から count 枚を見る(動かさない)。出力を choose や move に渡す。player=you / opponents / target",
    params: { player: who, target: targetPlayer, count: { type: "number", required: true, min: 0 } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => ({ id: playersFor(ctx, a).flatMap((p) => ctx.game.libraries[p].slice(0, Number(a.count)).map((c) => c.id)).join(",") }),
  });

  // プレイヤーの手札を見る (動かさない)。見たカードの id を出力する。choose / filter / move と組み合わせる ("手札を見て、1枚選んで、捨てさせる")。画面は、見た手札を、前に出す
  node({
    id: "lookHand",
    title: "手札を見る",
    summary: "プレイヤーの手札を見る(動かさない。「手札を公開する」「手札を見て、1枚選んで、捨てさせる」)。見たカードの id を出力する: filter(絞る)・choose(選ぶ)・move(to=graveyard / top など)につなぐ。player=you / opponents / target。相手の手札を見ると、画面は、見た手札を、前に出して見せる (自分の手札を、ほかのノードに渡すだけのときは、見せない)",
    params: { player: who, target: targetPlayer },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const ps = playersFor(ctx, a);
      const cards = ps.flatMap((p) => g.hands[p]);
      // 自分の手札を、ほかのノードに渡すだけ (「手札から2枚選んで〜」) のときは、見せない・ログに出さない
      if (ps.some((p) => p !== ctx.item.controller)) {
        g.handLook = { by: ctx.item.controller, of: ps[0], ids: cards.map((c) => c.id), n: (g.handLook?.n ?? 0) + 1 };
        g.log.push(`相手の手札を見た${cards.length ? `: ${cards.map((c) => c.name).join("、")}` : " (手札が無い)"}`);
      }
      return { id: cards.map((c) => c.id).join(",") };
    },
  });

  // ライブラリーを切る。optional=true なら「してもよい」(断れる)。切り方は、ゲームの乱数 (Game.rngState) から決まる (リプレイで、同じ結果)
  node({
    id: "shuffle",
    title: "ライブラリーを切る",
    summary: "プレイヤーのライブラリーを切る。player=you / opponents / target。optional=true なら「してもよい」(断れる。「切ってもよい」)",
    params: { player: who, target: targetPlayer, optional: { type: "boolean" } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      if (a.optional === true && !(g.decide?.may?.(g, ctx.item.controller, "ライブラリーを切る") ?? true)) return {};
      for (const p of playersFor(ctx, a)) {
        const lib = g.libraries[p];
        for (let i = lib.length - 1; i > 0; i--) {
          const j = Math.floor(nextRandom(g) * (i + 1));
          [lib[i], lib[j]] = [lib[j], lib[i]];
        }
        g.log.push(`${p === ctx.item.controller ? "自分の" : "相手の"}ライブラリーを切った`);
      }
      return {};
    },
  });

  // 見たカードの中から、count 枚を選ぶ。選ぶのは呪文のコントローラー。g.decide.choose で選べる。既定は先頭から (shortcut: 判断の入力を作るときに置き換える)
  node({
    id: "choose",
    title: "選ぶ",
    summary: "from(look などの出力)の中から count 枚を選ぶ。atMost=true なら 0〜count 枚(「好きな数」「最大N」。諜報など)。選んだカードの id を出力する",
    params: { from: { type: "ref", required: true }, count: { type: "number", required: true, min: 0 }, atMost: { type: "boolean" } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const options = idList(a.from).flatMap((id) => findCard(g, id) ?? []);
      const n = Math.min(Number(a.count), options.length);
      // shortcut: 既定は、ちょうど指定の枚数なら先頭から、atMost なら1枚も選ばない。判断の入力を作るときに置き換える
      const picked = (g.decide?.choose?.(g, ctx.item.controller, options, n, a.atMost === true) ?? (a.atMost === true ? [] : options.slice(0, n))).filter((c) => options.includes(c)).slice(0, n);
      return { id: picked.map((c) => c.id).join(",") };
    },
  });

  // カードを動かす。cards の中から except を除いて、持ち主の手札・墓地・ライブラリーの上/底へ。順番は g.decide.order で選べる (既定は、並んでいる順)
  node({
    id: "move",
    title: "カードを動かす",
    summary: "cards(look / choose の出力)を、持ち主の to へ動かす。to=hand / graveyard / top(ライブラリーの一番上) / bottom(一番下)。except に渡したカードは動かさない(「残りを底に」)",
    params: { cards: { type: "ref", required: true }, except: { type: "ref" }, to: { type: "string", required: true, choices: ["hand", "graveyard", "top", "bottom"] } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const skip = new Set(idList(a.except));
      let list = idList(a.cards).filter((id) => !skip.has(id));
      if ((a.to === "top" || a.to === "bottom") && list.length > 1) {
        // 好きな順番で (上から下へ)。入力が無ければ、並んでいる順
        const cards = list.flatMap((id) => findCard(g, id) ?? []);
        const got = g.decide?.order?.(g, ctx.item.controller, cards, a.to)?.map((c) => c.id);
        if (got && got.length === list.length && list.every((id) => got.includes(id))) list = got;
      }
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
  node({
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
        if (!gone.card.token) ctx.game.hands[gone.card.owner].push(gone.card); // トークンは、戦場を離れると消える
        ctx.game.log.push(`${gone.card.name} を手札に戻した`);
        ctx.game.events.push({ type: "leaves", perm: gone });
      }
      return {};
    },
  });

  // 破壊する。対象 (戦場のパーマネント) を、墓地へ (トークンは消える)。破壊不能は、破壊されない。対象が戦場に無ければ、何もしない
  node({
    id: "destroy",
    title: "破壊する",
    summary: "対象(select の出力も可)のパーマネントを破壊する (持ち主の墓地へ。破壊不能は、破壊されない)。「土地を破壊する」(Wasteland・Strip Mine)・「アーティファクトやエンチャントを、最大2つ破壊する」は、target(type=・notType=・min=・max=)と使う",
    params: { target: { type: "ref", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      for (const id of idList(a.target)) {
        const perm = g.battlefield.find((p) => p.id === id);
        if (!perm || characteristics(g, perm, ctx.rules).keywords.includes("indestructible")) continue;
        g.battlefield = g.battlefield.filter((p) => p !== perm);
        if (!perm.card.token) g.graveyards[perm.card.owner].push(perm.card);
        g.log.push(`${perm.card.name} を破壊した`);
        g.events.push({ type: "leaves", perm });
      }
      return {};
    },
  });

  // ライブラリーから、条件に合うカードを探して、戦場か手札に置く。そのあと、ライブラリーを切る (shuffle=false で切らない)。見つからなくても (または、選ばなくても) よい
  node({
    id: "search",
    title: "ライブラリーから探す",
    summary: "コントローラーのライブラリーから、type(型・サブタイプ。例: Forest|Island)に合うカードを count 枚まで(既定は1)探して、to=battlefield / hand に置く。tapped=true ならタップ状態で戦場に出す。そのあとライブラリーを切る (shuffle=false で切らない)。見つかったカードの id を出力する (「そうしたなら」は if=$名前)。フェッチランド: `cost tap=true sacrifice=true life=1` → `search type=Forest|Island to=battlefield`",
    params: { type: { type: "string" }, name: { type: "string" }, to: { type: "string", required: true, choices: ["battlefield", "hand"] }, count: { type: "number", min: 1 }, tapped: { type: "boolean" }, shuffle: { type: "boolean" } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const p = ctx.item.controller;
      const options = g.libraries[p].filter((c) => (typeof a.type !== "string" || typeIn(c.typeLine, a.type)) && (typeof a.name !== "string" || c.name === a.name));
      const n = Math.min(typeof a.count === "number" ? a.count : 1, options.length);
      // 選ぶのは、探す人。入力が無い (相手・自動) ときは、先頭から。断る (0 枚) こともできる
      const picked = (g.decide?.choose?.(g, p, options, n, true) ?? options.slice(0, n)).filter((c) => options.includes(c)).slice(0, n);
      for (const c of picked) {
        g.libraries[p] = g.libraries[p].filter((x) => x !== c);
        if (a.to === "hand") g.hands[p].push(c);
        else {
          const perm: Perm = { id: c.id, card: c, controller: p, enteredTurn: g.turn, ...(a.tapped === true ? { tapped: true } : {}), ...(c.loyalty !== undefined ? { counters: { loyalty: c.loyalty } } : {}) };
          g.battlefield.push(perm);
          g.events.push({ type: "enters", perm });
        }
      }
      g.log.push(`${p === ctx.item.controller ? "自分" : "相手"}のライブラリーから${picked.length ? ` ${picked.map((c) => c.name).join("、")} を` : "何も"}${a.to === "hand" ? "手札に" : "戦場に"}${picked.length ? "置いた" : "置かなかった"}`);
      if (a.shuffle !== false) {
        const lib = g.libraries[p];
        for (let i = lib.length - 1; i > 0; i--) {
          const j = Math.floor(nextRandom(g) * (i + 1));
          [lib[i], lib[j]] = [lib[j], lib[i]];
        }
      }
      return { id: picked.map((c) => c.id).join(",") };
    },
  });

  // 墓地のカードを追放する。「してもよい」は optional=true (断れる)。追放できたら枚数を n に出す (「そうしたなら」は、次のノードに if=$名前)
  node({
    id: "exile",
    title: "追放する",
    summary: "自分の墓地のカードを count 枚、追放する (足りなければ何もしない)。optional=true なら「してもよい」(断れる)。追放できた枚数を n として出力する(0 なら追放していない)。「そうしたなら〜」は、これを as=名前 で受けて、次のノードに if=$名前 を付ける。shortcut: 追放するカードは墓地の古いものから (選べるのは、判断の入力を作るとき)",
    params: { zone: { type: "string", required: true, choices: ["graveyard"] }, count: { type: "number", required: true, min: 1 }, optional: { type: "boolean" } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const p = ctx.item.controller;
      const n = Number(a.count);
      if (g.graveyards[p].length < n) return { n: 0 };
      if (a.optional === true && !(g.decide?.may?.(g, p, "exile") ?? true)) return { n: 0 };
      g.exile[p].push(...g.graveyards[p].splice(0, n));
      return { n };
    },
  });
}
