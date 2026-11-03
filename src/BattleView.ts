import { ItemView, Notice, WorkspaceLeaf, moment, normalizePath } from "obsidian";
import { BattleDeck, deckFiles, loadBattleDeck } from "./battledeck";
import { botBus } from "./botbus";
import { cardEl } from "./cardEl";
import { MODELS, askClaude } from "./claude";
import { Answer, Block, Card, Controller, Decision, Game, Perm, Phase, PriorityAction, isCreature, isLand } from "./engine";
import { fileSafe } from "./scryfall";
import { Settings } from "./settings";

export const BATTLE_VIEW = "mtg-battle";
const GAME_DIR = "Bot/Games";

const PHASES: [Phase, string][] = [
  ["upkeep", "アップキープ"],
  ["draw", "ドロー"],
  ["main1", "メイン1"],
  ["beginCombat", "戦闘開始"],
  ["attackers", "攻撃"],
  ["blockers", "ブロック"],
  ["damage", "ダメージ"],
  ["endCombat", "戦闘終了"],
  ["main2", "メイン2"],
  ["end", "終了"],
];

const SYSTEM = `あなたは Magic: The Gathering の対戦相手(プレイヤー2)。人間のプレイヤー1と1対1で戦い、勝つことを目指す。
この対戦エンジンはまだ簡易版で、次のルールで動く:
- 土地は1ターンに1枚。クリーチャーは出したターンに攻撃できない(速攻は例外)。飛行は飛行か到達を持つクリーチャーだけがブロックできる。
- 呪文の効果と、クリーチャーの能力(出たとき等)はまだ実行されない。インスタント・ソーサリーは唱えると墓地に行くだけ。実際に働くのは、パワー/タフネスと、飛行・速攻・警戒だけ。
- つまり、クリーチャーを出して、攻撃とブロックでライフを削り合うゲーム。
デッキの使い方のメモを読み、その方針に沿って、いちばん勝てる行動を選ぶ。
返事は JSON を1つだけ。説明や前置きは書かない。`;

