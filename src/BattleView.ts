import { ItemView, WorkspaceLeaf } from "obsidian";
import { BoardModel, CardView, LandStack, PhaseId, boardModel } from "./battle/boardModel";
import { GAP, LAYER_PX, cardBackUrl, overlapFor, pileLayers, rowNeed } from "./battle/layout";
import { sampleBattle } from "./battle/sampleBattle";
import { Game, RuleBook } from "./battle/state";
import { cardImage, cardInfo, cardText } from "./cards";

export const BATTLE_VIEW = "mtg-battle";

const PHASES: [PhaseId, string][] = [["beginning", "開始"], ["main1", "戦闘前メイン"], ["combat", "戦闘"], ["main2", "戦闘後メイン"], ["ending", "最終"]];
const MANA_COLORS = ["W", "U", "B", "R", "G", "A"] as const;
const VIEWER = "you";
const CARD_W = 62; // 盤面のカードの幅 (CSS の --cw と同じ)
const HAND_W = 96;

interface Entry {
  el: HTMLElement;
  sig: string; // 中身。同じなら、その要素は触らない
}
// 1つのゾーンに並べるもの。key = ゾーンの中で重ならない名前、data = 中身 (sig の元)、paint = 要素の中身の作り方
interface Item {
  key: string;
  data: unknown;
  name: string; // ホバーのプレビューに使うカード名
  paint: (el: HTMLElement) => void;
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
    selfLife: HTMLElement;
    oppLife: HTMLElement;
    piles: Record<string, HTMLElement>;
    mana: HTMLElement;
    belt: HTMLElement;
    banner: HTMLElement;
    stack: HTMLElement;
    preview: HTMLElement;
    log: HTMLElement;
  };
  private logSig = "";
  private previewSeq = 0;
  private watcher?: ResizeObserver;

  constructor(leaf: WorkspaceLeaf) {
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
    const { game, rules } = sampleBattle();
    this.game = game;
    this.rules = rules;
    this.build();
    await this.loadImages();
    this.paint();
    this.watcher?.disconnect(); // 開き直されても、監視は1つだけ
    this.watcher = new ResizeObserver(() => this.fit());
    this.watcher.observe(this.ui.stage);
    this.register(() => this.watcher?.disconnect());
  }

  // ---- 画面の骨組み (作り直すたびに、前の状態を捨てる)
  private build() {
    this.els.clear();
    this.logSig = "";
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-bt");
    const stage = root.createDiv("mtg-bt-stage");
    stage.style.setProperty("--back", `url("${cardBackUrl()}")`); // 山札の裏面の絵 (読めなければ、CSS の代わりの絵)
    const side = root.createDiv("mtg-bt-side");
    const board = stage.createDiv("mtg-bt-board");
    const rows: Record<string, HTMLElement> = {};
    for (const key of ["opp-lands", "opp-others", "opp-creatures", "self-creatures", "self-others", "self-lands"]) rows[key] = board.createDiv({ cls: `mtg-bt-row mtg-bt-${key}` });
    const belt = board.createDiv({ cls: "mtg-bt-belt", text: "戦 闘" });
    const hand = stage.createDiv("mtg-bt-hand");
    stage.createDiv({ cls: "mtg-bt-avatar is-opp" });
    stage.createDiv({ cls: "mtg-bt-avatar is-self" });
    const oppLife = stage.createDiv({ cls: "mtg-bt-life is-opp" });
    const selfLife = stage.createDiv({ cls: "mtg-bt-life is-self" });
    const piles: Record<string, HTMLElement> = {};
    for (const key of ["opp-library", "opp-yard", "self-library", "self-yard"]) piles[key] = board.createDiv({ cls: `mtg-bt-deck is-${key}` }); // 盤面 (3D の面) の上に置く
    const mana = stage.createDiv("mtg-bt-mana");
    const phase = stage.createDiv("mtg-bt-phase");
    const step = stage.createDiv("mtg-bt-step");
    const banner = stage.createDiv("mtg-bt-banner");
    const stack = stage.createDiv("mtg-bt-stack");
    const preview = side.createDiv("mtg-bt-preview");
    preview.createDiv({ cls: "mtg-bt-hint", text: "カードにカーソルを合わせると、ここに画像と効果が出ます" });
    const log = side.createDiv("mtg-bt-log");
    this.ui = { stage, rows, hand, phase, step, selfLife, oppLife, piles, mana, belt, banner, stack, preview, log };
  }

  // 画像の URL: カード名でノートを引いて、保存済みの URL を使う (新しい通信はしない)。無いカードは、名前と P/T の代わりの面
  private async loadImages() {
    const g = this.game;
    const names = new Set<string>([...g.battlefield.map((p) => p.card.name), ...Object.values(g.hands).flat().map((c) => c.name)]);
    await Promise.all(
      [...names].map(async (n) => {
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
    this.sync(ui.rows["opp-lands"], "opp-lands", this.stackItems(m.opp.landStacks));
    this.sync(ui.rows["opp-others"], "opp-others", this.cardItems(m.opp.others));
    this.sync(ui.rows["opp-creatures"], "opp-creatures", this.cardItems(m.opp.creatures));
    this.sync(ui.rows["self-creatures"], "self-creatures", this.cardItems(m.self.creatures));
    this.sync(ui.rows["self-others"], "self-others", this.cardItems(m.self.others));
    this.sync(ui.rows["self-lands"], "self-lands", this.stackItems(m.self.landStacks));
    this.sync(ui.hand, "hand", this.cardItems(m.self.hand));
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
  }

  private setText(el: HTMLElement, text: string, life?: number) {
    if (el.textContent !== text) el.setText(text);
    if (life !== undefined) el.toggleClass("is-long", Math.abs(life) >= 1000 || life < -99);
  }

  private cardItems(cards: CardView[]): Item[] {
    return cards.map((c) => ({ key: c.id, data: c, name: c.name, paint: (el) => this.fill(el, c) }));
  }

  // 同じ名前の土地の山 (src/battle/boardModel.ts の LandStack)
  private stackItems(stacks: LandStack[]): Item[] {
    return stacks.map((s) => ({ key: `stack:${s.name}`, data: s, name: s.name, paint: (el) => this.fillStack(el, s) }));
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
        entry = { el, sig: "" };
        this.els.set(key, entry);
      }
      if (entry.sig !== sig) {
        entry.el.dataset.name = it.name;
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

  // 1枚のカードの中身。画像があれば画像、無ければ名前の代わりの面。P/T と忠誠度は、あるものを両方出す
  private fill(el: HTMLElement, c: CardView) {
    el.className = "mtg-bt-card";
    for (const [on, cls] of [[c.tapped, "is-tapped"], [c.attacking, "is-attacking"], [c.blocking, "is-blocking"], [c.sick, "is-sick"], [c.prepared, "is-prepared"], [c.token, "is-token"]] as const) if (on) el.addClass(cls);
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
    el.empty();
    const standing = s.cards.filter((c) => !c.tapped);
    const tapped = s.cards.filter((c) => c.tapped);
    const pile = el.createDiv("mtg-bt-pile3d");
    pile.style.width = `${CARD_W + Math.max(0, standing.length - 1) * 5}px`;
    standing.forEach((c, i) => {
      const card = pile.createDiv("mtg-bt-card");
      card.style.left = `${i * 5}px`;
      card.style.top = `${-i * 2}px`;
      this.face(card, c);
    });
    if (tapped.length) {
      const side = el.createDiv("mtg-bt-tapgroup");
      side.style.width = `${86 + (tapped.length - 1) * 14}px`;
      tapped.forEach((c, i) => {
        const card = side.createDiv("mtg-bt-card is-lying");
        card.style.left = `${i * 14 + 12}px`; // 横向き (86×62) が、i * 14 の位置に収まる
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
    for (const s of [...m.stack].reverse()) el.createDiv({ cls: `mtg-bt-stackitem is-${s.controller}`, text: `${s.ability ? "能力: " : ""}${s.name}` });
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
