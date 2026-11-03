import { ItemView, Notice, WorkspaceLeaf, moment, normalizePath } from "obsidian";
import { botBus } from "./botbus";
import { Action, BCard, Game, LoadedDeck, apply, decks, endTurn, legalActions, loadDeck, newGame, startTurn, stateText } from "./botgame";
import { cardImage, cardInfo } from "./cards";
import { MODELS, askClaude } from "./claude";
import { fileSafe } from "./scryfall";
import { Settings } from "./settings";

export const BOT_VIEW = "mtg-bot";
export const BOT_GAME_DIR = "Bot/Games";

const SYSTEM = `あなたは Magic: The Gathering のプレイヤー。ひとり回しの練習で、自分のデッキを回している。
ルール(練習用の簡略): 土地は1ターンに1枚。土地1枚 = 色を問わず1マナ。呪文は唱えると場(クリーチャー等)か墓地(インスタント・ソーサリー)に行くだけで、効果はまだ実行されない。相手はいない。
デッキの使い方のメモに沿って、最も良い行動を選ぶ。
返事は JSON を1つだけ。説明や前置きは書かない: {"action": 番号, "reason": "理由(日本語、20字以内)"}`;

// ボットのひとり回し (試し)。エンジンは使い捨ての簡易版。メイン領域に出る
export class BotView extends ItemView {
  private deckPath = "";
  private model = this.settings.botModel;
  private turns = 8;
  private think = false; // 思考を使うか。使わないと出力が減って安いが、判断は浅くなる
  private running = false;
  private stop = false;
  private game?: Game;
  private info = "";
  private board!: HTMLElement;
  private infoEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private settings: Settings, private getKey: () => string | null) {
    super(leaf);
  }

  getViewType() {
    return BOT_VIEW;
  }
  getDisplayText() {
    return "Bot (試し)";
  }
  getIcon() {
    return "bot";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-bot");
    root.createEl("h3", { text: "Bot ひとり回し(仮)" });
    root.createDiv({ text: "エンジン無しの簡易版。土地は1ターン1枚・1マナ(色は無視)・呪文の効果は実行しない。費用とボットの選び方を見るための試し。", cls: "mtg-dim" });

    const bar = root.createDiv("mtg-botbar");
    const files = decks(this.app);
    const deckSel = bar.createEl("select", { attr: { "aria-label": "デッキ" } });
    deckSel.createEl("option", { text: "デッキを選ぶ", value: "" });
    for (const f of files) deckSel.createEl("option", { text: f.basename, value: f.path });
    deckSel.value = this.deckPath;
    deckSel.onchange = () => (this.deckPath = deckSel.value);
    const modelSel = bar.createEl("select", { attr: { "aria-label": "モデル" } });
    for (const [id, m] of Object.entries(MODELS)) modelSel.createEl("option", { text: m.label, value: id });
    modelSel.value = this.model;
    modelSel.onchange = () => (this.model = modelSel.value);
    const thinkSel = bar.createEl("select", { attr: { "aria-label": "思考" } });
    thinkSel.createEl("option", { text: "思考なし", value: "off" });
    thinkSel.createEl("option", { text: "思考あり(浅い)", value: "on" });
    thinkSel.value = this.think ? "on" : "off";
    thinkSel.onchange = () => (this.think = thinkSel.value === "on");
    bar.createSpan({ text: "ターン数" });
    const turns = bar.createEl("input", { type: "number", attr: { min: "1", max: "30", style: "width:4em" } });
    turns.value = String(this.turns);
    turns.onchange = () => (this.turns = Math.max(1, Math.min(30, Number(turns.value) || 8)));
    const start = bar.createEl("button", { text: "開始", cls: "mod-cta" });
    start.onclick = () => void this.start();
    bar.createEl("button", { text: "停止" }).onclick = () => (this.stop = true);

    this.infoEl = root.createDiv("mtg-botinfo");
    this.board = root.createDiv("mtg-botboard");
    this.renderBoard();
  }

  private imgs = new Map<string, string | null>();

  // カード1枚。画像があれば画像、無ければ名前。カーソルを合わせると右サイドバーに効果が出る
  private card(parent: HTMLElement, c: BCard, cls = "") {
    const el = parent.createDiv({ cls: `mtg-bcard ${cls}` });
    el.createSpan({ text: c.name, cls: "mtg-bcard-name" });
    el.onmouseenter = () => botBus.setHover(c);
    const show = (url: string) => {
      el.empty();
      el.createEl("img", { attr: { src: url, alt: c.name, loading: "lazy" } });
    };
    const known = this.imgs.get(c.key);
    if (known) show(known);
    else if (known === undefined) {
      this.imgs.set(c.key, null);
      const info = cardInfo(this.app, c.key);
      if (info) void cardImage(this.app, info.file).then((u) => u && (this.imgs.set(c.key, u), show(u)));
    }
    return el;
  }

  // 山・墓地: 一番上のカードと枚数
  private pile(parent: HTMLElement, title: string, cards: BCard[], faceUp: boolean) {
    const box = parent.createDiv("mtg-bpile");
    box.createDiv({ text: `${title} ${cards.length}`, cls: "mtg-dim" });
    if (!cards.length) return box.createDiv({ cls: "mtg-bcard is-empty" });
    if (faceUp) this.card(box, cards[cards.length - 1]);
    else box.createDiv({ cls: "mtg-bcard is-back" });
  }

  // 見下ろしの盤面 (仮): 上が相手 (未実装)、下が自分。場は手前に土地、その奥にそれ以外
  private renderBoard() {
    this.infoEl.setText(this.info);
    this.board.empty();
    const g = this.game;
    const side = this.board.createDiv("mtg-bside is-opp");
    side.createDiv({ text: "相手(未実装)  ライフ 20", cls: "mtg-bhead" });
    side.createDiv({ cls: "mtg-bfield" });

    const steps = this.board.createDiv("mtg-bsteps");
    for (const s of ["アンタップ", "アップキープ", "ドロー", "メイン1", "戦闘", "メイン2", "終了"]) steps.createSpan({ text: s, cls: s === "メイン1" && g ? "is-on" : "" });

    const me = this.board.createDiv("mtg-bside");
    const main = me.createDiv("mtg-bmain");
    const field = main.createDiv("mtg-bfield");
    const others = field.createDiv("mtg-brow");
    const lands = field.createDiv("mtg-brow");
    const piles = main.createDiv("mtg-bpiles");
    me.createDiv({ text: `自分  ライフ 20${g ? `  ·  ターン ${g.turn}` : ""}`, cls: "mtg-bhead" });
    const hand = me.createDiv("mtg-brow mtg-bhand");
    if (!g) return void others.createDiv({ text: "デッキを選んで開始", cls: "mtg-dim" });
    g.field.forEach((c) => this.card(others, c));
    g.lands.forEach((l) => this.card(lands, l.card, l.tapped ? "is-tapped" : ""));
    this.pile(piles, "山札", g.library, false);
    this.pile(piles, "墓地", g.graveyard, true);
    g.hand.forEach((c) => this.card(hand, c));
  }

  // 対戦のあとにログを保存する。リプレイ用に、開始時の山札の並びと行動の列も JSON で残す
  private async saveGame(deck: LoadedDeck, g: Game, lines: string[], actions: unknown[], sum: { calls: number; tokens: number; cost: number }) {
    const vault = this.app.vault;
    for (const dir of ["Bot", BOT_GAME_DIR]) if (!vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
    const path = normalizePath(`${BOT_GAME_DIR}/${moment().format("YYYY-MM-DD HHmmss")} ${fileSafe(deck.name)}.md`);
    const body = [
      "---",
      "mtg: bot-game",
      `deck: "[[${deck.name}]]"`,
      `model: ${this.model}`,
      `thinking: ${this.think}`,
      `turns: ${g.turn}`,
      `calls: ${sum.calls}`,
      `tokens: ${sum.tokens}`,
      `cost_usd: ${sum.cost.toFixed(5)}`,
      "tags: [mtg/bot-game]",
      "---",
      "",
      "## ログ",
      "",
      ...lines.map((l) => `- ${l}`),
      "",
      "## リプレイ用データ",
      "",
      "```json",
      JSON.stringify({ version: 1, order: g.order, actions }, null, 1),
      "```",
      "",
    ].join("\n");
    const file = await vault.create(path, body);
    botBus.addLog(`ログを保存: ${file.path}`);
  }

  private async start() {
    if (this.running) return void new Notice("実行中");
    const file = decks(this.app).find((f) => f.path === this.deckPath);
    if (!file) return void new Notice("デッキを選ぶ");
    const key = this.getKey();
    if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
    const deck = await loadDeck(this.app, file);
    if (deck.cards.length < 7) return void new Notice("メインのカードが7枚未満");

    this.running = true;
    this.stop = false;
    botBus.clear();
    const log = (s: string) => botBus.addLog(s);
    let calls = 0;
    let cost = 0;
    let tokens = 0;
    const g = (this.game = newGame(deck.cards));
    const recent: string[] = [];
    const note = (s: string) => (recent.push(s), log(s));
    const actions: unknown[] = []; // リプレイ用: 行動の列
    log(`デッキ: ${deck.name} (${deck.cards.length} 枚) / モデル: ${MODELS[this.model].label} / ${this.think ? "思考あり(浅い)" : "思考なし"}`);
    try {
      for (let t = 0; t < this.turns && !this.stop; t++) {
        startTurn(g).forEach(note);
        for (let step = 0; step < 30 && !this.stop; step++) {
          this.info = `ターン ${g.turn}/${this.turns} · 呼び出し ${calls} 回 · ${tokens} トークン · $${cost.toFixed(4)}`;
          this.renderBoard();
          const acts = legalActions(g);
          let pick: Action = acts[acts.length - 1];
          if (acts.length > 1) {
            const r = await this.decide(key, deck, g, acts, recent);
            calls++;
            cost += r.cost;
            tokens += r.tokens;
            pick = r.pick;
            const turn = g.turn;
            note(`[${turn}] ${r.reason ? `${r.reason} → ` : ""}${apply(g, pick)}  (入力 ${r.inTokens} / 出力 ${r.outTokens}, $${r.cost.toFixed(4)})`);
            actions.push({ turn, kind: pick.kind, key: pick.card?.key, reason: r.reason, in: r.inTokens, out: r.outTokens, cost: r.cost });
          } else {
            note(`[${g.turn}] 選べる行動なし → 自動でターンを終える (呼び出し無し)`);
            actions.push({ turn: g.turn, kind: "pass", auto: true });
          }
          if (pick.kind === "pass") break;
        }
        endTurn(g).forEach(note);
      }
      log(`終了: ${g.turn} ターン · 呼び出し ${calls} 回 · ${tokens} トークン · 合計 $${cost.toFixed(4)}`);
    } catch (e) {
      log(`エラーで停止: ${(e as Error).message}`);
      new Notice(`Bot 停止: ${(e as Error).message}`);
    } finally {
      await this.saveGame(deck, g, recent, actions, { calls, tokens, cost }).catch((e) => botBus.addLog(`ログの保存に失敗: ${(e as Error).message}`));
      this.info = `終了 · 呼び出し ${calls} 回 · ${tokens} トークン · $${cost.toFixed(4)}`;
      this.running = false;
      this.renderBoard();
    }
  }

  // 選べる行動から1つ選ばせる。形式が崩れたら1回だけ聞き直し、それでもだめなら「ターンを終える」
  private async decide(key: string, deck: LoadedDeck, g: Game, acts: Action[], recent: string[]) {
    const system = `${SYSTEM}\n\n# デッキ: ${deck.name}\n## 使い方のメモ\n${deck.playbook || "(なし)"}\n## カード\n${deck.list}`;
    const user = `${stateText(g, recent)}\n\n選べる行動:\n${acts.map((a) => `${a.id}. ${a.label}`).join("\n")}`;
    let cost = 0;
    let inTokens = 0;
    let outTokens = 0;
    for (let tries = 0; tries < 2; tries++) {
      const r = await askClaude(key, this.model, system, user, this.think);
      cost += r.cost;
      inTokens += r.inTokens;
      outTokens += r.outTokens;
      // JSON 全体ではなく "action" の数字と "reason" の文字列だけ拾う (理由にマナ記号 {B} が入ると、JSON として読めなくなるため)
      const n = r.text.match(/"action"\s*:\s*"?(\d+)/);
      const pick = acts.find((a) => a.id === Number(n?.[1]));
      if (pick) return { pick, reason: r.text.match(/"reason"\s*:\s*"([\s\S]*?)"\s*\}?\s*$/)?.[1] ?? "", cost, inTokens, outTokens, tokens: inTokens + outTokens };
      botBus.addLog(`返事を読めず (${tries + 1}回目): ${r.text.slice(0, 200).replace(/\n/g, " ")}`);
    }
    return { pick: acts[acts.length - 1], reason: "(返事を読めず、終える)", cost, inTokens, outTokens, tokens: inTokens + outTokens };
  }
}