// 返事の中から "key": [ ... ] の配列を取り出す (理由の文にマナ記号などが入っても壊れないように、括弧の対応で切り出す)
function arrayOf(text: string, key: string): unknown[] | null {
  const i = text.indexOf(`"${key}"`);
  const start = i < 0 ? -1 : text.indexOf("[", i);
  if (start < 0) return null;
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    if (text[j] === "[") depth++;
    else if (text[j] === "]" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, j + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// 人 (プレイヤー1) と、ボット (プレイヤー2) の対戦 (仮)
export class BattleView extends ItemView {
  private myPath = "";
  private botPath = "";
  private model = this.settings.botModel;
  private think = false;
  private game?: Game;
  private running = false;
  private stopFlag = false;
  private pending?: { d: Decision; resolve: (a: Answer) => void; reject: (e: Error) => void };
  private sel = new Set<number>(); // 攻撃宣言で選んだ uid / ブロック待ちの自分のクリーチャー
  private pairs: Block[] = [];
  private blocker?: number;
  private chooser?: { label: string; action: PriorityAction }[]; // 1枚で複数の行動があるとき、選ばせる
  private thinking = false;
  private stats = { calls: 0, tokens: 0, cost: 0 };
  private result = "";
  private board!: HTMLElement;
  private infoEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private settings: Settings, private getKey: () => string | null) {
    super(leaf);
  }

  getViewType() {
    return BATTLE_VIEW;
  }
  getDisplayText() {
    return "Bot 対戦 (仮)";
  }
  getIcon() {
    return "swords";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-bot");
    root.createEl("h3", { text: "Bot 対戦(仮)" });
    root.createDiv({ text: "あなたがプレイヤー1(先攻)、ボットがプレイヤー2。呪文の効果はまだ実行されない。クリーチャーを出して、攻撃とブロックで戦う。", cls: "mtg-dim" });
    const bar = root.createDiv("mtg-botbar");
    const pick = (label: string, set: (v: string) => void, cur: string) => {
      const sel = bar.createEl("select", { attr: { "aria-label": label } });
      sel.createEl("option", { text: label, value: "" });
      for (const f of deckFiles(this.app)) sel.createEl("option", { text: f.basename, value: f.path });
      sel.value = cur;
      sel.onchange = () => set(sel.value);
    };
    pick("自分のデッキ", (v) => (this.myPath = v), this.myPath);
    pick("ボットのデッキ", (v) => (this.botPath = v), this.botPath);
    const modelSel = bar.createEl("select", { attr: { "aria-label": "モデル" } });
    for (const [id, m] of Object.entries(MODELS)) modelSel.createEl("option", { text: m.label, value: id });
    modelSel.value = this.model;
    modelSel.onchange = () => (this.model = modelSel.value);
    const thinkSel = bar.createEl("select", { attr: { "aria-label": "思考" } });
    thinkSel.createEl("option", { text: "思考浅め", value: "off" });
    thinkSel.createEl("option", { text: "思考深め", value: "on" });
    thinkSel.onchange = () => (this.think = thinkSel.value === "on");
    bar.createEl("button", { text: "開始", cls: "mod-cta" }).onclick = () => void this.start();
    bar.createEl("button", { text: "停止" }).onclick = () => this.stop();
    this.infoEl = root.createDiv("mtg-botinfo");
    this.board = root.createDiv("mtg-botboard");
    this.render();
  }

  onClose() {
    this.stop();
    return Promise.resolve();
  }

  private stop() {
    this.stopFlag = true;
    this.pending?.reject(new Error("停止"));
    this.pending = undefined;
  }

  // ---- 対戦の進行 ----

  private async start() {
    if (this.running) return void new Notice("対戦中");
    const mine = deckFiles(this.app).find((f) => f.path === this.myPath);
    const theirs = deckFiles(this.app).find((f) => f.path === this.botPath);
    if (!mine || !theirs) return void new Notice("自分とボットのデッキを選ぶ");
    const key = this.getKey();
    if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
    const [a, b] = [await loadBattleDeck(this.app, mine), await loadBattleDeck(this.app, theirs)];
    if (a.defs.length < 7 || b.defs.length < 7) return void new Notice("メインのカードが7枚未満のデッキがある");
    const missing = a.noStats + b.noStats;
    if (missing) new Notice(`パワー・タフネスが無いクリーチャーが ${missing} 種ある (0/0 として扱う)。デッキ画面の「情報取得」で補える`, 8000);

    this.running = true;
    this.stopFlag = false;
    this.stats = { calls: 0, tokens: 0, cost: 0 };
    this.result = "";
    botBus.clear();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const g = (this.game = new Game([a.defs, b.defs], seed, [this.human, this.bot(b, key)], [true, false]));
    g.onLog = (l) => botBus.addLog(l);
    g.onChange = () => this.render();
    botBus.addLog(`あなた: ${a.name} / ボット: ${b.name} (${MODELS[this.model].label}, ${this.think ? "思考深め" : "思考浅め"})`);
    this.render();
    try {
      await g.play(60);
      const w = g.s.winner;
      this.result = w === undefined ? "ターン上限で終了" : w === -1 ? "引き分け" : w === 0 ? "あなたの勝ち" : "ボットの勝ち";
    } catch (e) {
      this.result = (e as Error).message === "停止" ? "停止した" : `エラーで停止: ${(e as Error).message}`;
      botBus.addLog(this.result);
    } finally {
      this.running = false;
      this.pending = undefined;
      this.thinking = false;
      await this.save(g, a.name, b.name).catch((e) => botBus.addLog(`ログの保存に失敗: ${(e as Error).message}`));
      this.render();
    }
  }

  // 対戦のログ。リプレイ用に、seed と全員の答えの列も JSON で残す (同じ seed と答えで同じ展開になる)
  private async save(g: Game, mine: string, theirs: string) {
    const vault = this.app.vault;
    for (const dir of ["Bot", GAME_DIR]) if (!vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
    const path = normalizePath(`${GAME_DIR}/${moment().format("YYYY-MM-DD HHmmss")} ${fileSafe(mine)} vs ${fileSafe(theirs)}.md`);
    const body = [
      "---",
      "mtg: bot-battle",
      `deck: "[[${mine}]]"`,
      `bot_deck: "[[${theirs}]]"`,
      `model: ${this.model}`,
      `thinking: ${this.think}`,
      `turns: ${g.s.turn}`,
      `result: ${this.result}`,
      `calls: ${this.stats.calls}`,
      `tokens: ${this.stats.tokens}`,
      `cost_usd: ${this.stats.cost.toFixed(5)}`,
      "tags: [mtg/bot-battle]",
      "---",
      "",
      "## ログ",
      "",
      ...g.s.log.map((l) => `- ${l}`),
      "",
      "## リプレイ用データ",
      "",
      "```json",
      JSON.stringify({ version: 2, seed: g.seed, decks: [mine, theirs], steps: g.history }, null, 1),
      "```",
      "",
    ].join("\n");
    const file = await vault.create(path, body);
    botBus.addLog(`ログを保存: ${file.path}`);
  }

  // ---- 人の操作 ----

  private human: Controller = (_g, d) =>
    new Promise((resolve, reject) => {
      this.sel.clear();
      this.pairs = [];
      this.blocker = undefined;
      this.chooser = undefined;
      this.pending = { d, resolve, reject };
      this.render();
    });

  private answer(a: Answer) {
    const p = this.pending;
    if (!p) return;
    this.pending = undefined;
    p.resolve(a);
    this.render();
  }

  // ---- ボット ----

  private describe(g: Game, me: number): string {
    const s = g.s;
    const names = (cs: Card[]) => (cs.length ? cs.map((c) => c.def.name).join(", ") : "なし");
    const perm = (p: Perm) =>
      `${p.def.name}${isCreature(p.def) ? ` ${p.def.power}/${p.def.toughness}` : ""}${p.def.keywords.length ? ` [${p.def.keywords.join(",")}]` : ""}${p.tapped ? " (タップ)" : ""}${p.sick && isCreature(p.def) ? " (召喚酔い)" : ""}${p.attacking ? " (攻撃中)" : ""}${p.damage ? ` (ダメージ${p.damage})` : ""}`;
    const field = (i: number) => (s.players[i].field.length ? s.players[i].field.map(perm).join(", ") : "なし");
    const you = s.players[me];
    const opp = s.players[1 - me];
    return [
      `ターン ${s.turn} · ${PHASES.find((x) => x[0] === s.phase)![1]} · ${s.active === me ? "あなたのターン" : "相手のターン"}`,
      `ライフ: あなた ${you.life} / 相手 ${opp.life}`,
      `あなたの手札: ${you.hand.map((c) => `${c.def.name}${c.def.manaCost}`).join(", ") || "なし"}`,
      `あなたの場: ${field(me)}`,
      `相手の場: ${field(1 - me)}`,
      `あなたの墓地: ${names(you.graveyard)} / 相手の墓地: ${names(opp.graveyard)}`,
      `相手の手札: ${opp.hand.length} 枚 / 山札: あなた ${you.library.length}, 相手 ${opp.library.length}`,
      `マナプール: あなた ${you.pool.join("") || "なし"}`,
      `スタック: ${s.stack.length ? s.stack.map((x) => (x.ability ? `${x.def.name}の能力` : x.def.name)).join(" → ") : "空"}`,
      `直近のログ:\n${s.log.slice(-8).join("\n")}`,
    ].join("\n");
  }

  private bot(deck: BattleDeck, key: string): Controller {
    const system = `${SYSTEM}\n\n# デッキ: ${deck.name}\n## 使い方のメモ\n${deck.playbook || "(なし)"}\n## カード\n${deck.list}`;
    return async (g, d) => {
      const nameOf = (uid: number) => g.card(uid)?.def.name ?? "?";
      const stat = (uid: number) => {
        const p = g.perm(uid);
        return p ? `${p.def.name} ${p.def.power}/${p.def.toughness}${p.def.keywords.length ? ` [${p.def.keywords.join(",")}]` : ""}` : nameOf(uid);
      };
      const label = (a: PriorityAction) => {
        if (a.kind === "pass") return "パス";
        if (a.kind === "land") return `土地を出す: ${nameOf(a.uid)}`;
        if (a.kind === "cast") return `唱える: ${nameOf(a.uid)}`;
        if (a.kind === "activate") return `起動: ${nameOf(a.uid)}${g.perm(a.uid)?.def.abilities[a.index]?.text ? ` (${g.perm(a.uid)!.def.abilities[a.index].text})` : ""}`;
        return `マナを出す: ${nameOf(a.uid)}`;
      };
      let ask = "";
      if (d.type === "priority") {
        ask = `選べる行動:\n${d.actions.map((a, i) => `${i + 1}. ${label(a)}`).join("\n")}\n返事: {"action": 番号, "reason": "20字以内"}`;
      } else if (d.type === "choice") {
        ask = `${d.prompt}\n選択肢:\n${d.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n返事: {"choice": 番号, "reason": "20字以内"}`;
      } else if (d.type === "attackers") {
        ask = `攻撃できるクリーチャー:\n${d.eligible.map((u, i) => `${i + 1}. ${stat(u)}`).join("\n")}\n攻撃するものの番号を配列で。攻撃しないなら []。返事: {"attack": [番号...], "reason": "20字以内"}`;
      } else {
        ask = `攻撃してくる:\n${d.attackers.map((u, i) => `${i + 1}. ${stat(u)}`).join("\n")}\nブロックできる:\n${d.eligible.map((u, i) => `${i + 1}. ${stat(u)}`).join("\n")}\nブロックしないなら []。返事: {"blocks": [[ブロッカーの番号, 攻撃の番号], ...], "reason": "20字以内"}`;
      }
      const fallback: Answer = d.type === "priority" ? d.actions[d.actions.length - 1] : d.type === "choice" ? 0 : [];
      for (let tries = 0; tries < 2; tries++) {
        if (this.stopFlag) throw new Error("停止");
        this.thinking = true;
        this.render();
        const r = await askClaude(key, this.model, system, `${this.describe(g, 1)}\n\n${ask}`, this.think);
        this.thinking = false;
        this.stats.calls++;
        this.stats.tokens += r.inTokens + r.outTokens;
        this.stats.cost += r.cost;
        const why = r.text.match(/"reason"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/)?.[1] ?? "";
        const note = (what: string) => botBus.addLog(`[ボット] ${why ? `${why} → ` : ""}${what}  (入力 ${r.inTokens} / 出力 ${r.outTokens}, $${r.cost.toFixed(4)})`);
        if (d.type === "priority") {
          const n = Number(r.text.match(/"action"\s*:\s*"?(\d+)/)?.[1]);
          const a = d.actions[n - 1];
          if (a) return note(label(a)), a;
        } else if (d.type === "choice") {
          const n = Number(r.text.match(/"choice"\s*:\s*"?(\d+)/)?.[1]);
          if (n >= 1 && n <= d.options.length) return note(d.options[n - 1]), n - 1;
        } else if (d.type === "attackers") {
          const arr = arrayOf(r.text, "attack");
          if (arr) {
            const uids = arr.map((n) => d.eligible[Number(n) - 1]).filter((u) => u !== undefined);
            return note(uids.length ? `攻撃 ${uids.map(nameOf).join(", ")}` : "攻撃しない"), uids;
          }
        } else if (d.type === "blockers") {
          const arr = arrayOf(r.text, "blocks");
          if (arr) {
            const blocks = arr
              .map((x) => (Array.isArray(x) ? { blocker: d.eligible[Number(x[0]) - 1], attacker: d.attackers[Number(x[1]) - 1] } : undefined))
              .filter((b): b is Block => !!b && b.blocker !== undefined && b.attacker !== undefined);
            return note(blocks.length ? `ブロック ${blocks.map((b) => `${nameOf(b.blocker)}→${nameOf(b.attacker)}`).join(", ")}` : "ブロックしない"), blocks;
          }
        }
        botBus.addLog(`[ボット] 返事を読めず (${tries + 1}回目): ${r.text.slice(0, 200).replace(/\n/g, " ")}`);
      }
      botBus.addLog("[ボット] 読めなかったので、何もしない");
      return fallback;
    };
  }

  // ---- 画面 ----

  private perm(parent: HTMLElement, p: Perm, opts: { cls?: string; onClick?: () => void } = {}) {
    const el = cardEl(this.app, parent, p.def, `${p.tapped ? "is-tapped" : ""} ${opts.cls ?? ""}`);
    if (isCreature(p.def)) el.createSpan({ text: `${p.def.power}/${p.def.toughness}${p.damage ? ` (-${p.damage})` : ""}`, cls: "mtg-bbadge" });
    if (opts.onClick) el.onclick = opts.onClick;
    return el;
  }

  // 自分のカードをクリックして、マナを出す / 能力を起動する。行動が複数なら選ばせる
  private acts(perm: Perm): { cls?: string; onClick?: () => void } {
    const p = this.pending;
    if (!p || p.d.type !== "priority" || perm.controller !== 0) return {};
    const list = p.d.actions.filter((a): a is Extract<PriorityAction, { kind: "tapMana" | "activate" }> => (a.kind === "tapMana" || a.kind === "activate") && a.uid === perm.uid);
    if (!list.length) return {};
    const label = (a: (typeof list)[number]) => (a.kind === "tapMana" ? `マナを出す${a.color ? ` (${a.color})` : ""}` : `起動: ${perm.def.abilities[a.index]?.text ?? "能力"}`);
    return {
      cls: "is-playable",
      onClick: () => {
        if (list.length === 1) return this.answer(list[0]);
        this.chooser = list.map((a) => ({ label: `${perm.def.name}: ${label(a)}`, action: a }));
        this.render();
      },
    };
  }

  private side(parent: HTMLElement, g: Game, i: number) {
    const s = g.s;
    const pl = s.players[i];
    const me = i === 0;
    const box = parent.createDiv(`mtg-bside${me ? "" : " is-opp"}`);
    const head = box.createDiv({ text: `${me ? "あなた" : "ボット"}  ライフ ${pl.life}  ·  手札 ${pl.hand.length}  ·  山札 ${pl.library.length}${pl.pool.length ? `  ·  マナ ${pl.pool.join("")}` : ""}`, cls: "mtg-bhead" });
    if (s.active === i) head.createSpan({ text: "  ▶ ターン", cls: "mtg-dim" });
    const main = box.createDiv("mtg-bmain");
    const field = main.createDiv("mtg-bfield");
    const others = field.createDiv("mtg-brow");
    const lands = field.createDiv("mtg-brow");
    const piles = main.createDiv("mtg-bpiles");
    const p = this.pending;
    const attacking = me && p?.d.type === "attackers";
    const blocking = me && p?.d.type === "blockers";
    for (const perm of pl.field.filter((x) => !isLand(x.def))) {
      const cls: string[] = [];
      let click: (() => void) | undefined;
      if (attacking && p!.d.type === "attackers" && p!.d.eligible.includes(perm.uid)) {
        cls.push("is-playable", this.sel.has(perm.uid) ? "is-selected" : "");
        click = () => (this.sel.has(perm.uid) ? this.sel.delete(perm.uid) : this.sel.add(perm.uid), this.render());
      } else if (blocking && p!.d.type === "blockers" && p!.d.eligible.includes(perm.uid)) {
        cls.push("is-playable", this.blocker === perm.uid ? "is-selected" : "");
        click = () => ((this.blocker = perm.uid), this.render());
      } else if (!me && p?.d.type === "blockers" && p.d.attackers.includes(perm.uid)) {
        const paired = this.pairs.find((x) => x.attacker === perm.uid);
        cls.push("is-playable", paired ? "is-selected" : "");
        click = () => {
          if (this.blocker === undefined) return;
          this.pairs = this.pairs.filter((x) => x.attacker !== perm.uid && x.blocker !== this.blocker);
          this.pairs.push({ attacker: perm.uid, blocker: this.blocker });
          this.blocker = undefined;
          this.render();
        };
      }
      if (!click) {
        const a = this.acts(perm);
        click = a.onClick;
        if (a.cls) cls.push(a.cls);
      }
      this.perm(others, perm, { cls: cls.join(" "), onClick: click });
    }
    for (const perm of pl.field.filter((x) => isLand(x.def))) this.perm(lands, perm, this.acts(perm));
    const pile = (title: string, cards: Card[], faceUp: boolean) => {
      const b = piles.createDiv("mtg-bpile");
      b.createDiv({ text: `${title} ${cards.length}`, cls: "mtg-dim" });
      if (!cards.length) b.createDiv({ cls: "mtg-bcard is-empty" });
      else if (faceUp) cardEl(this.app, b, cards[cards.length - 1].def);
      else b.createDiv({ cls: "mtg-bcard is-back" });
    };
    pile("墓地", pl.graveyard, true);
    if (me) {
      const hand = box.createDiv("mtg-brow mtg-bhand");
      for (const c of pl.hand) {
        const acts = p?.d.type === "priority" ? p.d.actions.filter((a) => (a.kind === "land" || a.kind === "cast") && g.card(a.uid)?.def.key === c.def.key) : [];
        const ready = acts.find((a) => a.kind === "land" || (a.kind === "cast" && a.tap.length === 0)); // プールで払える
        const soft = acts.find((a) => a.kind === "cast" && a.tap.length > 0); // 土地をタップすれば唱えられる
        const el = cardEl(this.app, hand, c.def, ready ? "is-playable" : soft ? "is-soft" : "");
        if (ready) el.onclick = () => this.answer(ready);
        else if (soft) el.onclick = () => new Notice("先に土地などをクリックして、マナを出す");
      }
    } else {
      const hand = box.createDiv("mtg-brow mtg-bhand");
      for (let k = 0; k < pl.hand.length; k++) hand.createDiv({ cls: "mtg-bcard is-back is-small" });
    }
  }

  private render() {
    const g = this.game;
    this.infoEl.setText(g ? `ターン ${g.s.turn}${this.result ? ` · ${this.result}` : ""} · ボット呼び出し ${this.stats.calls} 回 · ${this.stats.tokens} トークン · $${this.stats.cost.toFixed(4)}` : "");
    this.board.empty();
    if (!g) return void this.board.createDiv({ text: "デッキを2つ選んで開始", cls: "mtg-dim" });
    const s = g.s;
    this.side(this.board, g, 1);
    const mid = this.board.createDiv("mtg-bmid");
    const steps = mid.createDiv("mtg-bsteps");
    for (const [ph, label] of PHASES) steps.createSpan({ text: label, cls: ph === s.phase && !this.result ? "is-on" : "" });
    if (s.stack.length) {
      const st = mid.createDiv("mtg-brow");
      st.createSpan({ text: "スタック: ", cls: "mtg-dim" });
      for (const x of s.stack) cardEl(this.app, st, x.def, x.ability ? "is-small" : "");
    }
    const prompt = mid.createDiv("mtg-bprompt");
    const p = this.pending;
    if (this.result) prompt.createSpan({ text: this.result });
    else if (!p) prompt.createSpan({ text: this.thinking ? "ボットが考え中…" : "…" });
    else if (p.d.type === "priority") {
      if (this.chooser) {
        for (const c of this.chooser) prompt.createEl("button", { text: c.label }).onclick = () => this.answer(c.action);
        prompt.createEl("button", { text: "やめる" }).onclick = () => ((this.chooser = undefined), this.render());
        return void this.side(this.board, g, 0);
      }
      prompt.createSpan({ text: s.stack.length ? "あなたの優先権 (スタックにある)" : "あなたの優先権: 土地などをクリックしてマナを出し、光るカードを出す" });
      prompt.createEl("button", { text: s.stack.length ? "解決へ(パス)" : s.phase.startsWith("main") ? "メイン終了(パス)" : "パス", cls: "mod-cta" }).onclick = () => this.answer({ kind: "pass" });
    } else if (p.d.type === "choice") {
      prompt.createSpan({ text: p.d.prompt });
      p.d.options.forEach((o, i) => (prompt.createEl("button", { text: o }).onclick = () => this.answer(i)));
    } else if (p.d.type === "attackers") {
      prompt.createSpan({ text: "攻撃するクリーチャーを選ぶ" });
      prompt.createEl("button", { text: `攻撃宣言 (${this.sel.size}体)`, cls: "mod-cta" }).onclick = () => this.answer([...this.sel]);
      prompt.createEl("button", { text: "攻撃しない" }).onclick = () => this.answer([]);
    } else {
      prompt.createSpan({ text: "自分のブロッカーを選び、相手の攻撃クリーチャーを選ぶ" + (this.pairs.length ? ` (${this.pairs.length}組)` : "") });
      prompt.createEl("button", { text: "ブロック確定", cls: "mod-cta" }).onclick = () => this.answer([...this.pairs]);
      prompt.createEl("button", { text: "ブロックしない" }).onclick = () => this.answer([]);
    }
    this.side(this.board, g, 0);
  }
}
