import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { botBus } from "./botbus";
import { Action, BCard, Game, LoadedDeck, apply, decks, endTurn, legalActions, loadDeck, newGame, startTurn, stateText } from "./botgame";
import { MODELS, askClaude } from "./claude";
import { Settings } from "./settings";

export const BOT_VIEW = "mtg-bot";

const SYSTEM = `あなたは Magic: The Gathering のプレイヤー。ひとり回しの練習で、自分のデッキを回している。
ルール(練習用の簡略): 土地は1ターンに1枚。土地1枚 = 色を問わず1マナ。呪文は唱えると場(クリーチャー等)か墓地(インスタント・ソーサリー)に行くだけで、効果はまだ実行されない。相手はいない。
デッキの使い方のメモに沿って、最も良い行動を選ぶ。
返事は JSON を1つだけ: {"action": 番号, "reason": "短い理由(日本語)"}`;

// ボットのひとり回し (試し)。エンジンは使い捨ての簡易版。メイン領域に出る
export class BotView extends ItemView {
  private deckPath = "";
  private model = this.settings.botModel;
  private turns = 8;
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

  private chips(parent: HTMLElement, title: string, cards: BCard[], tapped?: boolean[]) {
    const sec = parent.createDiv("mtg-botsec");
    sec.createEl("h4", { text: `${title} (${cards.length})` });
    const row = sec.createDiv("mtg-botrow");
    cards.forEach((c, i) => {
      const chip = row.createSpan({ text: `${c.name} ${c.manaCost}`, cls: "mtg-botchip" });
      chip.toggleClass("is-tapped", !!tapped?.[i]);
      chip.onmouseenter = () => botBus.setHover(c);
    });
  }

  private renderBoard() {
    this.infoEl.setText(this.info);
    this.board.empty();
    const g = this.game;
    if (!g) return;
    this.chips(this.board, "手札", g.hand);
    this.chips(this.board, "場の土地", g.lands.map((l) => l.card), g.lands.map((l) => l.tapped));
    this.chips(this.board, "場", g.field);
    this.chips(this.board, "墓地", g.graveyard);
    this.board.createDiv({ text: `山札 ${g.library.length} 枚`, cls: "mtg-dim" });
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
    log(`デッキ: ${deck.name} (${deck.cards.length} 枚) / モデル: ${MODELS[this.model].label}`);
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
            note(`[${g.turn}] ${r.reason ? `${r.reason} → ` : ""}${apply(g, pick)}  (入力 ${r.inTokens} / 出力 ${r.outTokens}, $${r.cost.toFixed(4)})`);
          } else {
            note(`[${g.turn}] 選べる行動なし → 自動でターンを終える (呼び出し無し)`);
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
      const r = await askClaude(key, this.model, system, user);
      cost += r.cost;
      inTokens += r.inTokens;
      outTokens += r.outTokens;
      const m = r.text.match(/\{[\s\S]*\}/);
      try {
        const j = JSON.parse(m?.[0] ?? "");
        const pick = acts.find((a) => a.id === Number(j.action));
        if (pick) return { pick, reason: String(j.reason ?? ""), cost, inTokens, outTokens, tokens: inTokens + outTokens };
      } catch {
        /* 聞き直す */
      }
    }
    return { pick: acts[acts.length - 1], reason: "(返事を読めず、終える)", cost, inTokens, outTokens, tokens: inTokens + outTokens };
  }
}
