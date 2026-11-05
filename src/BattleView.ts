import { ItemView, WorkspaceLeaf } from "obsidian";
import { TargetSlot } from "./battle/engine";
import { InputRequest } from "./battle/input";
import { BattleController, StopMode } from "./battle/play";
import { BoardModel, CardView, LandStack, PhaseId, boardModel } from "./battle/boardModel";
import { CARD_H, CARD_W, GAP, HAND_H, HAND_W, LAYER_PX, TAP_EXTRA, cardBackUrl, overlapFor, pileLayers, rowNeed } from "./battle/layout";
import { BattleSession } from "./battle/deckToGame";
import { sampleBattle } from "./battle/sampleBattle";
import { Game, RuleBook } from "./battle/state";
import { cardImage, cardInfo, cardText } from "./cards";

export const BATTLE_VIEW = "mtg-battle";

const PHASES: [PhaseId, string][] = [["beginning", "開始"], ["main1", "戦闘前メイン"], ["combat", "戦闘"], ["main2", "戦闘後メイン"], ["ending", "最終"]];
const MANA_COLORS = ["W", "U", "B", "R", "G", "A"] as const;
const VIEWER = "you";

interface Entry {
  el: HTMLElement;
  sig: string; // 中身。同じなら、その要素は触らない
  use?: () => void; // ダブルクリック (使う)
  pick?: () => void; // 1回クリック (選ぶ。能力が複数あれば、一覧)
}
// 1つのゾーンに並べるもの。key = ゾーンの中で重ならない名前、data = 中身 (sig の元)、paint = 要素の中身の作り方
interface Item {
  key: string;
  data: unknown;
  name: string; // ホバーのプレビューに使うカード名
  paint: (el: HTMLElement) => void;
  use?: () => void;
  pick?: () => void;
}

// 対戦の画面 (段階1: サンプルの局面を見るだけ)。Game → BoardModel (src/battle/boardModel.ts) の内容を描くだけで、ルールは持たない。
// 更新は、変わったものだけを描き直す (キーつきの差分)。ホバーの前面表示は CSS だけ
export class BattleView extends ItemView {
  private game!: Game;
  private rules!: RuleBook;
  private urls = new Map<string, string>(); // カード名 → 画像の URL (ノートに保存済みのもの)
  private els = new Map<string, Entry>(); // ゾーン + キー → 要素
  private ui!: {
    stage: HTMLElement;
    rows: Record<string, HTMLElement>;
    hand: HTMLElement;
    phase: HTMLElement;
    step: HTMLElement;
    turn: HTMLElement;
    selfLife: HTMLElement;
    oppLife: HTMLElement;
    piles: Record<string, HTMLElement>;
    mana: HTMLElement;
    belt: HTMLElement;
    banner: HTMLElement;
    next: HTMLButtonElement;
    stack: HTMLElement;
    preview: HTMLElement;
    log: HTMLElement;
  };
  private ctl?: BattleController; // 対戦のとき。サンプルの局面では無い (操作できない)
  private menu?: HTMLElement;
  // 対象を選んでいる途中 (Esc で取り消し。局面は変わらない)。slots = 聞くこと、i = いまのスロット、picks = スロットごとの選んだ id
  private targeting?: { title: string; slots: TargetSlot[]; i: number; picks: string[][]; done: (t: Record<string, string>) => void; cancel?: () => void };
  private tbar?: HTMLElement;
  private mullEl?: HTMLElement; // マリガンのダイアログ (手札にカーソルを合わせて見られるよう、後ろの操作は止めない)
  private bottoming = false; // マリガンのキープのあと、底に置くカードを選んでいる
  private askCancel?: () => void; // いまの質問を Esc で取り消すときの動き (無ければ、操作の取り消し)
  private askEl?: HTMLElement; // 質問のダイアログ (捨てる・選ぶ・してもよい・支払う)
  private tried = new Set<string>(); // 画像を探したカード名
  private logSig = "";
  private previewSeq = 0;
  private watcher?: ResizeObserver;

  // getSession = 対戦の局面 (無ければ、サンプルの局面)。対戦を始め直したときは、begin() で読み直す
  constructor(leaf: WorkspaceLeaf, private getSession: () => BattleSession | undefined, private getStops: () => StopMode = () => "smart") {
    super(leaf);
  }

  getViewType() {
    return BATTLE_VIEW;
  }
  getDisplayText() {
    return "Battle";
  }
  getIcon() {
    return "swords";
  }

