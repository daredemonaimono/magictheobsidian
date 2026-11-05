import { ItemView, WorkspaceLeaf } from "obsidian";
import { TargetSlot } from "./battle/engine";
import { InputRequest } from "./battle/input";
import { Action } from "./battle/actions";
import { replay } from "./battle/replay";
import { SavedBattle } from "./battle/saved";
import { bump, focus } from "./battle/assignMath";
import { AskAi } from "./battle/ai";
import { aiStep } from "./battle/aiRun";
import { BattleController, StopMode } from "./battle/play";
import { stackEffectText } from "./battle/stackText";
import { BoardModel, CardView, CombatChoice, LandStack, PhaseId, boardModel } from "./battle/boardModel";
import { CARD_H, CARD_W, GAP, GAUGE_SEC, HAND_H, HAND_W, LAYER_PX, TAP_EXTRA, cardBackUrl, overlapFor, pileLayers, rowNeed } from "./battle/layout";
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
    gfill: HTMLElement;
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
  // 戦闘の指定を選んでいる途中 (攻撃クリーチャー / ブロック)。choice は boardModel の、選べるもの。ブロックは、自分のクリーチャー → 攻撃クリーチャー の順にクリック
  private combatSel?: { kind: "attack"; picks: Set<string> } | { kind: "block"; pairs: Map<string, string>; cur?: string } | { kind: "assign"; vals: Map<string, Record<string, number>> };
  private choice?: CombatChoice;
  private cbar?: HTMLElement;
  private gaugeKey = ""; // いまのゲージが、どの局面のものか
  private gaugeTimer?: number;
  private mullEl?: HTMLElement; // マリガンのダイアログ (手札にカーソルを合わせて見られるよう、後ろの操作は止めない)
  private bottoming = false; // マリガンのキープのあと、底に置くカードを選んでいる
  private askCancel?: () => void; // いまの質問を Esc で取り消すときの動き (無ければ、操作の取り消し)
  private askEl?: HTMLElement; // 質問のダイアログ (捨てる・選ぶ・してもよい・支払う)
  private tried = new Set<string>(); // 画像を探したカード名
  private logSig = "";
  private previewSeq = 0;
  private watcher?: ResizeObserver;

  // getSession = 対戦の局面 (無ければ、サンプルの局面)。対戦を始め直したときは、begin() で読み直す
  constructor(leaf: WorkspaceLeaf, private getSession: () => BattleSession | undefined, private getStops: () => StopMode = () => "smart", private getOpp: () => "cpu" | "claude" | "passive" = () => "passive", private getFx: () => boolean = () => true, private getAsk: () => AskAi | undefined = () => undefined, private onSave: (b: SavedBattle) => void = () => {}, private getSide: () => Promise<{ preview: HTMLElement; log: HTMLElement } | undefined> = async () => undefined) {
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

  async onClose() {
    this.stopRp();
    this.saveHistory(); // 途中でやめたとき
  }

  // 局面を (読み直して) 描き始める
  // ---- 履歴のリプレイ。記録 (入口の呼び出しの並び) を、1件ずつ呼び直して、局面を進める。開くと、自動再生。スペースで再生・停止、→ / ← キーで、次・前 (自動再生は止まる)。戻る・ジャンプは、初期状態から作り直して、その件数まで呼び直す。操作は受けない・API は呼ばない
  private rp?: { saved: SavedBattle; session: BattleSession; ctl: BattleController; pos: number; timer?: number; bad: number };
  private rpBuild(pos: number) {
    const rp = this.rp;
    if (!rp) return;
    const s = rp.session.rebuild!();
    const foe = s.game.players.find((p) => p !== VIEWER);
    rp.ctl = new BattleController(s.game, s.rules, VIEWER, s.rng ?? Math.random, rp.saved.mode === "cpu" ? foe : undefined, rp.saved.mode === "claude" ? foe : undefined);
    rp.bad = replay(rp.ctl, rp.saved.entries, pos);
    rp.pos = pos;
    this.rpShow();
  }
  private rpStep() {
    const rp = this.rp;
    if (!rp || rp.pos >= rp.saved.entries.length) return;
    rp.bad += replay(rp.ctl, rp.saved.entries, rp.pos + 1, rp.pos);
    rp.pos++;
    this.rpShow();
  }
  private rpShow() {
    const rp = this.rp;
    if (!rp) return;
    this.game = rp.ctl.game;
    if (rp.pos >= rp.saved.entries.length) this.rpPause();
    void this.loadImages().then(() => this.paint());
    this.paint();
  }
  private rpPause() {
    const rp = this.rp;
    if (!rp || rp.timer === undefined) return;
    window.clearInterval(rp.timer);
    rp.timer = undefined;
  }
  private rpPlay() {
    const rp = this.rp;
    if (!rp || rp.timer !== undefined) return;
    if (rp.pos >= rp.saved.entries.length) this.rpBuild(0);
    rp.timer = window.setInterval(() => this.rpStep(), 700);
  }
  private rpPrev() {
    this.rpPause();
    this.rpBuild(Math.max(0, (this.rp?.pos ?? 0) - 1));
  }
  private rpNext() {
    this.rpPause();
    this.rpStep();
  }
  private stopRp() {
    this.rpPause();
    this.rp = undefined;
    this.ui?.next.removeClass("is-hidden");
  }
  private startRp(session: BattleSession) {
    // 画面の上のバーも「次へ」ボタンも出さない。操作は、キーだけ (スペース: 再生・停止 / ← →: 前・次)
    this.ui.next.addClass("is-hidden");
    this.rp = { saved: session.replay!, session, ctl: undefined as unknown as BattleController, pos: 0, bad: 0 };
    this.rpBuild(0);
    this.rpPlay(); // 開いたら、自動再生
  }

  // 対戦の履歴を保存する (1つのコントローラーにつき、1回。終わったとき・途中でやめた/新しい対戦に替わったとき)
  private session?: BattleSession;
  private savedCtl?: BattleController;
  private saveHistory(result?: SavedBattle["result"]) {
    const ctl = this.ctl;
    const s = this.session;
    if (!ctl || !s || s.seed === undefined || this.savedCtl === ctl || !ctl.record.length) return;
    this.savedCtl = ctl;
    const w = ctl.game.over?.winner;
    this.onSave({
      version: 1,
      self: s.self ?? "",
      opp: s.opp ?? "",
      seed: s.seed,
      mode: this.oppMode,
      result: result ?? (ctl.game.over ? (w === VIEWER ? "win" : w === undefined ? "draw" : "lose") : "unfinished"),
      turns: ctl.game.turn,
      ...(ctl.aiTokens.input || ctl.aiTokens.output ? { tokens: { ...ctl.aiTokens } } : {}),
      date: new Date().toISOString(),
      entries: ctl.record,
      ...(ctl.aiNotes.length ? { notes: ctl.aiNotes } : {}),
      ...(s.aiMulligan ? { aiMulligan: s.aiMulligan } : {}),
      log: [...ctl.game.log],
    });
  }
  private oppMode: "cpu" | "claude" | "passive" = "passive";

  async begin() {
    this.saveHistory(); // 開き直し・新しい対戦に替わる前の対戦を、保存する
    this.stopRp();
    const session = this.getSession();
    this.session = session;
    const { game, rules } = session ?? sampleBattle();
    this.game = game;
    this.rules = rules;
    const foe = this.game.players.find((p) => p !== VIEWER);
    const opp = this.getOpp();
    this.oppMode = opp;
    this.ctl = session && !session.replay ? new BattleController(game, rules, VIEWER, session.rng ?? Math.random, opp === "cpu" ? foe : undefined, opp === "claude" ? foe : undefined) : undefined; // リプレイのときは、操作できない (this.ctl 無し)・Claude の API も呼ばない
    if (this.ctl) this.ctl.aiMemo = session?.oppMemo ?? ""; // 相手のデッキのメモ
    this.lookSeen = this.game.handLook?.n ?? 0; // 開いたとき、前の「見た」は、出さない
    this.tried.clear();
    this.askEl = undefined;
    this.targeting = undefined;
    this.tbar = undefined;
    this.menu = undefined;
    this.build(await this.getSide());
    await this.loadImages();
    this.paint();
    this.bottoming = false;
    this.askCancel = undefined;
    this.mullEl = undefined;
    this.checkMulligan();
    void this.driveAi();
    if (session?.replay && session.rebuild) this.startRp(session);
    this.watcher?.disconnect(); // 開き直されても、監視は1つだけ
    this.watcher = new ResizeObserver(() => this.fit());
    this.watcher.observe(this.ui.stage);
    this.register(() => this.watcher?.disconnect());
    if (!this.keysOn) {
      this.keysOn = true;
      this.registerDomEvent(document, "keydown", (e) => {
        if (this.rp && this.app.workspace.getActiveViewOfType(BattleView) === this) {
          // リプレイ: → 次 / ← 前 / スペース 再生・停止
          if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === " ") {
            e.preventDefault();
            if (e.key === "ArrowRight") this.rpNext();
            else if (e.key === "ArrowLeft") this.rpPrev();
            else if (this.rp.timer !== undefined) this.rpPause();
            else this.rpPlay();
            return;
          }
        }
        // 対戦中: スペースキーで、右下のボタン (「次へ」「解決する」「攻撃する」「ブロックする」「確定」…) を押す。質問の画面が出ている間・入力欄に打っている間は、効かない
        if (e.key === " " && this.ctl && !this.rp && !this.askEl && !this.mullEl && this.app.workspace.getActiveViewOfType(BattleView) === this) {
          const t = e.target as HTMLElement | null;
          if (t && (t.isContentEditable || /^(input|textarea|select|button)$/i.test(t.tagName))) return;
          e.preventDefault();
          if (!e.repeat && !this.ui.next.disabled) this.ui.next.click();
          return;
        }
        if (e.key !== "Escape") return;
        const look = this.ui?.stage.querySelector(".mtg-bt-handlook");
        if (look) return look.remove(); // 相手の手札の表示を閉じる
        if (this.askEl) this.cancelAsk();
        else if (this.targeting) this.endTargeting(); // 途中でやめるのは Esc だけ
        else this.closeMenu();
      });
      this.registerDomEvent(this.contentEl, "click", (e) => {
        if (this.targeting) return this.clickTarget(e);
        if (this.combatSel && this.clickCombat(e)) return;
        if (!(e.target as HTMLElement).closest(".mtg-bt-menu")) this.closeMenu(); // 捕捉の段階で閉じる (そのあと、クリックしたカードが、必要なら開き直す)
      }, true);
      this.registerDomEvent(this.contentEl, "dblclick", (e) => {
        if (this.combatSel?.kind === "assign") this.assignClick(e, "focus");
        else if (this.targeting || (this.combatSel && this.combatTid(e))) e.stopPropagation();
      }, true);
      this.registerDomEvent(this.contentEl, "contextmenu", (e) => void (this.combatSel?.kind === "assign" && this.assignClick(e, "down")), true); // 右クリック: −1
    }
  }
  private keysOn = false;

  // ---- 画面の骨組み (作り直すたびに、前の状態を捨てる)
  private build(side?: { preview: HTMLElement; log: HTMLElement }) {
    this.els.clear();
    this.logSig = "";
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-bt");
    const stage = root.createDiv("mtg-bt-stage");
    for (const [k, v] of [["--bw", CARD_W], ["--bh", CARD_H], ["--hw", HAND_W], ["--hh", HAND_H], ["--tx", TAP_EXTRA / 2]] as const) stage.style.setProperty(k, `${v}px`); // カードの大きさ (src/battle/layout.ts)
    stage.style.setProperty("--back", `url("${cardBackUrl()}")`); // 山札の裏面の絵 (読めなければ、CSS の代わりの絵)
    const inner = side ? undefined : root.createDiv("mtg-bt-side"); // サイドバーを使うなら、プレビューとログは、そちらに出す
    const board = stage.createDiv("mtg-bt-board");
    const rows: Record<string, HTMLElement> = {};
    for (const key of ["opp-lands", "opp-others", "opp-creatures", "self-creatures", "self-others", "self-lands"]) rows[key] = board.createDiv({ cls: `mtg-bt-row mtg-bt-${key}` });
    const belt = board.createDiv("mtg-bt-belt"); // 真ん中の帯: だれのターンか・フェイズの進み・ステップ
    const turn = belt.createDiv("mtg-bt-turn");
    const phase = belt.createDiv("mtg-bt-phase");
    const step = belt.createDiv("mtg-bt-step");
    const gauge = belt.createDiv("mtg-bt-gauge");
    const gfill = gauge.createDiv("mtg-bt-gaugefill");
    const hand = stage.createDiv("mtg-bt-hand");
    stage.createDiv({ cls: "mtg-bt-avatar is-opp" }).dataset.tid = this.game.players.find((p) => p !== VIEWER) ?? "";
    stage.createDiv({ cls: "mtg-bt-avatar is-self" }).dataset.tid = VIEWER;
    const oppLife = stage.createDiv({ cls: "mtg-bt-life is-opp" });
    const selfLife = stage.createDiv({ cls: "mtg-bt-life is-self" });
    const piles: Record<string, HTMLElement> = {};
    for (const key of ["opp-library", "opp-yard", "self-library", "self-yard"]) piles[key] = board.createDiv({ cls: `mtg-bt-deck is-${key}` }); // 盤面 (3D の面) の上に置く
    for (const [key, mine] of [["self-yard", true], ["opp-yard", false]] as const) piles[key].addEventListener("mouseenter", () => this.showYard(mine)); // 墓地にカーソルを合わせると、サイドバーに中身の一覧
    const mana = stage.createDiv("mtg-bt-mana");
    const banner = stage.createDiv("mtg-bt-banner");
    const next = stage.createEl("button", { cls: "mtg-bt-next mod-cta", text: "次へ" });
    next.addEventListener("click", () => {
      if (!this.ctl) return;
      if (this.targeting) {
        const t = this.targeting;
        if (t.picks[t.i].length >= t.slots[t.i].min) this.confirmTarget(); // 対象を選んでいる間は、「次へ」ボタンが「確定」になる
        return;
      }
      const sel = this.combatSel;
      if (sel?.kind === "attack" && sel.picks.size) this.run(() => this.ctl!.declareAttackers([...sel.picks])); // 攻撃するクリーチャーを選んでいれば、「攻撃する」
      else if (sel?.kind === "assign") this.run(() => this.ctl!.assign(Object.fromEntries(sel.vals))); // ダメージの割り振りを確定
      else if (sel?.kind === "block") this.run(() => this.ctl!.declareBlockers([...sel.pairs].map(([blocker, attacker]) => ({ blocker, attacker })))); // ブロックの指定 (選んでいなければ、空 = ブロックしない)
      else this.run(() => this.ctl!.next()); // 選んでいなければ、「次へ」(攻撃しない)
    });
    const stack = stage.createDiv("mtg-bt-stack");
    const preview = side ? side.preview : inner!.createDiv("mtg-bt-preview");
    preview.empty();
    preview.createDiv({ cls: "mtg-bt-hint", text: "カードにカーソルを合わせると、ここに画像と効果が出ます" });
    const log = side ? side.log : inner!.createDiv("mtg-bt-log");
    log.empty();
    delete log.dataset.sig;
    this.ui = { stage, rows, hand, phase, step, turn, gfill, selfLife, oppLife, piles, mana, belt, banner, next, stack, preview, log };
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
    this.paintGauge(m);
    this.paintFx(m);
    this.paintHandLook();
    if (m.over) this.saveHistory(); // 勝敗が付いたとき
    this.fit();
    this.syncCombat(m);
    if (this.targeting) this.paintTargeting();
  }

  // 相手の手札を見たとき (lookHand): 相手の手札のカードを、表向きで、前 (盤面の上) に並べて見せる。クリックか Esc で閉じる (ゆっくり見られる。放っておいても、30秒で消える)
  private lookSeen = 0;
  private paintHandLook() {
    const h = this.game.handLook;
    if (!h || h.n <= this.lookSeen) {
      this.lookSeen = h?.n ?? 0; // 新しい対戦・戻る操作: 追いつく
      return;
    }
    this.lookSeen = h.n;
    if (h.of === VIEWER || !this.getFx()) return; // 自分の手札は、もう見えている。演出をオフにしていれば、出さない
    const g = this.game;
    const all = [...g.battlefield.map((p) => p.card), ...Object.values(g.hands).flat(), ...Object.values(g.graveyards).flat(), ...Object.values(g.exile).flat(), ...Object.values(g.libraries).flat()];
    const cards = h.ids.map((id) => all.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
    this.ui.stage.querySelector(".mtg-bt-handlook")?.remove();
    const box = this.ui.stage.createDiv("mtg-bt-handlook");
    box.createDiv({ cls: "mtg-bt-handlook-title", text: `相手の手札 (${cards.length} 枚)` });
    box.createDiv({ cls: "mtg-bt-handlook-hint", text: "クリックか Esc で閉じる" });
    box.addEventListener("click", () => box.remove());
    const row = box.createDiv("mtg-bt-handlook-row");
    for (const c of cards) {
      const url = this.urls.get(c.name);
      const el = row.createDiv("mtg-bt-handlook-card");
      if (url) el.createEl("img", { attr: { src: url, alt: c.name, draggable: "false" } });
      else el.createDiv({ cls: "mtg-bt-face", text: c.name });
    }
    window.setTimeout(() => box.remove(), 30000);
  }

  // ダメージ・ライフの変化の演出: 数字が大きく出て、ふくらんで消える (設定でオフにできる)。クリーチャーのダメージが増えたとき・プレイヤーのライフが変わったとき。
  // 限界: 倒れて戦場から消えたクリーチャーには、出ない (消えた絵が無い)。最初の描画・前の描画と同じ局面では出さない
  private fxPrev = new Map<string, number>();
  private fx(host: HTMLElement | null | undefined, text: string, cls: string) {
    if (!host) return;
    if (getComputedStyle(host).position === "static") host.addClass("mtg-bt-fxhost"); // 絶対配置の要素は、そのまま基準になる
    host.addClass("is-fx"); // 枠からはみ出して見せる
    const el = host.createDiv({ cls: `mtg-bt-fx ${cls}`, text });
    window.setTimeout(() => {
      el.remove();
      if (!host.querySelector(".mtg-bt-fx")) host.removeClass("is-fx");
    }, 1300);
  }
  private paintFx(m: BoardModel) {
    const now = new Map<string, number>();
    const st = this.ui.stage;
    for (const c of [...m.self.creatures, ...m.opp.creatures]) now.set(`d:${c.id}`, c.damage);
    now.set("l:self", m.self.life);
    now.set("l:opp", m.opp.life);
    const prev = this.fxPrev;
    this.fxPrev = now;
    if (!prev.size || !this.getFx()) return;
    for (const [key, n] of now) {
      const was = prev.get(key);
      if (was === undefined || was === n) continue;
      if (key.startsWith("d:")) {
        if (n > was) this.fx(st.querySelector<HTMLElement>(`[data-tid="${key.slice(2)}"]`), `−${n - was}`, "is-dmg");
      } else this.fx(key === "l:self" ? this.ui.selfLife : this.ui.oppLife, `${n > was ? "+" : "−"}${Math.abs(n - was)}`, n > was ? "is-heal" : "is-dmg");
    }
  }

  // 時間ゲージ (真ん中の帯の底)。「使えるものがあるときだけ止まる」で、何もできないときは、GAUGE_SEC 秒かけて左から右へ進み、終わったら自動で次へ進む (「次へ」で、待たずに進める)。
  // それ以外 (できることがある・「毎回止まる」・質問の途中) は、上限 (満タン) から動かない
  private paintGauge(m: BoardModel) {
    const fill = this.ui.gfill;
    const auto = !!this.ctl && this.getStops() === "smart" && m.idle && !this.ctl.pending && !this.targeting && !this.askEl;
    const key = auto ? `${m.turn}|${m.step}|${m.stack.map((s) => s.id).join()}|${this.game.log.length}` : "";
    if (key === this.gaugeKey) return; // 同じ局面は、そのまま (途中で巻き戻さない)
    this.gaugeKey = key;
    window.clearTimeout(this.gaugeTimer);
    fill.style.transition = "none";
    fill.style.transform = auto ? "scaleX(0)" : "scaleX(1)";
    if (!auto) return;
    void fill.offsetWidth; // 0 から始めるために、一度、描かせる
    fill.style.transition = `transform ${GAUGE_SEC}s linear`;
    fill.style.transform = "scaleX(1)";
    this.gaugeTimer = window.setTimeout(() => {
      fill.style.transition = "none";
      if (this.targeting || this.askEl || this.mullEl || this.ctl?.pending || this.game.mulligan) return void (this.gaugeKey = ""); // 操作の途中: 進めない (満タンで待つ)
      this.run(() => this.ctl!.next());
    }, GAUGE_SEC * 1000);
  }

  // ---- 戦闘の指定。攻撃: 攻撃するクリーチャーをクリックで選び (もう一度で解除)、「確定」。ブロック: ブロックする自分のクリーチャーをクリック → ブロック先の攻撃クリーチャーをクリック (割り当てたものを、もう一度クリックで解除)、「確定」
  private syncCombat(m: BoardModel) {
    const ch = this.ctl && !this.targeting && !this.askEl ? m.choice : undefined;
    this.choice = ch;
    if (!ch) this.combatSel = undefined;
    else if (!this.combatSel || this.combatSel.kind !== ch.kind) this.combatSel = ch.kind === "attack" ? { kind: "attack", picks: new Set() } : ch.kind === "assign" ? { kind: "assign", vals: new Map() } : { kind: "block", pairs: new Map() };
    const cs = this.combatSel;
    if (cs?.kind === "assign" && ch?.kind === "assign") {
      for (const it of ch.items) if (!cs.vals.has(it.attacker)) cs.vals.set(it.attacker, { ...it.defaults });
      for (const id of [...cs.vals.keys()]) if (!ch.items.some((it) => it.attacker === id)) cs.vals.delete(id);
    } else if (cs && ch && cs.kind !== "assign") {
      for (const id of [...(cs.kind === "attack" ? cs.picks : cs.pairs.keys())]) if (!ch.mine.includes(id)) (cs.kind === "attack" ? cs.picks.delete(id) : cs.pairs.delete(id)); // 選んだものが、選べなくなった (倒された・タップした)
      if (cs.kind === "block") {
        for (const [b, a] of [...cs.pairs]) if (ch.kind !== "block" || !ch.attackers.includes(a)) cs.pairs.delete(b);
        if (cs.cur && !ch.mine.includes(cs.cur)) cs.cur = undefined;
      }
    }
    this.paintCombat();
  }
  private combatTid(e: MouseEvent): string | undefined {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-tid]")?.dataset.tid;
    const ch = this.choice;
    if (id && ch?.kind === "assign") return ch.items.some((it) => it.blockers.some((b) => b.id === id)) ? id : undefined; // 割り振り: ブロッカーのカード
    return id && ch && ch.kind !== "assign" && (ch.mine.includes(id) || (ch.kind === "block" && ch.attackers.includes(id))) ? id : undefined;
  }
  // ダメージの割り振り: ブロッカーのカードを、クリックで +1 / Shift・右クリックで −1 / ダブルクリックで、そのブロッカーに集中 (攻撃クリーチャーは、ブロッカーから分かる)
  private assignClick(e: MouseEvent, mode: "up" | "down" | "focus"): boolean {
    const sel = this.combatSel;
    const ch = this.choice;
    const id = this.combatTid(e);
    if (sel?.kind !== "assign" || ch?.kind !== "assign" || !id) return false;
    const it = ch.items.find((x) => x.blockers.some((b) => b.id === id))!;
    const cur = sel.vals.get(it.attacker) ?? it.defaults;
    sel.vals.set(it.attacker, mode === "focus" ? focus(it, id) : bump(it, cur, id, mode === "up" ? 1 : -1));
    e.stopPropagation();
    e.preventDefault();
    this.paintCombat();
    return true;
  }
  private clickCombat(e: MouseEvent): boolean {
    const sel = this.combatSel!;
    if (sel.kind === "assign") return this.assignClick(e, e.shiftKey ? "down" : "up");
    const id = this.combatTid(e);
    if (!id) return false;
    e.stopPropagation();
    e.preventDefault();
    if (sel.kind === "attack") {
      if (sel.picks.has(id)) sel.picks.delete(id);
      else sel.picks.add(id);
    } else if (this.choice!.mine.includes(id)) {
      if (sel.pairs.has(id)) {
        sel.pairs.delete(id);
        sel.cur = undefined;
      } else sel.cur = sel.cur === id ? undefined : id;
    } else if (sel.cur) {
      sel.pairs.set(sel.cur, id);
      sel.cur = undefined;
    }
    this.paintCombat();
    return true;
  }
  private nextLabel = "次へ";
  // 攻撃するクリーチャー / ブロックの組を選んでいる間は、「次へ」ボタンが「攻撃する」「ブロックする」になる (選びを全部やめたら、「次へ」に戻る。ブロックは、「次へ」で、ブロックしないと宣言する)
  private canNext = true;
  private applyNextLabel() {
    const t = this.targeting;
    if (t) {
      // 対象を選んでいる間: 「次へ」ボタンが「確定」になる (足りない間は、押せない)。複数の対象を順に聞くときは、最後まで「次の対象へ」
      const slot = t.slots[t.i];
      const picks = t.picks[t.i].length;
      const range = slot.min === slot.max ? `${slot.max}` : `${slot.min}〜${slot.max}`;
      this.ui.next.setText(`${t.i < t.slots.length - 1 ? "次の対象へ" : "確定"} (${picks} / ${range})`);
      this.ui.next.disabled = picks < slot.min;
      return;
    }
    this.ui.next.disabled = !this.ctl || !this.canNext;
    const sel = this.combatSel;
    this.ui.next.setText(sel?.kind === "attack" && sel.picks.size ? `攻撃する (${sel.picks.size} 体)` : sel?.kind === "block" && sel.pairs.size ? `ブロックする (${sel.pairs.size} 体)` : sel?.kind === "assign" ? "ダメージを割り振る" : this.nextLabel);
  }
  private paintCombat() {
    this.applyNextLabel();
    const st = this.ui.stage;
    for (const el of Array.from(st.querySelectorAll(".is-cmb-able, .is-cmb-picked, .is-cmb-target, [data-block-to], [data-asgn]"))) {
      el.classList.remove("is-cmb-able", "is-cmb-picked", "is-cmb-target");
      delete (el as HTMLElement).dataset.blockTo;
      delete (el as HTMLElement).dataset.asgn;
    }
    this.cbar?.remove();
    this.cbar = undefined;
    const sel = this.combatSel;
    const ch = this.choice;
    if (!sel || !ch) return;
    const at = (id: string) => st.querySelector<HTMLElement>(`[data-tid="${id}"]`);
    const nameOf = (id: string) => this.game.battlefield.find((p) => p.id === id)?.card.name ?? id;
    if (sel.kind === "attack") {
      for (const id of ch.mine) at(id)?.classList.add(sel.picks.has(id) ? "is-cmb-picked" : "is-cmb-able"); // 攻撃の選択は、盤面の光りと「次へ」ボタンだけ (上の帯は出さない)
      return;
    }
    if (sel.kind === "block" && ch.kind === "block") {
      for (const id of ch.mine) at(id)?.classList.add(sel.pairs.has(id) ? "is-cmb-picked" : id === sel.cur ? "is-cmb-picked" : "is-cmb-able");
      if (sel.cur) for (const id of ch.attackers) at(id)?.classList.add("is-cmb-target"); // ブロックするクリーチャーを選んだら、ブロック先の候補 (攻撃クリーチャー) が光る
      for (const [b, a] of sel.pairs) {
        const el = at(b);
        if (el) el.dataset.blockTo = nameOf(a);
      }
      return; // ブロックの選択は、盤面の光りと「次へ」ボタンだけ (上の帯は出さない)
    }
    if (sel.kind === "assign" && ch.kind === "assign") {
      for (const it of ch.items) {
        const v = sel.vals.get(it.attacker) ?? it.defaults;
        for (const b of it.blockers) {
          const el = at(b.id);
          if (!el) continue;
          el.classList.add("is-cmb-able");
          el.dataset.asgn = `ダメージ ${v[b.id] ?? 0} (致死 ${b.lethal})`; // 相手のブロッカーに、自分の攻撃のダメージを何点載せるか
        }
        if (it.trample) {
          const rest = it.power - Object.values(v).reduce((a, n) => a + n, 0);
          const el = at(it.attacker);
          if (el) el.dataset.asgn = `相手へ ${rest}`;
        }
      }
      return; // 割り振りは、盤面のカードのクリックと「次へ」ボタンだけ (上の帯は出さない)
    }
    const bar = st.createDiv("mtg-bt-tbar");
    this.cbar = bar;
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
      ...(this.ctl && kind === "hand" ? { use: () => {
        const why = this.ctl!.whyNot(c.id); // カードを選んだ時点で、使えない理由 (マナが足りません、など) を出す
        if (why) return this.toast(why);
        this.askKick(c.name, this.ctl!.kickChoices(c.id), (cast) => this.ask(c.name, this.ctl!.needsForCard(c.id), (t) => this.askMana(c.name, { kind: "cast", card: c.id }, t, cast, (ids) => this.run(() => this.ctl!.use(c.id, t, cast, ids)))));
      } } : {}),
      ...(this.ctl && kind === "perm" ? { use: () => this.useAbility(c.id), pick: () => this.pickAbility(c.id) } : {}),
    }));
  }

  // 同じ名前の土地の山 (src/battle/boardModel.ts の LandStack)。自分の山は、ダブルクリックで、使える土地を1枚タップ
  // 土地の山: 手でタップする操作は無い (マナは、カードを使うとき、自動で払う)
  private stackItems(stacks: LandStack[], _mine: boolean): Item[] {
    return stacks.map((s) => ({ key: `stack:${s.name}`, data: s, name: s.name, paint: (el: HTMLElement) => this.fillStack(el, s) }));
  }

  // ---- 操作 (ルールはコントローラーにある。ここは、呼んで描き直すだけ)
  // 画面の下に、短いお知らせを出す (使えない理由など)
  private toastEl?: HTMLElement;
  private toast(text: string) {
    this.toastEl?.remove();
    const el = this.ui.stage.createDiv({ cls: "mtg-bt-toast", text });
    this.toastEl = el;
    window.setTimeout(() => el.remove(), 3200);
  }

  private run(f: () => unknown) {
    if (this.aiBusy) return; // 相手 (AI) が考えている間は、操作を受けない
    this.closeMenu();
    try {
      const r = f();
      if (typeof r === "string" && r) this.toast(r); // 失敗の理由 (コントローラーが返す) も、画面に出す
    } catch (e) {
      console.error(e); // 想定外の失敗: 質問は捨てて、画面は止めない
      this.ctl?.cancel();
    }
    void this.loadImages().then(() => this.paint());
    this.paint();
    void this.checkPending();
    this.checkMulligan();
    void this.driveAi();
  }

  // ---- Claude の AI の相手 (段階7)。判断が要るところで、盤面と選択肢を API に渡して、返事を実行する。失敗したら、以降は雑魚 CPU (ログに理由)。考えている間は、操作を受けない
  private aiBusy = false;
  private thinkEl?: HTMLElement;
  private async driveAi() {
    const ctl = this.ctl;
    if (!ctl?.aiActive || this.aiBusy || this.game.mulligan || ctl.pending) return; // 人への質問が出ている間は、人の番
    this.aiBusy = true;
    this.ui.next.disabled = true;
    try {
      const ai = ctl.game.players.find((p) => p !== VIEWER)!;
      for (let n = 0; n < 40 && this.ctl === ctl && ctl.aiActive && !ctl.game.over && !ctl.pending; n++) {
        if (ctl.aiWaiting()) this.thinkEl ??= this.ui.stage.createDiv({ cls: "mtg-bt-think", text: "相手 (AI) が考えている…" });
        const r = await aiStep(ctl, this.getAsk(), ai);
        if (this.ctl !== ctl || r !== "acted" || ctl.pending) break; // 人への質問が出たら、答えると、AI の行動が最初からやり直される
        this.paint();
      }
    } finally {
      this.aiBusy = false;
      this.thinkEl?.remove();
      this.thinkEl = undefined;
      this.paint();
      void this.checkPending();
      if (this.ctl !== ctl) void this.driveAi(); // 考えている間に、新しい対戦に替わった
    }
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

  // 払うマナの選択: 足りないマナを自動でタップするとき、種類の違う土地・マナ源から選べる余地があれば、どれをタップするか選ばせる (払えるだけ選ぶと、「確定」が押せる)。「自動」で、並んでいる順。余地が無ければ、聞かない。Esc で取り消し
  private askMana(title: string, a: Action, t: Record<string, string>, cast: { kicked?: boolean; teamwork?: boolean } | undefined, then: (ids?: string[]) => void) {
    const ctl = this.ctl!;
    const src = ctl.payChoice(a, t, cast);
    if (!src) return then();
    const box = this.ui.stage.createDiv("mtg-bt-ask");
    this.askEl = box;
    this.ui.stage.addClass("is-asking");
    this.askCancel = () => {}; // 取り消し: 何も起きない
    const head = box.createDiv("mtg-bt-asktitle");
    const picked: string[] = [];
    const ok = box.createEl("button", { cls: "mod-cta", text: "確定" });
    const tiles = box.createDiv("mtg-bt-asktiles");
    const tileOf = new Map<string, HTMLElement>();
    const sync = () => {
      const payable = ctl.payableWith(a, t, cast, picked);
      head.setText(`${title}: マナを出す土地を選ぶ (${picked.length} 枚)${payable ? " — 払えます" : ""}`);
      ok.disabled = !payable;
      for (const [id, el] of tileOf) {
        el.toggleClass("is-picked", picked.includes(id));
        el.toggleClass("is-off", payable && !picked.includes(id)); // もう払えるので、これ以上は選ばせない
      }
    };
    for (const s of src) {
      const tile = tiles.createDiv("mtg-bt-asktile");
      tileOf.set(s.id, tile);
      const url = this.urls.get(s.name);
      if (url) tile.createEl("img", { attr: { src: url, alt: s.name, draggable: "false" } });
      else tile.createDiv({ cls: "mtg-bt-face", text: s.name });
      tile.createDiv({ cls: "mtg-bt-manalabel", text: s.label });
      tile.addEventListener("mouseenter", () => void this.showPreview(s.name));
      tile.addEventListener("click", () => {
        const i = picked.indexOf(s.id);
        if (i >= 0) picked.splice(i, 1);
        else if (!ctl.payableWith(a, t, cast, picked)) picked.push(s.id);
        sync();
      });
    }
    box.appendChild(ok);
    const done = (ids?: string[]) => {
      box.remove();
      this.askEl = undefined;
      this.askCancel = undefined;
      this.ui.stage.removeClass("is-asking");
      then(ids);
    };
    ok.addEventListener("click", () => done([...picked]));
    box.createEl("button", { text: "自動で選ぶ" }).addEventListener("click", () => done());
    box.createDiv({ cls: "mtg-bt-askhint", text: "Esc で取り消し (何も起きなかったことになる)" });
    sync();
  }

  // 追加コスト (キッカーなど) を払えるマナがあるとき、払うかを選ばせる (そのあとで、対象を選ぶ)。選べなければ (払えない・追加コストが無い)、聞かずに、払わない。Esc で取り消し
  private askKick(name: string, choices: { flag: "kicked" | "teamwork"; cost: string }[], then: (cast?: { kicked?: boolean; teamwork?: boolean }) => void) {
    if (!choices.length) return then();
    const box = this.ui.stage.createDiv("mtg-bt-ask");
    this.askEl = box;
    this.ui.stage.addClass("is-asking");
    this.askCancel = () => {}; // 取り消し: 何も起きない
    box.createDiv({ cls: "mtg-bt-asktitle", text: `${name}: 追加コストを払って唱えますか?` });
    const row = box.createDiv("mtg-bt-askrow");
    const go = (cast?: { kicked?: boolean; teamwork?: boolean }) => {
      box.remove();
      this.askEl = undefined;
      this.askCancel = undefined;
      this.ui.stage.removeClass("is-asking");
      then(cast);
    };
    for (const c of choices) row.createEl("button", { cls: "mod-cta", text: `${c.flag === "kicked" ? "キッカー" : "チームワーク"} ${c.cost} を払って唱える` }).addEventListener("click", () => go({ [c.flag]: true }));
    row.createEl("button", { text: "払わずに唱える" }).addEventListener("click", () => go());
    box.createDiv({ cls: "mtg-bt-askhint", text: "Esc で取り消し (何も起きなかったことになる)" });
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
    if (req.kind === "discard" || req.kind === "choose" || req.kind === "order") await this.loadImages(req.cards.map((c) => c.name));
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
    } else if (req.kind === "discard" || req.kind === "choose" || req.kind === "target" || req.kind === "order") {
      const cards = req.kind === "target" ? req.choices : req.cards;
      const keep = req.kind === "discard" && req.cleanup ? req.cards.length - req.n : undefined; // クリンナップ: 残すカードを選ぶ (選ばなかったものが、墓地へ)
      const min = keep ?? (req.kind === "discard" ? req.n : req.kind === "order" ? cards.length : req.min);
      const max = keep ?? (req.kind === "discard" ? req.n : req.kind === "order" ? cards.length : req.max);
      const picked = new Set<string>();
      const ok = box.createEl("button", { cls: "mod-cta", text: "確定" });
      const count = head.createSpan();
      const sync = () => {
        if (req.kind === "order") {
          count.setText(`ライブラリーの${req.to === "top" ? "上" : "底"}に置く順番: 上にしたいカードから、順にクリック (${picked.size} / ${max})`);
          [...picked].forEach((id, i) => tileOf.get(id)?.setAttr("data-n", String(i + 1)));
          for (const [id, t] of tileOf) if (!picked.has(id)) t.removeAttribute("data-n");
          ok.disabled = picked.size !== max;
          return;
        }
        count.setText(title ? `${title} (${picked.size} / ${max})` : `${req.kind === "discard" ? (keep !== undefined ? `手札を ${keep} 枚にする: 残すカードを ${keep} 枚選ぶ` : `手札から ${req.n} 枚捨てる`) : req.kind === "target" ? `${req.card}: 対象を選ぶ` : "カードを選ぶ"} (${picked.size} / ${min === max ? max : `${min}〜${max}`})`);
        ok.disabled = picked.size < min || picked.size > max;
      };
      const tileOf = new Map<string, HTMLElement>();
      const tiles = box.createDiv("mtg-bt-asktiles");
      for (const c of cards) {
        const tile = tiles.createDiv("mtg-bt-asktile");
        tileOf.set(c.id, tile);
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
    this.ask(name, this.ctl!.needsForAbility(permId, index), (t) => this.askMana(name, { kind: "activate", perm: permId, index }, t, undefined, (ids) => this.run(() => this.ctl!.activate(permId, index, t, ids))));
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
    if (!t) return this.applyNextLabel();
    const slot = t.slots[t.i];
    const picks = t.picks[t.i];
    for (const id of slot.legal) st.querySelector(`[data-tid="${id}"]`)?.classList.add(picks.includes(id) ? "is-picked" : "is-target");
    this.applyNextLabel(); // 確定は、右下の「次へ」ボタン (上の帯は出さない)。やめるのは Esc
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
    if (c.power !== null && c.toughness !== null) {
      const pt = el.createDiv("mtg-bt-pt");
      pt.createSpan({ cls: c.powerMod ? `is-${c.powerMod}` : "", text: String(c.power) }); // 修整を受けている数字: 上がったら黄色、下がったら赤
      pt.createSpan({ text: "/" });
      pt.createSpan({ cls: c.toughnessMod ? `is-${c.toughnessMod}` : "", text: String(c.toughness) });
    }
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
    // 使い道に制限のあるマナ: 「◇1 (クリーチャー以外)」
    const T: Record<string, string> = { creature: "クリーチャー", instant: "インスタント", sorcery: "ソーサリー", artifact: "アーティファクト", enchantment: "エンチャント", land: "土地" };
    const tn = (s: string) => s.split("|").map((x) => T[x.toLowerCase()] ?? x).join("・");
    for (const r of m.manaSelf.restricted ?? []) el.createSpan({ cls: "mtg-bt-mc is-C", text: `${r.color && r.color !== "A" ? r.color : "◇"}${r.amount} (${r.notType ? `${tn(r.notType)}以外` : r.type ? `${tn(r.type)}用` : ""})` });
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
    this.nextLabel = m.nextLabel;
    this.canNext = m.canNext;
    this.applyNextLabel();
  }

  private paintBanner(m: BoardModel) {
    const el = this.ui.banner;
    const text = !m.over ? "" : m.over.winner === "self" ? "勝利" : m.over.winner === "opp" ? "敗北" : "引き分け";
    this.setText(el, text);
    el.toggleClass("is-on", text !== "");
  }

  private stackTexts = new Map<string, string>();
  private paintStack(m: BoardModel) {
    const el = this.ui.stack;
    const sig = JSON.stringify(m.stack);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.empty();
    // 一番上 (次に解決されるもの) は、カードの画像を大きく (効果を読んで、応答できるように)。能力なら、どの能力かも。残りは、1行ずつ
    [...m.stack].reverse().forEach((s, i) => {
      if (i === 0) {
        const big = el.createDiv({ cls: `mtg-bt-stackcard is-${s.controller}` });
        big.dataset.tid = s.id;
        if (s.image) big.createEl("img", { attr: { src: s.image, alt: s.name, draggable: "false" } });
        else big.createDiv({ cls: "mtg-bt-face", text: s.name });
        big.createDiv({ cls: "mtg-bt-stacklabel", text: s.label ? `${s.name} の能力 ${s.label}` : s.ability ? `${s.name} の能力` : `${s.controller === "self" ? "あなた" : "相手"}の呪文` });
        // 効果テキスト (カードのノートから。忠誠度能力は、使った能力だけ。モードは、選んだモードだけ)
        const body = big.createDiv("mtg-bt-stacktext");
        const fill = (text: string) => body.setText(stackEffectText(text, { typeLine: s.typeLine, loyalty: s.loyalty, loyaltyX: s.loyaltyX, modes: s.modes }));
        const cached = this.stackTexts.get(s.name);
        if (cached !== undefined) fill(cached);
        else void cardText(this.app, s.name).catch(() => "").then((t) => { this.stackTexts.set(s.name, t); if (body.isConnected) fill(t); });
        return;
      }
      const row = el.createDiv({ cls: `mtg-bt-stackitem is-${s.controller}`, text: `${s.ability ? "能力: " : ""}${s.name}` });
      row.dataset.tid = s.id;
    });
    el.toggleClass("is-on", m.stack.length > 0);
  }

  private paintLog(lines: string[]) {
    const sig = lines.join("\n");
    if (sig === this.logSig) return;
    this.logSig = sig;
    const el = this.ui.log;
    el.empty();
    // カード名は太字。ターンの始まりの行には、罫線 (ターンごとの区切り)
    const names = new Set<string>();
    const g = this.game;
    for (const c of [...g.battlefield.map((p) => p.card), ...g.stack.map((s) => s.card), ...Object.values(g.hands).flat(), ...Object.values(g.libraries).flat(), ...Object.values(g.graveyards).flat(), ...Object.values(g.exile).flat()]) names.add(c.name);
    const re = names.size ? new RegExp(`(${[...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`) : undefined;
    for (const l of lines) {
      const row = el.createDiv({ cls: `mtg-bt-logline${/^ターン \d+:/.test(l) ? " is-turn" : ""}` });
      if (!re) row.setText(l);
      else l.split(re).forEach((part, i) => (i % 2 ? row.createEl("strong", { text: part }) : part && row.createSpan({ text: part })));
    }
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
  // 墓地の中身の一覧 (サイドバー)。新しく入ったものが上
  private showYard(mine: boolean) {
    const p = this.game.players.find((x) => (x === VIEWER) === mine);
    if (p === undefined) return;
    const cards = [...(this.game.graveyards[p] ?? [])].reverse();
    this.previewSeq++; // 読み込み中のカードの表示を取り消す
    const el = this.ui.preview;
    el.empty();
    el.createDiv({ cls: "mtg-bt-pname", text: `${mine ? "あなた" : "相手"}の墓地 (${cards.length} 枚)` });
    if (!cards.length) return void el.createDiv({ cls: "mtg-bt-ptext", text: "(空)" });
    const list = el.createDiv("mtg-bt-yardlist");
    const detail = el.createDiv("mtg-bt-yarddetail"); // 一覧の下に、カーソルを合わせたカードの画像と効果 (一覧は消さない)
    let seq = 0;
    for (const c of cards) {
      const row = list.createDiv("mtg-bt-yardrow");
      const url = this.urls.get(c.name);
      if (url) row.createEl("img", { attr: { src: url, alt: c.name, draggable: "false" } });
      row.createSpan({ text: c.name });
      row.addEventListener("mouseenter", () => {
        const mine = ++seq;
        void cardText(this.app, c.name).catch(() => "").then((text) => {
          if (mine !== seq) return;
          detail.empty();
          const u = this.urls.get(c.name);
          if (u) detail.createEl("img", { attr: { src: u, alt: c.name } });
          detail.createDiv({ cls: "mtg-bt-pname", text: c.name });
          detail.createDiv({ cls: "mtg-bt-ptext", text: text || "(効果テキストが見つかりません)" });
        });
      });
    }
  }

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
