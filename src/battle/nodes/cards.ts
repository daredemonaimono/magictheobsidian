import { characteristics } from "../continuous";
import { NodeDef, Value } from "../node";
import { defineNode as define } from "../registry";
import { nextRandom } from "../rng";
import { discardCards, drawCards, putInGraveyard, Game, Perm, typeIn } from "../state";
import { enterBattlefield, removeFromBattlefield } from "../engine/battlefield";
import { enterBlocked, entersTapped } from "../engine/restrict";
import { who as logWho } from "../engine/shared";
import { findCard, idList, playersFor, takeCard, targetPlayer, who, zoneOf } from "./shared";

// ノード: カードの移動・ライブラリー・手札
const CATEGORY = "カードの移動・ライブラリー・手札";
const node = (def: Omit<NodeDef, "category">) => define({ ...def, category: CATEGORY });

export function registerCards(): void {
  // 引く。ライブラリーが足りなければ、引ける分だけ引いて記録を残す
  node({
    id: "draw",
    title: "引く",
    summary: "プレイヤーがカードを count 枚引く。player=you(呪文のコントローラー) / opponents(全相手) / target(target ノードで選んだプレイヤー。target=$名前 を渡す)。optional=true なら「引いてもよい」(player=you のとき、引くかどうかを選ぶ)。引いた枚数を出力する (「そうしたなら」は if=$名前)",
    params: { player: who, target: targetPlayer, count: { type: "number", required: true, min: 0 }, optional: { type: "boolean" } },
    outputs: { n: "number" },
    run: (ctx, a): Record<string, Value> => {
      if (a.optional === true && !(ctx.game.decide?.may?.(ctx.game, ctx.item.controller, `カードを ${Number(a.count)} 枚、追加で引きますか?`) ?? true)) return { n: 0 };
      for (const p of playersFor(ctx, a)) {
        drawCards(ctx.game, p, Number(a.count), ctx.rules);
        if (Number(a.count) > 0) ctx.game.log.push(`${logWho(p)}がカードを ${a.count} 枚引いた`);
      }
      return { n: Number(a.count) };
    },
  });

  // 捨てる。捨てるカードは g.decide.discard で選べる。既定は手札の後ろから (shortcut: 本来は持ち主が選ぶ。判断の入力を作るときに置き換える)
  node({
    id: "discard",
    title: "捨てる",
    summary: "プレイヤーが手札を count 枚捨てる(捨てるカードは、そのプレイヤーが選ぶ)。player=you / opponents / target(draw と同じ)。count のかわりに cards(選んだカードの id。choose の出力)を書くと、そのカードを捨てさせる(「1枚選ぶ。そのプレイヤーはそれを捨てる」Grief)",
    params: { player: who, target: targetPlayer, count: { type: "number", min: 0 }, cards: { type: "ref" } },
    outputs: {},
    check: (a) => (a.count !== undefined || a.cards !== undefined ? null : "count か cards が要る"),
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      if (a.cards !== undefined) {
        for (const id of idList(a.cards)) {
          const p = Object.keys(g.hands).find((q) => g.hands[q].some((c) => c.id === id));
          const c = p ? g.hands[p].find((x) => x.id === id) : undefined;
          if (!p || !c) continue;
          g.hands[p] = g.hands[p].filter((x) => x !== c);
          putInGraveyard(g, c, "hand");
          g.log.push(`${logWho(p)}は ${c.name} を捨てた`);
        }
        return {};
      }
      for (const p of playersFor(ctx, a)) discardCards(g, p, Number(a.count));
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
    summary: "cards(look / choose の出力)を、持ち主の to へ動かす。to=hand / graveyard / top(ライブラリーの一番上) / bottom(一番下) / battlefield(持ち主のコントロールで、戦場へ。tapped=true でタップ状態。「墓地から出られない」の制限に従う)。optional=true なら「してもよい」(断れる)。except に渡したカードは動かさない(「残りを底に」)。random=true で、ランダムな順で(「ランダムな順番でライブラリーの一番下に置く」)",
    params: { cards: { type: "ref", required: true }, except: { type: "ref" }, to: { type: "string", required: true, choices: ["hand", "graveyard", "top", "bottom", "battlefield"] }, random: { type: "boolean" }, tapped: { type: "boolean" }, optional: { type: "boolean" } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      if (a.optional === true && !(g.decide?.may?.(g, ctx.item.controller, "move") ?? true)) return {};
      const skip = new Set(idList(a.except));
      let list = idList(a.cards).filter((id) => !skip.has(id));
      if (a.random === true) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(nextRandom(g) * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } // ランダムな順で
      else if ((a.to === "top" || a.to === "bottom") && list.length > 1) {
        // 好きな順番で (上から下へ)。入力が無ければ、並んでいる順
        const cards = list.flatMap((id) => findCard(g, id) ?? []);
        const got = g.decide?.order?.(g, ctx.item.controller, cards, a.to)?.map((c) => c.id);
        if (got && got.length === list.length && list.every((id) => got.includes(id))) list = got;
      }
      if (a.to === "top") list.reverse(); // 順番を保ったまま一番上に積む
      for (const id of list) {
        const from = zoneOf(g, id);
        if (a.to === "battlefield") {
          const c0 = findCard(g, id);
          if (!c0 || enterBlocked(g, ctx.rules, c0, from ?? "")) continue; // 墓地・ライブラリーから出られない (Grafdigger's Cage)
          const c1 = takeCard(g, id)!;
          enterBattlefield(g, c1, c1.owner, ctx.rules, undefined, { from, tapped: a.tapped === true });
          g.log.push(`${c1.name} が戦場に出た`);
          continue;
        }
        const c = takeCard(g, id);
        if (!c) continue;
        if (a.to === "hand") g.hands[c.owner].push(c);
        else if (a.to === "graveyard") putInGraveyard(g, c, from ?? "hand");
        else if (a.to === "top") g.libraries[c.owner].unshift(c);
        else g.libraries[c.owner].push(c);
      }
      return {};
    },
  });

  // ライブラリーの上から N 枚を墓地に置く (切削)。置かれたカードごとに、moved (from=library to=graveyard) を起こす
  node({
    id: "mill",
    title: "切削 (ライブラリーの上から墓地へ)",
    summary: "プレイヤーのライブラリーの上から count 枚を、墓地に置く(足りなければ、ある分だけ)。player=you / opponents / target。置いたカードの id を出力する。置かれたカードは「ライブラリーから墓地に置かれた」(Narcomoeba・Creeping Chill が誘発する)",
    params: { player: who, target: targetPlayer, count: { type: "number", required: true, min: 1 } },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const out: string[] = [];
      for (const p of playersFor(ctx, a)) {
        const top = g.libraries[p].splice(0, Number(a.count));
        for (const c of top) putInGraveyard(g, c, "library");
        out.push(...top.map((c) => c.id));
        g.log.push(`${logWho(p)}のライブラリーの上から ${top.length} 枚を墓地に置いた${top.length ? ` (${top.map((c) => c.name).join("、")})` : ""}`);
      }
      return { id: out.join(",") };
    },
  });

  // 手札に戻す。戦場のパーマネントを、持ち主の手札へ。対象が戦場に無ければ何もしない
  // プレイヤーの墓地・手札のカード (id の並び)
  node({
    id: "zoneCards",
    title: "墓地・手札のカード",
    summary: "プレイヤーの墓地(zone=graveyard)または手札(zone=hand)のカードすべての id を出力する。player=you / opponents / target(draw と同じ)。move の cards に渡す(「墓地のカードをすべてライブラリーの一番下に置く」は move to=bottom random=true)",
    params: { zone: { type: "string", required: true, choices: ["graveyard", "hand"] }, player: who, target: targetPlayer },
    outputs: { id: "id" },
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      return { id: playersFor(ctx, a).flatMap((p) => (a.zone === "hand" ? g.hands[p] : g.graveyards[p])).map((c) => c.id).join(",") };
    },
  });

  // このターンに引いたカード (まだ手札にあるもの)
  node({
    id: "drawnCards",
    title: "このターンに引いたカード",
    summary: "コントローラーが、このターンに引いて、まだ手札にあるカードすべての id を出力する(choose の from に渡す。Sylvan Library)",
    params: {},
    outputs: { id: "id" },
    run: (ctx): Record<string, Value> => {
      const g = ctx.game;
      const p = ctx.item.controller;
      const drawn = new Set(g.drawn?.[p] ?? []);
      return { id: g.hands[p].filter((c) => drawn.has(c.id)).map((c) => c.id).join(",") };
    },
  });

  // 1枚ずつ、ライフを払うか、ライブラリーに戻すか
  node({
    id: "payOrMove",
    title: "ライフを払うか、動かす",
    summary: "cards(choose などの出力)の1枚ごとに、コントローラーが life 点のライフを払う(そのカードは手札に残る)か、払わずに、そのカードを to(top / bottom)に置くかを選ぶ。払うか聞かれたら、既定は払わない(Sylvan Library は life=4 to=top)",
    params: { cards: { type: "ref", required: true }, life: { type: "number", required: true, min: 1 }, to: { type: "string", required: true, choices: ["top", "bottom"] } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const p = ctx.item.controller;
      const back: string[] = [];
      for (const id of idList(a.cards)) {
        const c = g.hands[p].find((x) => x.id === id);
        if (!c) continue;
        const can = g.life[p] >= Number(a.life);
        if (can && (g.decide?.may?.(g, p, `${c.name}: ${a.life} 点のライフを払って、手札に残しますか? (払わないと、ライブラリーの${a.to === "top" ? "一番上" : "一番下"}に置く)`) ?? false)) {
          g.life[p] -= Number(a.life);
          g.log.push(`${a.life} 点のライフを払って、${c.name} を手札に残した`);
        } else back.push(id);
      }
      for (const id of (a.to === "top" ? [...back].reverse() : back)) {
        const c = takeCard(g, id);
        if (c) (a.to === "top" ? g.libraries[c.owner].unshift(c) : g.libraries[c.owner].push(c));
      }
      if (back.length) g.log.push(`${back.length} 枚を、ライブラリーの${a.to === "top" ? "一番上" : "一番下"}に置いた`);
      return {};
    },
  });

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
        ctx.game.events.push({ type: "leaves", perm: gone, to: "hand" });
      }
      return {};
    },
  });

  // 破壊する。対象 (戦場のパーマネント) を、墓地へ (トークンは消える)。破壊不能は、破壊されない。対象が戦場に無ければ、何もしない
  node({
    id: "sacrifice",
    title: "生け贄に捧げる",
    summary: "コントローラーが、対象のパーマネント(自分のもの。self ノードの出力で「これを生け贄に捧げる」)を生け贄に捧げる(持ち主の墓地へ。破壊不能でも捧げられる)。他人のパーマネントは、捧げられない",
    params: { target: { type: "ref", required: true } },
    outputs: {},
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      for (const id of idList(a.target)) {
        const perm = g.battlefield.find((p) => p.id === id && p.controller === ctx.item.controller);
        if (!perm) continue;
        removeFromBattlefield(g, perm);
        g.log.push(`${perm.card.name} を生け贄に捧げた`);
      }
      return {};
    },
  });

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
        removeFromBattlefield(g, perm);
        g.log.push(`${perm.card.name} を破壊した`);
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
      const options = g.libraries[p].filter((c) => (typeof a.type !== "string" || typeIn(c.typeLine, a.type)) && (typeof a.name !== "string" || c.name === a.name) && !(a.to === "battlefield" && enterBlocked(g, ctx.rules, c, "library"))); // Grafdigger's Cage
      const n = Math.min(typeof a.count === "number" ? a.count : 1, options.length);
      // 選ぶのは、探す人。入力が無い (相手・自動) ときは、先頭から。断る (0 枚) こともできる
      const picked = (g.decide?.choose?.(g, p, options, n, true) ?? options.slice(0, n)).filter((c) => options.includes(c)).slice(0, n);
      for (const c of picked) {
        g.libraries[p] = g.libraries[p].filter((x) => x !== c);
        if (a.to === "hand") g.hands[p].push(c);
        else {
          const perm: Perm = { id: c.id, card: c, controller: p, enteredTurn: g.turn, ...(a.tapped === true || entersTapped(g, ctx.rules, c, p) ? { tapped: true } : {}), ...(c.loyalty !== undefined ? { counters: { loyalty: c.loyalty } } : {}) };
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
    summary: "追放する。target=(対象・select の出力・self) があれば、戦場のそのパーマネント (戦場に無ければ、墓地のそのカード) を追放する (トークンは消える)。無ければ、自分の墓地のカードを count 枚(zone=graveyard。足りなければ何もしない)。optional=true なら「してもよい」(断れる)。追放できた枚数を n として出力する(0 なら追放していない)。「そうしたなら〜」は、これを as=名前 で受けて、次のノードに if=$名前 を付ける。「追放して、そのパワーに等しいライフを得る」は、追放の前に statOf・controllerOf で読んでおく。shortcut: 墓地から追放するカードは、古いものから (選べるのは、判断の入力を作るとき)",
    params: { target: { type: "ref" }, zone: { type: "string", choices: ["graveyard"] }, count: { type: "number", min: 1 }, optional: { type: "boolean" } },
    outputs: { n: "number" },
    check: (a) => (a.target !== undefined || (a.zone !== undefined && a.count !== undefined) ? null : "target か、(zone と count) の、どちらかが要る"),
    run: (ctx, a): Record<string, Value> => {
      const g = ctx.game;
      const p = ctx.item.controller;
      if (a.target !== undefined) {
        let n = 0;
        if (a.optional === true && !(g.decide?.may?.(g, p, "exile") ?? true)) return { n: 0 };
        for (const id of idList(a.target)) {
          const perm = g.battlefield.find((x) => x.id === id);
          if (!perm) {
            // 戦場に無ければ、墓地のカード (そのカード自身を追放する誘発など)
            const gy = Object.values(g.graveyards).flat().find((c) => c.id === id);
            if (!gy) continue;
            g.graveyards[gy.owner] = g.graveyards[gy.owner].filter((c) => c !== gy);
            g.exile[gy.owner].push(gy);
            g.log.push(`${gy.name} を墓地から追放した`);
            n++;
            continue;
          }
          g.battlefield = g.battlefield.filter((x) => x !== perm);
          if (!perm.card.token) g.exile[perm.card.owner].push(perm.card);
          g.log.push(`${perm.card.name} を追放した`);
          g.events.push({ type: "leaves", perm, to: "exile" });
          n++;
        }
        return { n };
      }
      const n = Number(a.count);
      if (g.graveyards[p].length < n) return { n: 0 };
      if (a.optional === true && !(g.decide?.may?.(g, p, "exile") ?? true)) return { n: 0 };
      g.exile[p].push(...g.graveyards[p].splice(0, n));
      return { n };
    },
  });
}