  async onOpen() {
    await this.begin();
  }

  // 局面を (読み直して) 描き始める
  async begin() {
    const session = this.getSession();
    const { game, rules } = session ?? sampleBattle();
    this.game = game;
    this.rules = rules;
    this.ctl = session ? new BattleController(game, rules, VIEWER, this.getStops) : undefined;
    this.tried.clear();
    this.askEl = undefined;
    this.targeting = undefined;
    this.tbar = undefined;
    this.menu = undefined;
    this.build();
    await this.loadImages();
    this.paint();
    this.bottoming = false;
    this.askCancel = undefined;
    this.mullEl = undefined;
    this.checkMulligan();
    this.watcher?.disconnect(); // 開き直されても、監視は1つだけ
    this.watcher = new ResizeObserver(() => this.fit());
    this.watcher.observe(this.ui.stage);
    this.register(() => this.watcher?.disconnect());
    if (!this.keysOn) {
      this.keysOn = true;
      this.registerDomEvent(document, "keydown", (e) => {
        if (e.key !== "Escape") return;
        if (this.askEl) this.cancelAsk();
        else if (this.targeting) this.endTargeting(); // 途中でやめるのは Esc だけ
        else this.closeMenu();
      });
      this.registerDomEvent(this.contentEl, "click", (e) => {
        if (this.targeting) return this.clickTarget(e);
        if (!(e.target as HTMLElement).closest(".mtg-bt-menu")) this.closeMenu(); // 捕捉の段階で閉じる (そのあと、クリックしたカードが、必要なら開き直す)
      }, true);
      this.registerDomEvent(this.contentEl, "dblclick", (e) => this.targeting && e.stopPropagation(), true);
    }
  }
  private keysOn = false;

  // ---- 画面の骨組み (作り直すたびに、前の状態を捨てる)
  private build() {
    this.els.clear();
    this.logSig = "";
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-bt");
    const stage = root.createDiv("mtg-bt-stage");
    for (const [k, v] of [["--bw", CARD_W], ["--bh", CARD_H], ["--hw", HAND_W], ["--hh", HAND_H], ["--tx", TAP_EXTRA / 2]] as const) stage.style.setProperty(k, `${v}px`); // カードの大きさ (src/battle/layout.ts)
    stage.style.setProperty("--back", `url("${cardBackUrl()}")`); // 山札の裏面の絵 (読めなければ、CSS の代わりの絵)
    const side = root.createDiv("mtg-bt-side");
    const board = stage.createDiv("mtg-bt-board");
    const rows: Record<string, HTMLElement> = {};
    for (const key of ["opp-lands", "opp-others", "opp-creatures", "self-creatures", "self-others", "self-lands"]) rows[key] = board.createDiv({ cls: `mtg-bt-row mtg-bt-${key}` });
    const belt = board.createDiv("mtg-bt-belt"); // 真ん中の帯: だれのターンか・フェイズの進み・ステップ
    const turn = belt.createDiv("mtg-bt-turn");
    const phase = belt.createDiv("mtg-bt-phase");
    const step = belt.createDiv("mtg-bt-step");
    const hand = stage.createDiv("mtg-bt-hand");
    stage.createDiv({ cls: "mtg-bt-avatar is-opp" }).dataset.tid = this.game.players.find((p) => p !== VIEWER) ?? "";
    stage.createDiv({ cls: "mtg-bt-avatar is-self" }).dataset.tid = VIEWER;
    const oppLife = stage.createDiv({ cls: "mtg-bt-life is-opp" });
    const selfLife = stage.createDiv({ cls: "mtg-bt-life is-self" });
    const piles: Record<string, HTMLElement> = {};
    for (const key of ["opp-library", "opp-yard", "self-library", "self-yard"]) piles[key] = board.createDiv({ cls: `mtg-bt-deck is-${key}` }); // 盤面 (3D の面) の上に置く
    const mana = stage.createDiv("mtg-bt-mana");
    const banner = stage.createDiv("mtg-bt-banner");
    const next = stage.createEl("button", { cls: "mtg-bt-next mod-cta", text: "次へ" });
    next.addEventListener("click", () => this.ctl && !this.targeting && this.run(() => this.ctl!.next())); // 対象を選んでいる間は、進めない
    const stack = stage.createDiv("mtg-bt-stack");
    const preview = side.createDiv("mtg-bt-preview");
    preview.createDiv({ cls: "mtg-bt-hint", text: "カードにカーソルを合わせると、ここに画像と効果が出ます" });
    const log = side.createDiv("mtg-bt-log");
    this.ui = { stage, rows, hand, phase, step, turn, selfLife, oppLife, piles, mana, belt, banner, next, stack, preview, log };
  }

  // 画像の URL: カード名でノートを引いて、保存済みの URL を使う (新しい通信はしない)。無いカードは、名前と P/T の代わりの面
  private async loadImages(extra: string[] = []) {
    const g = this.game;
    const names = new Set<string>([...g.battlefield.map((p) => p.card.name), ...Object.values(g.hands).flat().map((c) => c.name), ...Object.values(g.graveyards).flat().map((c) => c.name), ...g.stack.map((s) => s.card.name), ...extra]);
    await Promise.all(
      [...names].filter((n) => !this.tried.has(n)).map(async (n) => {
        this.tried.add(n);
        const info = cardInfo(this.app, n);
        const url = info ? await cardImage(this.app, info.file) : undefined;
        if (url) this.urls.set(n, url);
      }),
    );
  }

  // ---- 描く (BoardModel を、差分だけ更新)
  private paint() {
    const m = boardModel(this.game, this.rules, VIEWER, (c) => this.urls.get(c.name));
    const ui = this.ui;
    this.sync(ui.rows["opp-lands"], "opp-lands", this.stackItems(m.opp.landStacks, false));
    this.sync(ui.rows["opp-others"], "opp-others", this.cardItems(m.opp.others, "opp"));
    this.sync(ui.rows["opp-creatures"], "opp-creatures", this.cardItems(m.opp.creatures, "opp"));
    this.sync(ui.rows["self-creatures"], "self-creatures", this.cardItems(m.self.creatures, "perm"));
    this.sync(ui.rows["self-others"], "self-others", this.cardItems(m.self.others, "perm"));
    this.sync(ui.rows["self-lands"], "self-lands", this.stackItems(m.self.landStacks, true));
    this.sync(ui.hand, "hand", this.cardItems(m.self.hand, "hand"));
    this.setText(ui.selfLife, String(m.self.life), m.self.life);
    this.setText(ui.oppLife, String(m.opp.life), m.opp.life);
    this.paintPile(ui.piles["self-library"], m.self.library);
    this.paintPile(ui.piles["self-yard"], m.self.graveyard, m.self.graveyardTop);
    this.paintPile(ui.piles["opp-library"], m.opp.library);
    this.paintPile(ui.piles["opp-yard"], m.opp.graveyard, m.opp.graveyardTop);
    this.paintMana(m);
    ui.belt.toggleClass("is-on", m.combat);
    this.paintPhase(m);
    this.paintBanner(m);
    this.paintStack(m);
    this.paintLog(m.log);
    this.fit();
    if (this.targeting) this.paintTargeting();
  }

  private setText(el: HTMLElement, text: string, life?: number) {
    if (el.textContent !== text) el.setText(text);
    if (life !== undefined) el.toggleClass("is-long", Math.abs(life) >= 1000 || life < -99);
  }

  // kind = hand (手札: ダブルクリックで使う) / perm (自分のパーマネント: 能力) / opp (相手: 操作なし)
  private cardItems(cards: CardView[], kind: "hand" | "perm" | "opp"): Item[] {
    return cards.map((c) => ({
      key: c.id,
      data: c,
      name: c.name,
      paint: (el) => this.fill(el, c),
      ...(this.ctl && kind === "hand" ? { use: () => this.ask(c.name, this.ctl!.needsForCard(c.id), (t) => this.run(() => this.ctl!.use(c.id, t))) } : {}),
      ...(this.ctl && kind === "perm" ? { use: () => this.useAbility(c.id), pick: () => this.pickAbility(c.id) } : {}),
    }));
  }

  // 同じ名前の土地の山 (src/battle/boardModel.ts の LandStack)。自分の山は、ダブルクリックで、使える土地を1枚タップ
  private stackItems(stacks: LandStack[], mine: boolean): Item[] {
    return stacks.map((s) => {
      const land = () => s.cards.find((c) => c.playable)?.id;
      return { key: `stack:${s.name}`, data: s, name: s.name, paint: (el) => this.fillStack(el, s), ...(this.ctl && mine ? { use: () => { const id = land(); if (id) this.useAbility(id); }, pick: () => { const id = land(); if (id) this.pickAbility(id); } } : {}) };
    });
  }

  // ---- 操作 (ルールはコントローラーにある。ここは、呼んで描き直すだけ)
  private run(f: () => unknown) {
    this.closeMenu();
    try {
      f();
    } catch (e) {
      console.error(e); // 想定外の失敗: 質問は捨てて、画面は止めない
      this.ctl?.cancel();
    }
    void this.loadImages().then(() => this.paint());
    this.paint();
    void this.checkPending();
    this.checkMulligan();
  }

  // ---- マリガン (ロンドン): キープ / マリガン。キープしたら、マリガンした回数ぶん、底に置くカードを選ぶ。Esc で、キープ / マリガンの選択に戻る
  private checkMulligan() {
    this.mullEl?.remove();
    this.mullEl = undefined;
    const m = this.game.mulligan;
    if (!this.ctl || !m) return;
    if (this.bottoming) return; // 底に置くカードの選択は、showAsk が出している
    const box = this.ui.stage.createDiv("mtg-bt-ask is-mull");
    this.mullEl = box;
    box.createDiv({ cls: "mtg-bt-asktitle", text: m.count === 0 ? "この手札でキープしますか?" : `マリガン ${m.count} 回目: この手札でキープしますか?` });
    const row = box.createDiv("mtg-bt-askrow");
    row.createEl("button", { cls: "mod-cta", text: m.count > 0 ? `キープ (${m.count} 枚を底に置く)` : "キープ" }).addEventListener("click", () => {
      if (this.ctl!.keep() === "bottom") {
        this.bottoming = true;
        this.mullEl?.remove();
        this.mullEl = undefined;
        this.showBottom(m.count);
      } else this.run(() => undefined);
    });
    const mull = row.createEl("button", { text: "マリガン" });
    mull.disabled = m.count >= 7;
    mull.addEventListener("click", () => this.run(() => this.ctl!.mulligan()));
  }
  private async showBottom(count: number) {
    const cards = this.game.hands[VIEWER].map((c) => ({ id: c.id, name: c.name }));
    await this.loadImages(cards.map((c) => c.name));
    if (!this.game.mulligan || !this.bottoming) return; // 待っているあいだに、閉じた・開き直された
    this.askCancel = () => {
      this.bottoming = false;
      this.checkMulligan();
    };
    this.showAsk({ kind: "choose", min: count, max: count, cards }, (ids) => {
      this.bottoming = false;
      this.askCancel = undefined;
      this.run(() => this.ctl!.bottom(ids as string[]));
    }, `ライブラリーの底に置くカードを ${count} 枚選ぶ`);
  }

  // ---- 自分への質問 (src/battle/input.ts)。答えたら、コントローラーが最初からやり直す。Esc で取り消し (何も起きなかったことになる)
  private askSeq = 0;
  private async checkPending() {
    const seq = ++this.askSeq;
    this.askCancel = undefined;
    this.askEl?.remove();
    this.askEl = undefined;
    this.ui.stage.removeClass("is-asking");
    const req = this.ctl?.pending?.request;
    if (!req) return;
    this.ui.stage.addClass("is-asking"); // 画像を読む間も、後ろの操作を止める
    if (req.kind === "discard" || req.kind === "choose") await this.loadImages(req.cards.map((c) => c.name));
    if (req.kind === "target") await this.loadImages(req.choices.map((c) => c.name));
    if (seq !== this.askSeq) return; // 新しい質問が来た
    this.showAsk(req);
  }
  private showAsk(req: InputRequest, custom?: (v: string[] | boolean) => void, title?: string) {
    const box = this.ui.stage.createDiv("mtg-bt-ask");
    this.askEl = box;
    this.ui.stage.addClass("is-asking");
    const reply = custom ?? ((v: string[] | boolean) => this.run(() => this.ctl!.answer(v)));
    const head = box.createDiv("mtg-bt-asktitle");
    if (req.kind === "may") {
      head.setText(req.what === "exile" ? "墓地のカードを追放しますか?" : `${req.what} をしますか?`);
      const row = box.createDiv("mtg-bt-askrow");
      row.createEl("button", { cls: "mod-cta", text: "はい" }).addEventListener("click", () => reply(true));
      row.createEl("button", { text: "いいえ" }).addEventListener("click", () => reply(false));
    } else if (req.kind === "pay") {
      head.setText(`{${req.n}} を支払いますか? (支払わないと、打ち消される)`);
      const row = box.createDiv("mtg-bt-askrow");
      row.createEl("button", { cls: "mod-cta", text: "支払う" }).addEventListener("click", () => reply(true));
      row.createEl("button", { text: "支払わない" }).addEventListener("click", () => reply(false));
    } else if (req.kind === "discard" || req.kind === "choose" || req.kind === "target") {
      const cards = req.kind === "target" ? req.choices : req.cards;
      const keep = req.kind === "discard" && req.cleanup ? req.cards.length - req.n : undefined; // クリンナップ: 残すカードを選ぶ (選ばなかったものが、墓地へ)
      const min = keep ?? (req.kind === "discard" ? req.n : req.min);
      const max = keep ?? (req.kind === "discard" ? req.n : req.max);
      const picked = new Set<string>();
      const ok = box.createEl("button", { cls: "mod-cta", text: "確定" });
      const count = head.createSpan();
      const sync = () => {
        count.setText(title ? `${title} (${picked.size} / ${max})` : `${req.kind === "discard" ? (keep !== undefined ? `手札を ${keep} 枚にする: 残すカードを ${keep} 枚選ぶ` : `手札から ${req.n} 枚捨てる`) : req.kind === "target" ? `${req.card}: 対象を選ぶ` : "カードを選ぶ"} (${picked.size} / ${min === max ? max : `${min}〜${max}`})`);
        ok.disabled = picked.size < min || picked.size > max;
      };
      const tiles = box.createDiv("mtg-bt-asktiles");
      for (const c of cards) {
        const tile = tiles.createDiv("mtg-bt-asktile");
        const url = this.urls.get(c.name);
        if (url) tile.createEl("img", { attr: { src: url, alt: c.name, draggable: "false" } });
        else tile.createDiv({ cls: "mtg-bt-face", text: c.name });
        tile.addEventListener("mouseenter", () => void this.showPreview(c.name));
        tile.addEventListener("click", () => {
          if (picked.has(c.id)) picked.delete(c.id);
          else if (picked.size < max) picked.add(c.id);
          tile.toggleClass("is-picked", picked.has(c.id));
          sync();
        });
      }
      box.appendChild(ok);
      ok.addEventListener("click", () => reply(keep !== undefined ? cards.map((c) => c.id).filter((id) => !picked.has(id)) : [...picked]));
      sync();
    }
    box.createEl("div", { cls: "mtg-bt-askhint", text: "Esc で取り消し (何も起きなかったことになる)" });
  }
  private cancelAsk() {
    this.askEl?.remove();
    this.askEl = undefined;
    this.ui.stage.removeClass("is-asking");
    const f = this.askCancel;
    this.askCancel = undefined;
    if (f) return f();
    this.ctl?.cancel();
    this.paint();
  }
  private useAbility(permId: string) {
    const abs = this.ctl!.abilities(permId);
    const first = abs.find((a) => a.usable);
    if (first) this.activateWith(permId, first.index);
  }
  // 1回クリック: 能力が2つ以上あれば、一覧を出す
  private pickAbility(permId: string) {
    if (this.targeting) return;
    const abs = this.ctl!.abilities(permId);
    this.closeMenu();
    if (abs.length < 2) return;
    const anchor = Array.from(this.els.values()).find((e) => e.el.dataset.id === permId)?.el ?? this.ui.stage.querySelector(`[data-id="${permId}"]`);
    const menu = this.ui.stage.createDiv("mtg-bt-menu");
    const box = (anchor as HTMLElement | null)?.getBoundingClientRect();
    const st = this.ui.stage.getBoundingClientRect();
    if (box) menu.setCssStyles({ left: `${box.left - st.left}px`, top: `${Math.max(4, box.top - st.top - abs.length * 28 - 8)}px` });
    for (const a of abs) {
      const row = menu.createDiv({ cls: `mtg-bt-menuitem${a.usable ? "" : " is-off"}`, text: a.label });
      row.addEventListener("click", (e) => { e.stopPropagation(); if (a.usable) this.activateWith(permId, a.index); });
    }
    this.menu = menu;
  }
  private activateWith(permId: string, index: number) {
    const name = this.game.battlefield.find((p) => p.id === permId)?.card.name ?? "";
    this.closeMenu();
    this.ask(name, this.ctl!.needsForAbility(permId, index), (t) => this.run(() => this.ctl!.activate(permId, index, t)));
  }

  // ---- 対象の選択: 合法な対象を光らせ、クリックで選ぶ (解除もクリック)。数が足りたら「確定」。スロットが複数なら順番に
  private ask(title: string, slots: TargetSlot[], done: (t: Record<string, string>) => void) {
    const asked = slots.filter((x) => x.legal.length > 0);
    if (!asked.length || slots.some((x) => x.legal.length < x.min)) return done({}); // 対象が足りないときは、聞かずに、使おうとして、理由をログに出す
    this.closeMenu();
    this.targeting = { title, slots: asked, i: 0, picks: asked.map(() => []), done };
    this.paintTargeting();
  }
  private endTargeting() {
    const cancel = this.targeting?.cancel;
    this.targeting = undefined;
    cancel?.();
    this.paintTargeting();
  }
  private clickTarget(e: MouseEvent) {
    const t = this.targeting!;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-tid]");
    if (!el || !t.slots[t.i].legal.includes(el.dataset.tid!)) return; // 対象にできないところ: 何も起きない (メニューなどは通常どおり)
    e.stopPropagation();
    e.preventDefault();
    const picks = t.picks[t.i];
    const at = picks.indexOf(el.dataset.tid!);
    if (at >= 0) picks.splice(at, 1);
    else if (picks.length < t.slots[t.i].max) picks.push(el.dataset.tid!);
    else return;
    this.paintTargeting();
  }
  private confirmTarget() {
    const t = this.targeting!;
    if (t.i < t.slots.length - 1) {
      t.i++;
      return this.paintTargeting();
    }
    const targets: Record<string, string> = {};
    t.slots.forEach((s, k) => t.picks[k].length && (targets[s.as] = t.picks[k].join(",")));
    this.targeting = undefined;
    this.paintTargeting();
    t.done(targets);
  }
  private paintTargeting() {
    const st = this.ui.stage;
    for (const el of Array.from(st.querySelectorAll(".is-target, .is-picked"))) el.classList.remove("is-target", "is-picked");
    this.tbar?.remove();
    this.tbar = undefined;
    st.toggleClass("is-targeting", !!this.targeting);
    const t = this.targeting;
    if (!t) return;
    const slot = t.slots[t.i];
    const picks = t.picks[t.i];
    for (const id of slot.legal) st.querySelector(`[data-tid="${id}"]`)?.classList.add(picks.includes(id) ? "is-picked" : "is-target");
    const bar = st.createDiv("mtg-bt-tbar");
    const range = slot.min === slot.max ? `${slot.max}` : `${slot.min}〜${slot.max}`;
    bar.createSpan({ text: `${t.title}: 対象を選ぶ (${picks.length} / ${range})${t.slots.length > 1 ? `  [${t.i + 1}/${t.slots.length}]` : ""}` });
    const ok = bar.createEl("button", { cls: "mod-cta", text: "確定" });
    ok.disabled = picks.length < slot.min;
    ok.addEventListener("click", () => this.confirmTarget());
    bar.createEl("button", { text: "やめる (Esc)" }).addEventListener("click", () => this.endTargeting());
    this.tbar = bar;
  }
  private closeMenu() {
    this.menu?.remove();
    this.menu = undefined;
  }

  // 1つのゾーンの要素を、キーで対応づけて更新する。変わった (sig が違う) ものだけ中身を作り直し、並びが違うところだけ動かす
  private sync(container: HTMLElement, zone: string, items: Item[]) {
    const keep = new Set<string>();
    items.forEach((it, i) => {
      const key = `${zone}:${it.key}`;
      keep.add(key);
      const sig = JSON.stringify(it.data);
      let entry = this.els.get(key);
      if (!entry) {
        const el = document.createElement("div");
        el.addEventListener("mouseenter", () => void this.showPreview(el.dataset.name ?? ""));
        el.addEventListener("click", () => this.entryOf(el)?.pick?.());
        el.addEventListener("dblclick", () => this.entryOf(el)?.use?.());
        entry = { el, sig: "" };
        this.els.set(key, entry);
      }
      entry.use = it.use;
      entry.pick = it.pick;
      if (entry.sig !== sig) {
        entry.el.dataset.name = it.name;
        entry.el.dataset.id = it.key.startsWith("stack:") ? "" : it.key;
        if (!it.key.startsWith("stack:")) entry.el.dataset.tid = it.key; // 対象にできる (戦場のカード)
        it.paint(entry.el);
        entry.sig = sig;
      }
      if (container.children[i] !== entry.el) container.insertBefore(entry.el, container.children[i] ?? null);
      if (zone === "hand") entry.el.style.setProperty("--i", String(i - (items.length - 1) / 2)); // 手札の扇: 中央からの位置
    });
    for (const [key, entry] of this.els) {
      if (key.startsWith(`${zone}:`) && !keep.has(key)) {
        entry.el.remove();
        this.els.delete(key);
      }
    }
  }

  private entryOf(el: HTMLElement): Entry | undefined {
    for (const e of this.els.values()) if (e.el === el) return e;
    return undefined;
  }

  // 1枚のカードの中身。画像があれば画像、無ければ名前の代わりの面。P/T と忠誠度は、あるものを両方出す
  private fill(el: HTMLElement, c: CardView) {
    el.className = "mtg-bt-card";
    for (const [on, cls] of [[c.tapped, "is-tapped"], [c.attacking, "is-attacking"], [c.blocking, "is-blocking"], [c.sick, "is-sick"], [c.prepared, "is-prepared"], [c.token, "is-token"], [c.playable && !!this.ctl, "is-playable"]] as const) if (on) el.addClass(cls);
    el.empty();
    this.face(el, c);
    if (c.power !== null && c.toughness !== null) el.createDiv({ cls: "mtg-bt-pt", text: `${c.power}/${c.toughness}` });
    if (c.loyalty !== undefined) el.createDiv({ cls: "mtg-bt-pt is-loyalty", text: String(c.loyalty) });
    if (c.damage > 0) el.createDiv({ cls: "mtg-bt-dmg", text: String(c.damage) });
    const counters = Object.entries(c.counters).filter(([k, n]) => k !== "loyalty" && n > 0);
    if (counters.length) el.createDiv({ cls: "mtg-bt-counters", text: counters.map(([k, n]) => `${k}×${n}`).join(" ") });
  }

  private face(el: HTMLElement, c: CardView) {
    if (c.image) el.createEl("img", { attr: { src: c.image, alt: c.name, loading: "lazy", draggable: "false" } });
    else el.createDiv({ cls: "mtg-bt-face", text: c.name });
  }

  // 土地の山: 立っている土地は少しずつずらして重ね、タップした土地は、横向きに倒して、山の脇に並べる。2枚以上なら枚数を出す
  private fillStack(el: HTMLElement, s: LandStack) {
    el.className = "mtg-bt-landstack";
    if (this.ctl && s.cards.some((c) => c.playable)) el.addClass("is-playable");
    el.empty();
    const standing = s.cards.filter((c) => !c.tapped);
    const tapped = s.cards.filter((c) => c.tapped);
    const pile = el.createDiv("mtg-bt-pile3d");
    pile.style.width = `${CARD_W + Math.max(0, standing.length - 1) * 5}px`;
    standing.forEach((c, i) => {
      const card = pile.createDiv("mtg-bt-card");
      card.dataset.tid = c.id;
      card.style.left = `${i * 5}px`;
      card.style.top = `${-i * 2}px`;
      this.face(card, c);
    });
    if (tapped.length) {
      const side = el.createDiv("mtg-bt-tapgroup");
      side.style.width = `${CARD_H + (tapped.length - 1) * 14}px`;
      side.style.height = `${CARD_W}px`;
      tapped.forEach((c, i) => {
        const card = side.createDiv("mtg-bt-card is-lying");
        card.dataset.tid = c.id;
        card.style.left = `${i * 14 + TAP_EXTRA / 2}px`; // 横向き (縦と横が入れ替わる) が、i * 14 の位置に収まる
        card.style.top = `${-TAP_EXTRA / 2}px`;
        this.face(card, c);
      });
    }
    if (s.cards.length > 1) el.createDiv({ cls: "mtg-bt-count", text: `×${s.cards.length}` });
  }

  // 山札・墓地: 盤面の上に立体で置く。枚数に応じた厚み (10 枚ごとに 1 層。層ごとに translateZ で高さを付ける)。山札は裏向き、墓地は一番上のカードを見せる。枚数を下に出す
  private paintPile(el: HTMLElement, count: number, top?: CardView) {
    const sig = `${count}|${top?.id ?? ""}|${top?.image ?? ""}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.empty();
    const layers = pileLayers(count);
    el.toggleClass("is-empty", count === 0);
    for (let i = 0; i < layers; i++) el.createDiv({ cls: `mtg-bt-layer${i % 2 ? " is-odd" : ""}` }).style.transform = `translateZ(${i * LAYER_PX}px)`; // 層ごとに高さを付けて、本当の厚みにする
    const faceEl = el.createDiv("mtg-bt-dface");
    faceEl.style.transform = `translateZ(${layers * LAYER_PX}px)`;
    if (top) this.face(faceEl, top);
    el.createDiv({ cls: "mtg-bt-dcount", text: String(count) });
  }

  private paintMana(m: BoardModel) {
    const el = this.ui.mana;
    const sig = JSON.stringify(m.manaSelf);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.empty();
    for (const c of MANA_COLORS) if (m.manaSelf.colors[c]) el.createSpan({ cls: `mtg-bt-mc is-${c}`, text: `${c === "A" ? "★" : c}${m.manaSelf.colors[c]}` });
    if (m.manaSelf.colorless) el.createSpan({ cls: "mtg-bt-mc is-C", text: `◇${m.manaSelf.colorless}` });
  }

  private paintPhase(m: BoardModel) {
    const el = this.ui.phase;
    if (!el.firstChild) for (const [id, label] of PHASES) el.createDiv({ text: label, attr: { "data-phase": id } });
    for (const child of Array.from(el.children) as HTMLElement[]) child.toggleClass("on", child.dataset.phase === m.phase);
    this.setText(this.ui.step, `ターン ${m.turn}・${m.step}`);
    const mine = m.activeSide === "self";
    this.setText(this.ui.turn, mine ? "あなたのターン" : "相手のターン");
    this.ui.turn.toggleClass("is-self", mine);
    this.ui.turn.toggleClass("is-opp", !mine);
    this.ui.stage.toggleClass("is-self-turn", mine);
    this.ui.stage.toggleClass("is-opp-turn", !mine);
    this.ui.next.setText(m.nextLabel);
    this.ui.next.disabled = !this.ctl || !m.canNext;
  }

  private paintBanner(m: BoardModel) {
    const el = this.ui.banner;
    const text = !m.over ? "" : m.over.winner === "self" ? "勝利" : m.over.winner === "opp" ? "敗北" : "引き分け";
    this.setText(el, text);
    el.toggleClass("is-on", text !== "");
  }

  private paintStack(m: BoardModel) {
    const el = this.ui.stack;
    const sig = JSON.stringify(m.stack);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.empty();
    for (const s of [...m.stack].reverse()) {
      const row = el.createDiv({ cls: `mtg-bt-stackitem is-${s.controller}`, text: `${s.ability ? "能力: " : ""}${s.name}` });
      row.dataset.tid = s.id;
    }
    el.toggleClass("is-on", m.stack.length > 0);
  }

  private paintLog(lines: string[]) {
    const sig = lines.join("\n");
    if (sig === this.logSig) return;
    this.logSig = sig;
    const el = this.ui.log;
    el.empty();
    for (const l of lines) el.createDiv({ cls: "mtg-bt-logline", text: l });
    el.scrollTop = el.scrollHeight;
  }

  // 重なり: 列や手札が幅に収まらないとき、隣との間を負にして重ねる (--ov)。計算は src/battle/layout.ts。タップして横向きのカード・土地の山の横幅も数える
  private fit() {
    const ui = this.ui;
    const set = (container: HTMLElement, need: number) => {
      const n = container.children.length;
      container.style.setProperty("--ov", `${overlapFor(need, n, container.clientWidth)}px`);
    };
    for (const row of Object.values(ui.rows)) {
      const kids = Array.from(row.children) as HTMLElement[];
      const isStacks = kids.some((k) => k.classList.contains("mtg-bt-landstack"));
      const need = isStacks ? kids.reduce((a, k) => a + k.offsetWidth, 0) + Math.max(0, kids.length - 1) * GAP : rowNeed(CARD_W, kids.length, kids.filter((k) => k.classList.contains("is-tapped")).length);
      set(row, need);
    }
    set(ui.hand, ui.hand.children.length * HAND_W);
  }

  // ---- 右上のプレビュー: カーソルを合わせたカードの画像と効果テキスト
  private async showPreview(name: string) {
    if (!name) return;
    const seq = ++this.previewSeq;
    const text = await cardText(this.app, name).catch(() => "");
    if (seq !== this.previewSeq) return;
    const el = this.ui.preview;
    el.empty();
    const url = this.urls.get(name);
    if (url) el.createEl("img", { attr: { src: url, alt: name } });
    el.createDiv({ cls: "mtg-bt-pname", text: name });
    el.createDiv({ cls: "mtg-bt-ptext", text: text || "(効果テキストが見つかりません)" });
  }
}
