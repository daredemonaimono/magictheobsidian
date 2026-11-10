import { ItemView, WorkspaceLeaf } from "obsidian";
import { pedestalSvg } from "./battle/pedestalSvg";
import { localUrl } from "./imageCache";
import { TargetSlot } from "./battle/engine";
import { InputRequest } from "./battle/input";
import { Action } from "./battle/actions";
import { replay } from "./battle/replay";
import { SavedBattle } from "./battle/saved";
import { bump, focus } from "./battle/assignMath";
import { AskAi } from "./battle/ai";
import { AiAdvisor, aiStep, humanAsking } from "./battle/aiRun";
import { BattleController, StopMode } from "./battle/play";
import type { CastRecord } from "./battle/node";
import { stackEffectText } from "./battle/stackText";
import { BoardModel, CardView, CombatChoice, LandStack, PhaseId, SideView, boardModel, groupStack } from "./battle/boardModel";
import { frameClass } from "./battle/frame";
import { FRAME_H, FRAME_LINE, isWornFormat, pileScatter, FRAME_OUTLINE, FRAME_W, cropUrl, boardScale, frameImage, landFactor, CARD_H, CARD_W, GAP, GAUGE_SEC, HAND_H, HAND_W, LAYER_PX, TAP_EXTRA, overlapFor, pileLayers, rowNeed } from "./battle/layout";
import { BattleSession } from "./battle/deckToGame";
import { sampleBattle } from "./battle/sampleBattle";
import { Game, GameCard, RuleBook } from "./battle/state";
import { cardImage, cardInfo, cardText } from "./cards";

export const BATTLE_VIEW = "mtg-battle";

const PHASES: [PhaseId, string][] = [["beginning", "開始"], ["main1", "戦闘前メイン"], ["combat", "戦闘"], ["main2", "戦闘後メイン"], ["ending", "最終"]];
const MANA_COLORS = ["W", "U", "B", "R", "G", "A"] as const;
const VIEWER = "you";
// カウンターの印 (カードの縁に並べる): 種類ごとの色。決まっていない種類は、名前から、色を決める
const PIP_CLASS: Record<string, string> = { "+1/+1": "is-plus", "-1/-1": "is-minus", stun: "is-stun", charge: "is-charge", conqueror: "is-conq" };
const pipColor = (k: string): string => {
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 70% 55%)`;
};
// カーソルを合わせたときに出る文字: +1/+1 が 2 個なら +2/+2。それ以外は、名前 ×個数
const counterTip = (k: string, n: number): string => (k === "+1/+1" ? `+${n}/+${n}` : k === "-1/-1" ? `-${n}/-${n}` : `${COUNTER_JA[k] ?? k} ×${n}`);
const COUNTER_JA: Record<string, string> = { conqueror: "征服", stun: "麻痺", charge: "チャージ" }; // 画面に出すカウンターの名前 (無いものは、そのまま)

interface Entry {
  el: HTMLElement;
  sig: string; // 中身。同じなら、その要素は触らない
  use?: (e?: MouseEvent) => void; // ダブルクリック (使う)
  pick?: (e?: MouseEvent) => void; // 1回クリック (選ぶ。能力が複数あれば、一覧)
}
// 1つのゾーンに並べるもの。key = ゾーンの中で重ならない名前、data = 中身 (sig の元)、paint = 要素の中身の作り方
interface Item {
  key: string;
  data: unknown;
  name: string; // ホバーのプレビューに使うカード名
  paint: (el: HTMLElement) => void;
  use?: (e?: MouseEvent) => void;
  pick?: (e?: MouseEvent) => void;
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
    oppHand: HTMLElement;
    counts: Record<"opp" | "self", HTMLElement>;
    phase: HTMLElement;
    step: HTMLElement;
    turn: HTMLElement;
    gfill: HTMLElement;
    selfLife: HTMLElement;
    selfSpeed: HTMLElement;
    oppSpeed: HTMLElement;
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
  private combatSel?: { kind: "attack"; picks: Set<string>; targets: Map<string, string> } | { kind: "block"; pairs: Map<string, string>; cur?: string } | { kind: "assign"; vals: Map<string, Record<string, number>> };
  private choice?: CombatChoice;
  private cbar?: HTMLElement;
  private gaugeKey = ""; // いまのゲージが、どの局面のものか
  private gaugeTimer?: number;
  private waitAi = false; // AI の相手が、マリガンを決めている最中 (自分のマリガンは、そのあとに聞く)
  private mullEl?: HTMLElement; // マリガンのダイアログ (手札にカーソルを合わせて見られるよう、後ろの操作は止めない)
  private mullTried = new Set<string>();
  private frame = false; // 盤面のカードを、CSS で描いたフレームに、絵を入れて出す (設定「オリジナルフレーム」)
  private lf = { self: 0.85, opp: 0.85 }; // 土地の倍率 (枚数で変わる。layout.ts の landFactor)
  private scale = 1; // 盤の大きさに合わせた、カードの倍率 (オリジナルフレームのとき。fit で決める)
  private get cw() { return this.frame ? FRAME_W * this.scale : CARD_W; }
  private get ch() { return this.frame ? FRAME_H * this.scale : CARD_H; }
  private get tapExtra() { return this.frame ? 0 : this.ch - this.cw; } // 横向きにしたとき、列の中で余分に取る幅 (絵だけのときは、負)
  private imgLoading = new Set<Promise<unknown>>(); // 読み込み中の画像 (別の呼び出しが先に始めたものも、待てるように)
  private bottoming = false; // マリガンのキープのあと、底に置くカードを選んでいる
  private askCancel?: () => void; // いまの質問を Esc で取り消すときの動き (無ければ、操作の取り消し)
  private askEl?: HTMLElement; // 質問のダイアログ (捨てる・選ぶ・してもよい・支払う)
  private tried = new Set<string>(); // 画像を探したカード名
  private logSig = "";
  private previewSeq = 0;
  private watcher?: ResizeObserver;

  // getSession = 対戦の局面 (無ければ、サンプルの局面)。対戦を始め直したときは、begin() で読み直す
  constructor(leaf: WorkspaceLeaf, private getSession: () => BattleSession | undefined, private getStops: () => StopMode = () => "smart", private getOpp: () => "cpu" | "claude" | "passive" = () => "passive", private getFx: () => boolean = () => true, private getAsk: () => AskAi | undefined = () => undefined, private onSave: (b: SavedBattle) => void = () => {}, private getSide: () => Promise<{ preview: HTMLElement; log: HTMLElement } | undefined> = async () => undefined, private getAdvisor: () => AiAdvisor | undefined = () => undefined, private getCardStyle: () => "full" | "frame" = () => "frame", private getAvatar: (k: "cpu" | "player" | "sleeve" | "pedestal") => string | undefined = () => undefined) {
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
      ...(s.coin ? { coin: true as const } : {}),
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
    if (this.ctl) {
      this.ctl.aiMemo = session?.oppMemo ?? ""; // 相手のデッキのメモ
      this.ctl.aiShared = session?.shared ?? ""; // 共通ルール
      if (session?.opp && session.self) this.ctl.aiDecks = { mine: session.opp, foe: session.self };
    }
    this.lookSeen = this.game.handLook?.n ?? 0; // 開いたとき、前の「見た」は、出さない
    this.effectSeen = this.game.effects?.length ?? 0; // 前の効果の表示も、出さない
    this.pendingEffects = [];
    this.effectsEl = undefined;
    this.tried.clear();
    this.mullTried.clear();
    this.peeking = false;
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
    this.waitAi = !!session?.pendingAi;
    this.checkMulligan();
    if (session?.pendingAi) {
      void session.pendingAi.then(() => {
        if (this.session !== session) return; // 待っているあいだに、閉じた・別の対戦に替わった
        this.waitAi = false;
        void this.loadImages().then(() => this.paint());
        this.paint();
        this.checkMulligan();
        void this.driveAi();
      });
    }
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
        else if (this.targeting) this.endTargeting(); // 途中でやめるのは Esc か、選んだ対象をもう一度クリックして 0 にする
        else this.closeMenu();
      });
      this.registerDomEvent(this.contentEl, "click", (e) => {
        if (this.targeting) return this.clickTarget(e);
        if (this.suppressClick) {
          this.suppressClick = false;
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        if (this.combatSel && this.clickCombat(e)) return;
        if (!(e.target as HTMLElement).closest(".mtg-bt-menu")) this.closeMenu(); // 捕捉の段階で閉じる (そのあと、クリックしたカードが、必要なら開き直す)
      }, true);
      this.registerDomEvent(this.contentEl, "mousedown", (e) => this.onAtkDown(e), true);
      this.registerDomEvent(document, "mousemove", (e) => this.onAtkMove(e));
      this.registerDomEvent(document, "mouseup", (e) => this.onAtkUp(e), true);
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
    const style = this.getCardStyle();
    this.frame = style === "frame";
    const stage = root.createDiv("mtg-bt-stage");
    stage.toggleClass("is-frame", this.frame);
    stage.toggleClass("is-worn", isWornFormat(this.session?.format)); // Vintage / Legacy: 山札と墓地を、使い込んだ見た目に
    const fi = frameImage();
    for (const [k, v] of [["--fw", fi.width], ["--fl", fi.left], ["--ft", fi.top]] as const) stage.style.setProperty(k, `${v}px`); // オリジナルフレームの、絵の窓に入れる画像の大きさと位置
    for (const [k, v] of [["--bw", this.cw], ["--bh", this.ch], ["--hw", HAND_W], ["--hh", HAND_H], ["--tx", this.tapExtra / 2]] as const) stage.style.setProperty(k, `${v}px`); // カードの大きさ (src/battle/layout.ts)
    const sleeve = this.getAvatar("sleeve"); // じゅまのカードスリーブ (ダッシュボードで登録)。無ければ、CSS で描いた標準の裏面 (--back-css)
    if (sleeve) stage.style.setProperty("--back", `url("${sleeve}")`); // 保存済みなら、そちら // 山札の裏面の絵 (読めなければ、CSS の代わりの絵)
    const inner = side ? undefined : root.createDiv("mtg-bt-side"); // サイドバーを使うなら、プレビューとログは、そちらに出す
    const board = stage.createDiv("mtg-bt-board");
    const rows: Record<string, HTMLElement> = {};
    for (const key of ["opp-lands", "opp-others", "opp-creatures", "self-creatures", "self-others", "self-lands"]) rows[key] = board.createDiv({ cls: `mtg-bt-row mtg-bt-${key}` });
    const belt = board.createDiv("mtg-bt-belt"); // 真ん中の帯: だれのターンか・フェイズの進み・ステップ
    const status = stage.createDiv("mtg-bt-status"); // 右下の状況ラベル (アリーナと同じ): 進行のアイコン・だれのターンか・ステップ。優先権のゲージは、その底
    const phase = status.createDiv("mtg-bt-phase");
    const turn = status.createDiv("mtg-bt-turn");
    const step = status.createDiv("mtg-bt-step");
    const gauge = status.createDiv("mtg-bt-gauge");
    const gfill = gauge.createDiv("mtg-bt-gaugefill");
    const hand = stage.createDiv("mtg-bt-hand");
    stage.createDiv("mtg-bt-wall is-l"); // フィールドの左右の外の壁 (レンガ。枠のときだけ見える。CSS)
    stage.createDiv("mtg-bt-wall is-r");
    const counts = { opp: stage.createDiv("mtg-bt-counts is-opp"), self: stage.createDiv("mtg-bt-counts is-self") }; // 手札・山札・追放・墓地の枚数 (右上 = 相手、左下 = 自分)
    const oppHand = stage.createDiv("mtg-bt-opphand"); // 相手の手札 (裏向き): 上の端から、扇形に垂れ下がる (枠のときだけ表示。CSS)
    for (const [side, kind, tid] of [["opp", "cpu", this.game.players.find((p) => p !== VIEWER) ?? ""], ["self", "player", VIEWER]] as const) {
      const av = stage.createDiv({ cls: `mtg-bt-avatar is-${side}` }); // 台座の上の画像 (ダッシュボードで登録。無ければ、光の玉)
      av.dataset.tid = tid;
      for (const c of ["glow", "ring", "aura", "img", "wing is-l", "wing is-r"]) av.createDiv(`mtg-bt-av-${c}`); // 光・輪・絵・左右の羽根 (CSS)
      const url = this.getAvatar(kind);
      if (url) {
        av.addClass("has-img");
        av.style.setProperty("--av", `url("${url}")`);
      }
      if (this.frame) { // 台座 (皿・刃・光) は、SVG。ターンの色は、CSS の --ag で変わる
        const parse = (x: string) => new DOMParser().parseFromString(x, "image/svg+xml").documentElement;
        av.prepend(parse(pedestalSvg(!!url, this.getAvatar("pedestal"))));
        av.addClass("is-svg");
      }
    }
    const oppLife = stage.createDiv({ cls: "mtg-bt-life is-opp" });
    const selfLife = stage.createDiv({ cls: "mtg-bt-life is-self" });
    const oppSpeed = stage.createDiv({ cls: "mtg-bt-speed is-opp" });
    const selfSpeed = stage.createDiv({ cls: "mtg-bt-speed is-self" });
    const piles: Record<string, HTMLElement> = {};
    for (const key of ["opp-library", "opp-yard", "self-library", "self-yard"]) piles[key] = board.createDiv({ cls: `mtg-bt-deck is-${key}` }); // 盤面 (3D の面) の上に置く
    for (const [key, mine] of [["self-yard", true], ["opp-yard", false]] as const) { piles[key].addEventListener("mouseenter", () => this.showYard(mine)); piles[key].addEventListener("click", () => this.openYard(mine)); } // 墓地にカーソルを合わせると、サイドバーに中身の一覧。クリックすると、参照画面 (扇形・遡るバー)
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
      if (sel?.kind === "attack" && sel.picks.size) this.run(() => this.ctl!.declareAttackers([...sel.picks], sel.targets.size ? Object.fromEntries(sel.targets) : undefined)); // 攻撃するクリーチャーを選んでいれば、「攻撃する」。プレインズウォーカーに向けたものは、その攻撃先も
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
    this.ui = { stage, rows, hand, oppHand, counts, phase, step, turn, gfill, selfLife, oppLife, selfSpeed, oppSpeed, piles, mana, belt, banner, next, stack, preview, log };
  }

  // 画像の URL: カード名でノートを引いて、保存済みの URL を使う (新しい通信はしない)。無いカードは、名前と P/T の代わりの面
  private async loadImages(extra: string[] = []) {
    const g = this.game;
    const cards = [...g.battlefield.map((p) => p.card), ...Object.values(g.hands).flat(), ...Object.values(g.graveyards).flat(), ...Object.values(g.exile).flat(), ...Object.values(g.libraries).flat(), ...g.stack.map((s) => s.card)];
    // 絵はカード名で引く。デッキで選んだ版・トークンの絵があれば、それ (同じ名前なら、自分のデッキのものを先に)
    const art = new Map<string, string>();
    for (const c of [...cards].sort((a, b) => Number(a.owner !== VIEWER) - Number(b.owner !== VIEWER))) if (c.art && !art.has(c.name)) art.set(c.name, c.art);
    for (const a of new Set(cards.flatMap((c) => (c.art ? [c.art] : [])))) {
      if (this.tried.has(`art:${a}`)) continue;
      this.tried.add(`art:${a}`);
      void localUrl(a).then((u) => u && (this.urls.set(`art:${a}`, u), this.paint())); // 同じ名前でも、絵の違うカードは、絵ごとに引く
    }
    const names = new Set<string>([...g.battlefield.map((p) => p.card.name), ...Object.values(g.hands).flat().map((c) => c.name), ...Object.values(g.graveyards).flat().map((c) => c.name), ...g.stack.map((s) => s.card.name), ...extra]);
    const loading = Promise.all(
      [...names].filter((n) => !this.tried.has(`${n}|${art.get(n) ?? ""}`)).map(async (n) => {
        this.tried.add(`${n}|${art.get(n) ?? ""}`);
        const info = cardInfo(this.app, n);
        const url = art.get(n) ?? (info ? await cardImage(this.app, info.file) : undefined);
        const local = await localUrl(url); // 保存済みの画像 (通信しない)
        const crop = this.frame ? await localUrl(cropUrl(url)) : undefined; // オリジナルフレーム用の、絵の部分だけの画像。両方そろってから入れる (絵が先に出て、あとで入れ替わらないように)
        if (crop) this.urls.set(`crop:${n}`, crop);
        if (local) this.urls.set(n, local);
      }),
    );
    this.imgLoading.add(loading);
    void loading.finally(() => this.imgLoading.delete(loading));
    await loading;
  }

  // ---- 描く (BoardModel を、差分だけ更新)
  private paint() {
    const m = boardModel(this.game, this.rules, VIEWER, (c) => (c.art && this.urls.get(`art:${c.art}`)) || this.urls.get(c.name)); // 絵違いは、その絵 (無ければ、名前で引いた絵)
    const ui = this.ui;
    if (this.frame) {
      // 土地の大きさは、枚数で変わる (多いほど小さく)。変わったときだけ、変数を直す
      for (const [side, v, row] of [["self", m.self.landStacks, ui.rows["self-lands"]], ["opp", m.opp.landStacks, ui.rows["opp-lands"]]] as const) {
        const f = landFactor(v.reduce((a, x) => a + x.cards.length, 0));
        this.lf[side] = f;
        row.style.setProperty("--lf", String(f));
      }
    }
    this.sync(ui.rows["opp-lands"], "opp-lands", this.stackItems(m.opp.landStacks, false));
    this.sync(ui.rows["opp-others"], "opp-others", this.cardItems(m.opp.others, "opp"));
    this.sync(ui.rows["opp-creatures"], "opp-creatures", this.cardItems(m.opp.creatures, "opp"));
    this.sync(ui.rows["self-creatures"], "self-creatures", this.cardItems(m.self.creatures, "perm"));
    this.sync(ui.rows["self-others"], "self-others", this.cardItems(m.self.others, "perm"));
    this.sync(ui.rows["self-lands"], "self-lands", this.stackItems(m.self.landStacks, true));
    this.sync(ui.hand, "hand", this.cardItems(m.self.hand, "hand"));
    this.paintOppHand(m.opp.handCount);
    this.paintCounts(m);
    const lag = [...this.charged.values()].some((t0) => Date.now() - t0 < 300) ? 130 : 0; // 突撃中は、ぶつかる瞬間に、減らす
    for (const [el, life, side] of [[ui.selfLife, m.self.life, "self"], [ui.oppLife, m.opp.life, "opp"]] as const) {
      const prev = this.lastLife[side];
      if (lag && prev !== undefined && life < prev) {
        this.lastLife[side] = life;
        const r = el.getBoundingClientRect(), box = ui.stage.getBoundingClientRect();
        window.setTimeout(() => {
          el.removeClass("is-hit");
          void el.offsetWidth;
          el.addClass("is-hit");
          window.setTimeout(() => el.removeClass("is-hit"), 1000);
          this.dmgPop(r.left + r.width / 2 - box.left, r.top - box.top, prev - life);
          this.setText(el, String(life), life);
        }, lag);
      } else {
        this.hitLife(el, life, side);
        this.setText(el, String(life), life);
      }
    }
    for (const [el, side] of [[ui.selfSpeed, m.self], [ui.oppSpeed, m.opp]] as const) {
      el.toggleClass("is-on", !!side.speed);
      el.toggleClass("is-max", (side.speed ?? 0) >= 4);
      el.setText(side.speed ? `速度 ${side.speed}${side.speed >= 4 ? " 最高" : " / 4"}` : "");
      el.setAttr("aria-label", "速度 (Start your engines!): 自分のターンに、相手がライフを失うと、1ターンに1回 1 上がる。4 が最高速度");
    }
    this.paintPile(ui.piles["self-library"], m.self.library, undefined, 1);
    this.paintPile(ui.piles["self-yard"], m.self.graveyard, m.self.graveyardTop, 2);
    // 墓地から使えるものがあるとき: 墓地の山が、紫に光る
    ui.piles["self-yard"].toggleClass("is-yard-playable", !!this.ctl && this.game.graveyards[VIEWER].some((c) => this.ctl!.yardActions(c.id).some((a) => a.usable)));
    this.paintPile(ui.piles["opp-library"], m.opp.library, undefined, 3);
    this.paintPile(ui.piles["opp-yard"], m.opp.graveyard, m.opp.graveyardTop, 4);
    this.paintMana(m);
    ui.belt.toggleClass("is-on", m.combat);
    this.paintPhase(m);
    this.paintBanner(m);
    this.paintStack(m);
    this.paintLog(m.log);
    this.paintGauge(m);
    this.paintFx(m);
    this.paintHandLook();
    this.paintEffects();
    if (m.over) this.saveHistory(); // 勝敗が付いたとき
    this.fit();
    this.syncCombat(m);
    if (this.targeting) this.paintTargeting();
  }

  // 相手の手札を見たとき (lookHand): 相手の手札のカードを、表向きで、前 (盤面の上) に並べて見せる。クリックか Esc で閉じる (ゆっくり見られる。放っておいても、30秒で消える)
  // スタックを使わない効果の発動 (Dredge・伝説のルール・置換効果): スタックの「解決する」ではなく、「確認」のボタンつきで、スタックの上に出す。確認を押すまで、残る (ゲームの進行は止めない)
  private effectSeen = 0;
  private pendingEffects: { text: string; card?: string }[] = [];
  private effectsEl?: HTMLElement;
  private paintEffects() {
    const list = this.game.effects ?? [];
    if (list.length < this.effectSeen) {
      this.effectSeen = 0; // 新しい対戦・戻る操作: 追いつく
      this.pendingEffects = [];
    }
    this.pendingEffects.push(...list.slice(this.effectSeen));
    this.effectSeen = list.length;
    if (this.pendingEffects.length > 6) this.pendingEffects.splice(0, this.pendingEffects.length - 6);
    this.renderEffects();
  }
  private renderEffects() {
    if (!this.effectsEl?.isConnected) this.effectsEl = this.ui.stage.createDiv("mtg-bt-effects");
    const el = this.effectsEl;
    el.empty();
    for (const e of this.pendingEffects) {
      const row = el.createDiv("mtg-bt-effect");
      row.createSpan({ text: `効果: ${e.text}` });
      row.createEl("button", { text: "確認", cls: "mod-cta" }).addEventListener("click", () => {
        this.pendingEffects = this.pendingEffects.filter((x) => x !== e);
        this.renderEffects();
      });
    }
    el.toggleClass("is-on", this.pendingEffects.length > 0);
  }
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
    const g = this.game;
    const sec = this.frame ? (g.step === "combat" ? 0.12 : 0.3) : GAUGE_SEC; // 自分に、できること (ブロック・インスタント・起動など) が何も無いときは、待たずに、すぐ進める (枠のとき。戦闘は特に速く)。できることがあるときは、ゲージが動かず、止まる
    fill.style.transition = `transform ${sec}s linear`;
    fill.style.transform = "scaleX(1)";
    this.gaugeTimer = window.setTimeout(() => {
      fill.style.transition = "none";
      if (this.targeting || this.askEl || this.mullEl || this.ctl?.pending || this.game.mulligan) return void (this.gaugeKey = ""); // 操作の途中: 進めない (満タンで待つ)
      this.run(() => this.ctl!.next());
    }, sec * 1000);
  }

  // ---- 戦闘の指定。攻撃: 攻撃するクリーチャーをクリックで選び (もう一度で解除)、「確定」。ブロック: ブロックする自分のクリーチャーをクリック → ブロック先の攻撃クリーチャーをクリック (割り当てたものを、もう一度クリックで解除)、「確定」
  private syncCombat(m: BoardModel) {
    const ch = this.ctl && !this.targeting && !this.askEl ? m.choice : undefined;
    this.choice = ch;
    if (!ch) this.combatSel = undefined;
    else if (!this.combatSel || this.combatSel.kind !== ch.kind) this.combatSel = ch.kind === "attack" ? { kind: "attack", picks: new Set(), targets: new Map() } : ch.kind === "assign" ? { kind: "assign", vals: new Map() } : { kind: "block", pairs: new Map() };
    const cs = this.combatSel;
    if (cs?.kind === "assign" && ch?.kind === "assign") {
      for (const it of ch.items) if (!cs.vals.has(it.attacker)) cs.vals.set(it.attacker, { ...it.defaults });
      for (const id of [...cs.vals.keys()]) if (!ch.items.some((it) => it.attacker === id)) cs.vals.delete(id);
    } else if (cs && ch && cs.kind !== "assign") {
      for (const id of [...(cs.kind === "attack" ? cs.picks : cs.pairs.keys())]) if (!ch.mine.includes(id)) { if (cs.kind === "attack") { cs.picks.delete(id); cs.targets.delete(id); } else cs.pairs.delete(id); } // 選んだものが、選べなくなった (倒された・タップした)
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
      if (sel.picks.has(id)) {
        sel.picks.delete(id);
        sel.targets.delete(id);
      } else sel.picks.add(id); // 相手のプレイヤーへの攻撃 (プレインズウォーカーへは、掴んで、ドラッグ)
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
  // ダメージ数字: ぶつかった瞬間に、赤い「-N」が浮かんで消える
  private dmgPop(x: number, y: number, n: number) {
    const el = this.ui.stage.createDiv({ cls: "mtg-bt-dmg", text: `-${n}` });
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    window.setTimeout(() => el.remove(), 1000);
  }
  // 衝撃: ぶつかった所に、白い閃光と、橙の火花 (x, y = ステージの中の座標)
  private hit = new Set<string>();
  private impact(x: number, y: number) {
    const fx = this.ui.stage.createDiv({ cls: "mtg-bt-impact" });
    fx.style.left = `${x}px`;
    fx.style.top = `${y}px`;
    for (let i = 0; i < 9; i++) {
      const s = fx.createDiv("mtg-bt-spark");
      const ang = (i / 9) * Math.PI * 2 + i;
      s.style.setProperty("--dx", `${Math.cos(ang) * (28 + (i % 3) * 14)}px`);
      s.style.setProperty("--dy", `${Math.sin(ang) * (22 + (i % 3) * 12)}px`);
    }
    window.setTimeout(() => fx.remove(), 700);
  }
  // 攻撃の見せ方: 攻撃クリーチャーは、ブロックが決まる (ブロッカーの宣言が済む) までは、動かず、オレンジの矢印を付けたまま待つ。決まったら、突撃: ブロックされていればブロッカーへ、されていなければ、攻撃先 (相手のプレイヤー = ライフの輪、プレインズウォーカー = そのカード) まで。突撃は、1 回の攻撃につき 1 回だけ
  private charged = new Map<string, number>();
  private aimCharge() {
    const st = this.ui.stage;
    const g = this.game;
    const at = (id: string) => st.querySelector<HTMLElement>(`[data-tid="${id}"]`);
    const attackers = g.battlefield.filter((p) => p.attacking);
    if (!attackers.length) {
      this.charged.clear();
      this.hit.clear();
      return;
    }
    const go = g.combatPhase === "firstStrike" || g.combatPhase === "damage" || g.combatPhase === "end" || (g.combatPhase === "blockers" && !!g.blockersDeclared?.length);
    const box = st.getBoundingClientRect();
    const mid = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    for (const p of attackers) {
      const a = at(p.id);
      if (!a) continue;
      a.classList.add("is-waiting"); // 攻撃待機: オレンジの矢印 (向きは、CSS。自分は上、相手は下)
      if (!go) continue;
      a.classList.remove("is-waiting");
      const t0 = this.charged.get(p.id);
      if (t0 !== undefined && Date.now() - t0 > 1000) continue; // もう終わった突撃は、動かさない
      const blocker = p.blockedBy?.[0] ? at(p.blockedBy[0]) : undefined;
      const tgtEl = blocker ?? (p.attackTarget && g.players.includes(p.attackTarget) ? (p.controller === VIEWER ? this.ui.oppLife : this.ui.selfLife) : p.attackTarget ? at(p.attackTarget) : undefined);
      const ra = a.getBoundingClientRect();
      if (tgtEl) {
        const rb = tgtEl.getBoundingClientRect();
        const ca = mid(ra), cb = mid(rb);
        a.style.setProperty("--cx", `${(cb.x - ca.x) * (blocker ? 0.9 : 0.85)}px`);
        a.style.setProperty("--cy", `${(cb.y - ca.y) * (blocker ? 0.9 : 0.85)}px`);
        if (t0 === undefined) {
          const pw = (el: HTMLElement | null | undefined) => Number(/^\s*(-?\d+)/.exec(el?.querySelector(".mtg-bt-pt")?.textContent ?? "")?.[1] ?? 0); // 表示されているパワー
          const dmgA = pw(a), dmgB = blocker ? pw(blocker) : 0;
          window.setTimeout(() => {
            this.impact(cb.x - box.left, cb.y - box.top); // ぶつかった瞬間: 閃光・火花
            if (blocker) {
              if (dmgA > 0) this.dmgPop(cb.x - box.left, cb.y - box.top, dmgA); // ブロッカーが受けたダメージ
              if (dmgB > 0) this.dmgPop(ca.x - box.left, ca.y - box.top, dmgB); // 攻撃クリーチャーが受けたダメージ
            }
          }, 130);
        }
      } else {
        a.style.removeProperty("--cx");
        a.style.removeProperty("--cy");
      }
      if (t0 === undefined) this.charged.set(p.id, Date.now());
      a.classList.add("is-charging");
    }
  }
  // 相手のプレインズウォーカー (攻撃先の候補)
  private oppWalkers(): string[] {
    return this.game.battlefield.filter((p) => p.controller !== VIEWER && /\bPlaneswalker\b/.test(p.card.typeLine)).map((p) => p.id);
  }
  // 攻撃先の矢印 (攻撃するクリーチャー → プレインズウォーカー)。from / to は、盤面のカードの id。drag = ドラッグ中の、カーソルまでの線
  private arrowsEl?: SVGSVGElement;
  private drawArrows(pairs: [string, string][], drag?: { id: string; x: number; y: number }, orb = false, links: [string, string][] = []) {
    this.arrowsEl?.remove();
    this.arrowsEl = undefined;
    const st = this.ui.stage;
    if (!pairs.length && !drag && !links.length) return;
    const box = st.getBoundingClientRect();
    const center = (id: string) => {
      const r = st.querySelector<HTMLElement>(`[data-tid="${id}"]`)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top } : undefined;
    };
    const svg = st.createSvg("svg", { cls: "mtg-bt-atkarrows" });
    const line = (a: { x: number; y: number }, b: { x: number; y: number }, ball = false) => {
      svg.createSvg("line", { attr: { x1: a.x, y1: a.y, x2: b.x, y2: b.y } });
      if (ball) return void svg.createSvg("circle", { cls: "mtg-bt-orb", attr: { cx: b.x, cy: b.y, r: 11 } }); // ブロックのドラッグ: 先頭に、光の玉
      const s = 9;
      svg.createSvg("polygon", { attr: { points: `${b.x},${b.y - s} ${b.x + s},${b.y} ${b.x},${b.y + s} ${b.x - s},${b.y}` } }); // 矢の先: ひし形
    };
    for (const [a, t] of pairs) {
      const p = center(a), q = center(t);
      if (p && q) line(p, q);
    }
    for (const [blocker, atk] of links) { // ブロックが決まった組: 攻撃クリーチャーの三角から、ブロッカーへ、黄色い光の線
      const p = center(atk), q = center(blocker);
      if (p && q) svg.createSvg("line", { cls: "mtg-bt-blink", attr: { x1: p.x, y1: p.y, x2: q.x, y2: q.y } });
    }
    if (drag) {
      const p = center(drag.id);
      if (p) line(p, { x: drag.x - box.left, y: drag.y - box.top }, orb);
    }
    this.arrowsEl = svg;
  }
  // 攻撃するクリーチャーを掴んで、相手のプレインズウォーカーまでドラッグ → その攻撃先にする。離した所にプレインズウォーカーが無ければ、何もしない
  private atkDrag?: { id: string; x: number; y: number; moved: boolean };
  private suppressClick = false;
  private onAtkDown(e: MouseEvent) {
    const sel = this.combatSel;
    if (e.button !== 0 || !sel || (sel.kind !== "attack" && sel.kind !== "block")) return;
    if (sel.kind === "attack" && !this.oppWalkers().length) return; // 攻撃は、プレインズウォーカーがいるときだけ、ドラッグで攻撃先を決める (いなければ、クリックで相手のプレイヤー)
    const id = this.combatTid(e);
    if (!id) return;
    if (sel.kind === "block" && !this.choice?.mine.includes(id)) return; // ブロックは、自分のクリーチャーを掴む
    this.atkDrag = { id, x: e.clientX, y: e.clientY, moved: false };
  }
  private onAtkMove(e: MouseEvent) {
    const d = this.atkDrag;
    const sel = this.combatSel;
    if (!d || !sel || (sel.kind !== "attack" && sel.kind !== "block")) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    this.drawArrows(sel.kind === "attack" ? [...sel.targets] : [], { id: d.id, x: e.clientX, y: e.clientY }, sel.kind === "block");
  }
  private onAtkUp(e: MouseEvent) {
    const d = this.atkDrag;
    this.atkDrag = undefined;
    const sel = this.combatSel;
    if (!d?.moved || !sel || (sel.kind !== "attack" && sel.kind !== "block")) return;
    this.suppressClick = true; // 離したあとに来る click は、選びの切り替えにしない
    window.setTimeout(() => (this.suppressClick = false), 0);
    const t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-tid]")?.dataset.tid;
    if (sel.kind === "attack") {
      if (t && this.oppWalkers().includes(t)) {
        sel.picks.add(d.id);
        sel.targets.set(d.id, t);
      }
    } else if (t && this.choice?.kind === "block" && this.choice.attackers.includes(t)) {
      sel.pairs.set(d.id, t); // 掴んだブロッカーを、攻撃クリーチャーまでドラッグ → そのブロック
      sel.cur = undefined;
    }
    this.paintCombat();
  }
  private paintCombat() {
    this.applyNextLabel();
    this.drawArrows([]);
    this.aimCharge();
    const st = this.ui.stage;
    st.dataset.cmb = this.combatSel?.kind ?? ""; // 攻撃 / ブロックで、光りの形を変える (CSS)
    for (const el of Array.from(st.querySelectorAll(".is-cmb-able, .is-cmb-picked, .is-cmb-target, .is-cmb-atk, .is-blocking-to, [data-block-to], [data-asgn]"))) {
      el.classList.remove("is-cmb-able", "is-cmb-picked", "is-cmb-target", "is-cmb-atk", "is-blocking-to");
      (el as HTMLElement).style.removeProperty("--bx");
      (el as HTMLElement).style.removeProperty("--by");
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
      for (const id of this.oppWalkers()) at(id)?.classList.add("is-cmb-target"); // 相手のプレインズウォーカー: 攻撃先の候補 (クリーチャーを掴んで、ここへドラッグ)
      this.drawArrows([...sel.targets]);
      return;
    }
    if (sel.kind === "block" && ch.kind === "block") {
      for (const id of ch.mine) at(id)?.classList.add(sel.pairs.has(id) ? "is-cmb-picked" : id === sel.cur ? "is-cmb-picked" : "is-cmb-able");
      for (const id of ch.attackers) at(id)?.classList.add("is-cmb-atk"); // 攻撃してきているクリーチャー: 下向きの三角 (オレンジ)
      if (sel.cur) for (const id of ch.attackers) at(id)?.classList.add("is-cmb-target"); // ブロックするクリーチャーを選んだら、ブロック先の候補 (攻撃クリーチャー) が光る
      for (const [b, a] of sel.pairs) {
        const el = at(b);
        if (!el) continue;
        el.dataset.blockTo = nameOf(a);
        el.classList.add("is-blocking-to"); // ブロックが決まったブロッカー: 黄色のドーム (動かさない)
        at(a)?.classList.add("is-blocked-atk"); // ブロックされる攻撃クリーチャー: 三角が黄色
      }
      this.drawArrows([], undefined, false, [...sel.pairs]);
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
      paint: (el) => this.fill(el, c, kind !== "hand"),
      ...(this.ctl && kind === "hand" ? { pick: () => this.pickHandAbility(c.id), use: () => {
        const why = this.ctl!.whyNot(c.id); // カードを選んだ時点で、使えない理由 (マナが足りません、など) を出す
        if (why) return this.toast(why);
        this.askDoor(c.name, this.ctl!.doorChoices(c.id), (door) => this.askKick(c.name, this.ctl!.kickChoices(c.id), this.ctl!.canCastNormally(c.id), c.id, (cast00) => this.askOptions(c.id, c.name, door ? { ...cast00, door } : cast00, (cast) => this.ask(c.name, this.ctl!.needsForCard(c.id), (t) => this.askMana(c.name, { kind: "cast", card: c.id }, t, cast, (ids) => this.run(() => this.ctl!.use(c.id, t, cast, ids)))))));
      } } : {}),
      ...(this.ctl && kind === "perm" ? { use: () => this.useAbility(c.id), pick: () => this.pickAbility(c.id) } : {}),
    }));
  }

  // 同じ名前の土地の山 (src/battle/boardModel.ts の LandStack)。自分の山は、ダブルクリックで、使える土地を1枚タップ
  // 土地の山: マナを出すだけのタップは、手でしない (マナは、カードを使うとき、自動で払う)。マナ以外の能力 (Wasteland・Strip Mine・フェッチランドなど) は、
  // ダブルクリックで、山の中の、使える土地の最初の1枚で起動する。能力が2つ以上ある土地は、1回クリックで、一覧を出す
  private stackItems(stacks: LandStack[], mine: boolean): Item[] {
    return stacks.map((s) => {
      const clicked = (e?: MouseEvent) => { const id = (e?.target as HTMLElement | undefined)?.closest?.<HTMLElement>("[data-tid]")?.dataset.tid; return s.cards.find((c) => c.id === id && this.ctl!.abilities(c.id).length > 0); };
      const usable = () => (mine && this.ctl ? s.cards.find((c) => !c.tapped && this.ctl!.abilities(c.id).some((a) => a.usable)) : undefined);
      return {
        key: `stack:${s.name}`,
        data: s,
        name: s.name,
        paint: (el: HTMLElement) => this.fillStack(el, s, mine),
        ...(mine && this.ctl ? {
          // 押したカードに、使える能力があれば、そのカードで。山の隙間 (カードでないところ) を押したら、使える土地の最初の1枚
          use: (e?: MouseEvent) => { const c = clicked(e) ?? usable(); if (c) this.useAbility(c.id); },
          pick: (e?: MouseEvent) => { const c = clicked(e) ?? s.cards.find((x) => this.ctl!.abilities(x.id).length >= 2); if (c && this.ctl!.abilities(c.id).length >= 2) this.pickAbility(c.id); },
        } : {}),
      };
    });
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
    if (!ctl?.aiActive || this.aiBusy || this.game.mulligan || humanAsking(ctl)) return; // 人への質問が出ている間は、人の番
    this.aiBusy = true;
    this.ui.next.disabled = true;
    try {
      const ai = ctl.game.players.find((p) => p !== VIEWER)!;
      for (let n = 0; n < 40 && this.ctl === ctl && ctl.aiActive && !ctl.game.over && !humanAsking(ctl); n++) {
        if (ctl.aiWaiting()) this.thinkEl ??= this.ui.stage.createDiv({ cls: "mtg-bt-think", text: "相手 (AI) が考えている…" });
        const r = await aiStep(ctl, this.getAsk(), ai, this.getAdvisor());
        if (this.ctl !== ctl || r !== "acted" || humanAsking(ctl)) break; // 人への質問が出たら、答えると、AI の行動が最初からやり直される
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
  // 「戦場を見る」: 大きな選択の画面 (マリガンなど) を、いったん透明にして、戦場を見られるようにする。押すと「選択に戻る」に変わる。あとで、戦場を見て選ぶ場面にも使う
  private peeking = false;
  private addPeek(box: HTMLElement) {
    const b = box.createEl("button", { cls: "mtg-st-peek" });
    const apply = () => {
      box.toggleClass("is-peek", this.peeking);
      b.setText(this.peeking ? "選択に戻る" : "戦場を見る");
    };
    b.addEventListener("click", () => {
      this.peeking = !this.peeking;
      apply();
    });
    apply();
  }

  // アリーナ風: 先攻 / 後攻の選択 → 「◯◯が先攻です」と手札 → キープ / マリガン。相手 (AI) が決めている間は、ボタン無しで待つ
  private checkMulligan() {
    this.mullEl?.remove();
    this.mullEl = undefined;
    const g = this.game;
    const m = g.mulligan;
    if (!this.ctl || !m) return;
    if (this.bottoming) return; // 底に置くカードの選択は、showAsk が出している
    const box = this.ui.stage.createDiv("mtg-bt-ask is-mull mtg-st");
    this.mullEl = box;
    this.addPeek(box);
    const head = box.createDiv("mtg-st-head");
    const title = head.createDiv("mtg-st-title");
    const sub = head.createDiv("mtg-st-sub");
    const row = box.createDiv("mtg-st-btns");
    const btn = (label: string, kind: "blue" | "orange", f: () => void, parent: HTMLElement = row) => {
      const b = parent.createEl("button", { cls: `mtg-st-btn is-${kind}`, text: label });
      b.addEventListener("click", f);
      return b;
    };
    if (g.firstChoice) {
      title.setText("先攻後攻を選んでください");
      sub.setText("先攻のプレイヤーは最初のドロー・ステップをスキップします。基本的には先攻が有利ですが、あえて後攻を選ぶ戦略もあります。");
      btn("後攻", "blue", () => this.run(() => this.ctl!.chooseFirst(false)));
      btn("先攻", "orange", () => this.run(() => this.ctl!.chooseFirst(true)));
      return;
    }
    const first = g.active === VIEWER;
    title.setText(first ? "あなたが先攻です" : "対戦相手が先攻です");
    const fan = box.createDiv("mtg-st-fan");
    box.insertBefore(fan, row);
    const hand = g.hands[VIEWER];
    for (const [i, c] of hand.entries()) {
      const mid = (hand.length - 1) / 2;
      const el = fan.createDiv("mtg-st-card");
      el.style.setProperty("--r", `${(i - mid) * 3}deg`);
      el.style.setProperty("--y", `${Math.round((i - mid) ** 2 * 5)}px`);
      const url = this.urls.get(c.name);
      if (url) el.createEl("img", { attr: { src: url, alt: c.name, draggable: "false" } });
      else el.createDiv({ cls: "mtg-bt-face", text: c.name });
    }
    const miss = hand.filter((c) => !this.urls.has(c.name) && !this.mullTried.has(c.name));
    if (miss.length) {
      for (const c of miss) this.mullTried.add(c.name); // 絵が無いカードで、くり返さない
      // マリガンで引き直した手札の絵: 自分で読み込み、ほかの呼び出しが読んでいる最中のものも待ってから、描き直す (先に始めた呼び出しの終わりを待たないと、絵が無いまま描いてしまう)
      void this.loadImages().then(() => Promise.all([...this.imgLoading])).then(() => this.mullEl && this.checkMulligan());
    }
    if (this.waitAi) return void sub.setText("対戦相手が7枚の手札をキープするかマリガンするかを選択しています。"); // 盤面は先に開く。自分のマリガンは、そのあと
    const foeN = (g.hands[g.players.find((p) => p !== VIEWER) ?? ""] ?? []).length;
    sub.setText(first ? "対戦相手が最初のマリガン選択を待っています。" : foeN < 7 ? `対戦相手は${7 - foeN}回マリガンし、${foeN}枚の手札をキープしました。` : "対戦相手は7枚の手札をキープしました。");
    const mullWrap = row.createDiv("mtg-st-col");
    const mull = btn("マリガン", "blue", () => this.run(() => this.ctl!.mulligan()), mullWrap);
    mull.disabled = m.count >= 7;
    if (!mull.disabled) mullWrap.createDiv({ cls: "mtg-st-note", text: `カード${m.count + 1}枚をライブラリーの一番下に置くことになります。` });
    btn(`${7 - m.count}枚でキープ`, "orange", () => {
      if (this.ctl!.keep() === "bottom") {
        this.bottoming = true;
        this.mullEl?.remove();
        this.mullEl = undefined;
        this.showBottom(m.count);
      } else this.run(() => undefined);
    });
    const powders = this.ctl.powderCards();
    if (powders.length) {
      const pr = box.createDiv("mtg-st-powder");
      for (const c of powders) pr.createEl("button", { text: `${c.name}: 手札を入れ替える` }).addEventListener("click", () => this.run(() => this.ctl!.powder(c.id)));
    }
  }
  // キープしたあと、マリガンした回数ぶん、手札からライブラリーの底に戻すカードを選ぶ (アリーナ風: 左にライブラリー、右に手札。ドラッグでなく、クリックで選ぶ。選んだカードは、ライブラリーの側に移る)
  private async showBottom(count: number) {
    const cards = this.game.hands[VIEWER].map((c) => ({ id: c.id, name: c.name }));
    await this.loadImages(cards.map((c) => c.name));
    await Promise.all([...this.imgLoading]);
    if (!this.game.mulligan || !this.bottoming) return; // 待っているあいだに、閉じた・開き直された
    this.askCancel = () => {
      this.bottoming = false;
      this.checkMulligan();
    };
    this.mullEl?.remove();
    const box = this.ui.stage.createDiv("mtg-bt-ask is-mull mtg-st");
    this.mullEl = box;
    this.addPeek(box);
    const head = box.createDiv("mtg-st-head");
    head.createDiv({ cls: "mtg-st-title", text: `${count}枚戻す` });
    head.createDiv({ cls: "mtg-st-sub", text: `ライブラリーの一番下に置く${count}枚を、クリックで選んでください。` });
    const mid = box.createDiv("mtg-st-mid");
    const lib = mid.createDiv("mtg-st-lib");
    lib.createDiv({ cls: "mtg-st-libtitle", text: "ライブラリー" });
    const libBox = lib.createDiv("mtg-st-libbox");
    const sl = this.getAvatar("sleeve");
    if (sl) libBox.createEl("img", { cls: "mtg-st-back", attr: { src: sl, alt: "", draggable: "false" } });
    else libBox.createDiv("mtg-st-back is-css");
    const picked = libBox.createDiv("mtg-st-picked");
    const fan = mid.createDiv("mtg-st-fan");
    const row = box.createDiv("mtg-st-btns");
    const back = row.createEl("button", { cls: "mtg-st-link", text: "← 手札を見直す" });
    back.addEventListener("click", () => this.askCancel?.());
    const done = row.createEl("button", { cls: "mtg-st-btn is-orange", text: "完了" });
    const chosen: string[] = [];
    const cardEl = (parent: HTMLElement, c: { id: string; name: string }, cls: string) => {
      const el = parent.createDiv(cls);
      const url = this.urls.get(c.name);
      if (url) el.createEl("img", { attr: { src: url, alt: c.name, draggable: "false" } });
      else el.createDiv({ cls: "mtg-bt-face", text: c.name });
      return el;
    };
    const render = () => {
      fan.empty();
      picked.empty();
      const rest = cards.filter((c) => !chosen.includes(c.id));
      for (const [i, c] of rest.entries()) {
        const mid = (rest.length - 1) / 2;
        const el = cardEl(fan, c, "mtg-st-card is-pick");
        el.style.setProperty("--r", `${(i - mid) * 3}deg`);
        el.style.setProperty("--y", `${Math.round((i - mid) ** 2 * 5)}px`);
        el.addEventListener("click", () => {
          if (chosen.length >= count) return;
          chosen.push(c.id);
          render();
        });
      }
      for (const [i, id] of chosen.entries()) {
        const c = cards.find((x) => x.id === id)!;
        const pe = cardEl(picked, c, "mtg-st-pickedcard");
        pe.style.setProperty("--i", String(i));
        pe.addEventListener("click", () => { // 選んだカードを、もう一度押すと、手札に戻る
          chosen.splice(chosen.indexOf(id), 1);
          render();
        });
      }
      done.disabled = chosen.length !== count;
    };
    done.addEventListener("click", () => {
      if (chosen.length !== count) return;
      this.bottoming = false;
      this.askCancel = undefined;
      this.run(() => this.ctl!.bottom([...chosen]));
    });
    render();
  }

  // 払うマナの選択: 足りないマナを自動でタップするとき、種類の違う土地・マナ源から選べる余地があれば、どれをタップするか選ばせる (払えるだけ選ぶと、「確定」が押せる)。「自動」で、並んでいる順。余地が無ければ、聞かない。Esc で取り消し
  private askMana(title: string, a: Action, t: Record<string, string>, cast: CastRecord | undefined, then: (ids?: string[]) => void) {
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

  // 唱えるときの、残りの選択: ファイレクシア・マナの払い方 → {X} の値 → Delve で追放する墓地のカード。選べるものだけ聞く。Esc で取り消し
  private askOptions(cardId: string, name: string, cast0: CastRecord | undefined, then: (cast?: CastRecord) => void) {
    const ctl = this.ctl!;
    const steps: ((cast: CastRecord | undefined, next: (c?: CastRecord) => void) => void)[] = [
      (cast, next) => {
        if (!ctl.phyChoice(cardId)) return next(cast);
        this.askButtons(`${name}: ファイレクシア・マナを、どちらで払う?`, [{ text: "マナで払う", cls: "mod-cta", value: false }, { text: "ライフで払う (2 点)", value: true }], (v) => next(v ? { ...cast, phyLife: true } : cast));
      },
      (cast, next) => {
        const max = ctl.xMax(cardId, cast);
        if (max === undefined) return next(cast);
        if (max === 0) return next({ ...cast, x: 0 });
        this.askButtons(`${name}: X はいくつ?`, Array.from({ length: Math.min(max, 12) + 1 }, (_, i) => ({ text: String(i), cls: i === Math.min(max, 12) ? "mod-cta" : undefined, value: i })), (v) => next({ ...cast, x: v as number }));
      },
      (cast, next) => {
        const d = ctl.delveChoices(cardId);
        if (!d) return next(cast);
        this.ui.stage.addClass("is-asking");
        this.askCancel = () => {};
        void this.loadImages(d.cards.map((x) => x.name)).then(() => this.showAsk({ kind: "choose", min: 0, max: d.max, cards: d.cards }, (ids) => {
          this.askEl?.remove();
          this.askEl = undefined;
          this.askCancel = undefined;
          this.ui.stage.removeClass("is-asking");
          next((ids as string[]).length ? { ...cast, delve: ids as string[] } : cast);
        }, `${name}: Delve で追放する墓地のカードを選ぶ (1 枚で、汎用マナ 1 点ぶん。選ばなくてもよい)`));
      },
    ];
    const run = (i: number, cast: CastRecord | undefined) => (i < steps.length ? steps[i](cast, (c) => run(i + 1, c)) : then(cast));
    run(0, cast0);
  }
  private askButtons(title: string, buttons: { text: string; cls?: string; value: boolean | number }[], then: (v: boolean | number) => void) {
    const box = this.ui.stage.createDiv("mtg-bt-ask");
    this.askEl = box;
    this.ui.stage.addClass("is-asking");
    this.askCancel = () => {};
    box.createDiv({ cls: "mtg-bt-asktitle", text: title });
    const row = box.createDiv("mtg-bt-askrow");
    for (const b of buttons)
      row.createEl("button", { ...(b.cls ? { cls: b.cls } : {}), text: b.text }).addEventListener("click", () => {
        box.remove();
        this.askEl = undefined;
        this.askCancel = undefined;
        this.ui.stage.removeClass("is-asking");
        then(b.value);
      });
    box.createDiv({ cls: "mtg-bt-askhint", text: "Esc で取り消し (何も起きなかったことになる)" });
  }

  // 追加コスト (キッカーなど) を払えるマナがあるとき、払うかを選ばせる (そのあとで、対象を選ぶ)。選べなければ (払えない・追加コストが無い)、聞かずに、払わない。Esc で取り消し
  // 部屋 (Room): どちらの扉の半分を唱えるか。選んだ扉の番号を返す (部屋でなければ、聞かずに undefined)
  private askDoor(name: string, doors: { door: 1 | 2; name: string; cost: string; usable: boolean }[], then: (door?: 1 | 2) => void) {
    if (!doors.length) return then();
    const box = this.ui.stage.createDiv("mtg-bt-ask");
    this.askEl = box;
    this.ui.stage.addClass("is-asking");
    this.askCancel = () => {};
    box.createDiv({ cls: "mtg-bt-asktitle", text: `${name}: どちらの扉を唱えますか?` });
    const row = box.createDiv("mtg-bt-askrow");
    for (const d of doors) {
      const b = row.createEl("button", { cls: "mod-cta", text: `${d.name} (${d.cost})` });
      b.disabled = !d.usable;
      b.addEventListener("click", () => {
        box.remove();
        this.askEl = undefined;
        this.askCancel = undefined;
        this.ui.stage.removeClass("is-asking");
        then(d.door);
      });
    }
    box.createDiv({ cls: "mtg-bt-askhint", text: "Esc で取り消し (何も起きなかったことになる)" });
  }
  private askKick(name: string, choices: { flag: "kicked" | "teamwork" | "alt"; cost: string }[], normalOk: boolean, cardId: string, then: (cast?: CastRecord) => void) {
    if (!choices.length) return then();
    const box = this.ui.stage.createDiv("mtg-bt-ask");
    this.askEl = box;
    this.ui.stage.addClass("is-asking");
    this.askCancel = () => {}; // 取り消し: 何も起きない
    box.createDiv({ cls: "mtg-bt-asktitle", text: `${name}: 追加コストを払って唱えますか?` });
    const row = box.createDiv("mtg-bt-askrow");
    const close = () => {
      box.remove();
      this.askEl = undefined;
      this.askCancel = undefined;
      this.ui.stage.removeClass("is-asking");
    };
    const go = (cast?: CastRecord) => {
      close();
      then(cast);
    };
    for (const c of choices) {
      const label = c.flag === "alt" ? `別のコスト (${c.cost}) で唱える` : `${c.flag === "kicked" ? "キッカー" : "チームワーク"} ${c.cost} を払って唱える`;
      row.createEl("button", { cls: "mod-cta", text: label }).addEventListener("click", () => {
        if (c.flag !== "alt") return go({ [c.flag]: true });
        const pitch = this.ctl!.pitchChoices(cardId);
        if (!pitch || pitch.cards.length <= pitch.n) return go({ alt: true }); // 選ぶ余地が無ければ、そのまま
        close(); // いまの質問を閉じて、追放するカードを選ばせる
        this.ui.stage.addClass("is-asking");
        this.askCancel = () => {};
        void this.loadImages(pitch.cards.map((p) => p.name)).then(() => this.showAsk({ kind: "choose", min: pitch.n, max: pitch.n, cards: pitch.cards }, (ids) => {
          this.askEl?.remove();
          this.askEl = undefined;
          this.askCancel = undefined;
          this.ui.stage.removeClass("is-asking");
          then({ alt: true, exile: ids as string[] });
        }, `${name}: 追放する手札のカードを選ぶ`));
      });
    }
    if (normalOk) row.createEl("button", { text: choices.some((c) => c.flag === "alt") && choices.length === 1 ? "通常のコストで唱える" : "払わずに唱える" }).addEventListener("click", () => go());
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
    if (!req || (req.kind === "choose" && req.for)) return; // AI の相手への質問は、人には出さない (driveAi が AI に聞く)
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
      head.setText(req.what === "exile" ? "墓地のカードを追放しますか?" : req.what.endsWith("?") ? req.what : `${req.what} をしますか?`);
      const row = box.createDiv("mtg-bt-askrow");
      row.createEl("button", { cls: "mod-cta", text: "はい" }).addEventListener("click", () => reply(true));
      row.createEl("button", { text: "いいえ" }).addEventListener("click", () => reply(false));
    } else if (req.kind === "pay") {
      head.setText(`{${req.n}} を支払いますか? (${req.why ?? "支払わないと、打ち消される"})`);
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
          count.setText(`${req.to === "stack" ? "同時の誘発を解決する順番: 先に解決したいものから" : `ライブラリーの${req.to === "top" ? "上" : "底"}に置く順番: 上にしたいカードから`}、順にクリック (${picked.size} / ${max})`);
          [...picked].forEach((id, i) => tileOf.get(id)?.setAttr("data-n", String(i + 1)));
          for (const [id, t] of tileOf) if (!picked.has(id)) t.removeAttribute("data-n");
          ok.disabled = picked.size !== max;
          return;
        }
        count.setText(title ? `${title} (${picked.size} / ${max})` : req.kind === "choose" && req.label ? `${req.label} (${picked.size} / ${max})` : `${req.kind === "discard" ? (keep !== undefined ? `手札を ${keep} 枚にする: 残すカードを ${keep} 枚選ぶ` : `手札から ${req.n} 枚捨てる`) : req.kind === "target" ? `${req.card}: 対象を選ぶ` : "カードを選ぶ"} (${picked.size} / ${min === max ? max : `${min}〜${max}`})`);
        ok.disabled = picked.size < min || picked.size > max;
        ok.setText(min === 0 && picked.size === 0 ? "何もしない" : "確定"); // 選ばなくてよい効果 (0 枚でもよい): 何も選ばずに押すと、何もしない。必ず選ぶ効果 (1 枚以上) は、「確定」のまま
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
  // 手札のカードを 1 回クリック: 手札から起動できる能力 (サイクリング) があれば、一覧を出す
  private pickHandAbility(cardId: string) {
    if (this.targeting || !this.ctl) return;
    const abs = this.ctl.handAbilities(cardId);
    this.closeMenu();
    if (!abs.length) return;
    const anchor = this.ui.stage.querySelector(`[data-id="${cardId}"]`) as HTMLElement | null;
    const name = this.game.hands[this.ctl.me]?.find((c) => c.id === cardId)?.name ?? "";
    const menu = this.ui.stage.createDiv("mtg-bt-menu");
    const box = anchor?.getBoundingClientRect();
    const st = this.ui.stage.getBoundingClientRect();
    if (box) menu.setCssStyles({ left: `${box.left - st.left}px`, top: `${Math.max(4, box.top - st.top - abs.length * 28 - 8)}px` });
    for (const a of abs) {
      const row = menu.createDiv({ cls: `mtg-bt-menuitem${a.usable ? "" : " is-off"}`, text: a.label });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!a.usable) return;
        this.closeMenu();
        this.ask(name, this.ctl!.needsForHandAbility(cardId, a.index), (t) => this.run(() => this.ctl!.activateHand(cardId, a.index, t)));
      });
    }
    this.menu = menu;
  }
  // 1回クリック: 能力が2つ以上あれば、一覧を出す
  private pickAbility(permId: string) {
    if (this.targeting) return;
    const abs = this.ctl!.abilities(permId);
    this.closeMenu();
    if (abs.length < 2) return;
    const anchor = Array.from(this.els.values()).find((e) => e.el.dataset.id === permId)?.el ?? this.ui.stage.querySelector(`[data-id="${permId}"], [data-tid="${permId}"]`);
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
    // 墓地のカードが対象のスロットは、盤面では選べないので、カードの一覧から選ばせる (Noxious Revival)。終わったら、残りのスロットを、盤面で選ぶ
    const gy = asked.filter((x) => x.zone === "graveyard");
    if (gy.length) {
      const rest = asked.filter((x) => x.zone !== "graveyard");
      const pre: Record<string, string> = {};
      const nameOf = (id: string) => Object.values(this.game.graveyards).flat().find((c) => c.id === id)?.name ?? id;
      const step = (i: number) => {
        if (i >= gy.length) {
          if (!rest.length) return done(pre);
          this.targeting = { title, slots: rest, i: 0, picks: rest.map(() => []), done: (t) => done({ ...pre, ...t }) };
          return this.paintTargeting();
        }
        const s = gy[i];
        const cards = s.legal.map((id) => ({ id, name: nameOf(id) }));
        void this.loadImages(cards.map((c) => c.name)).then(() => {
          this.askCancel = () => {}; // Esc: 何も起きなかったことになる
          this.showAsk({ kind: "choose", min: s.min, max: s.max, cards }, (v) => {
            this.askEl?.remove();
            this.askEl = undefined;
            this.askCancel = undefined;
            this.ui.stage.removeClass("is-asking");
            pre[s.as] = (v as string[]).join(",");
            step(i + 1);
          }, `${title}: 墓地のカードを選ぶ`);
        });
      };
      return step(0);
    }
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
    if (at >= 0 && t.i === 0 && !picks.length) return this.endTargeting(); // 選んだ対象をもう一度クリックして、0 に戻したら、取りやめ (「次へ」に戻る)。Esc と同じ
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
      const sig = `${JSON.stringify(it.data)}|${this.scale}|${this.lf.self}|${this.lf.opp}`;
      let entry = this.els.get(key);
      if (!entry) {
        const el = document.createElement("div");
        el.addEventListener("mouseenter", () => void this.showPreview(el.dataset.name ?? ""));
        el.addEventListener("click", (e) => this.entryOf(el)?.pick?.(e));
        el.addEventListener("dblclick", (e) => this.entryOf(el)?.use?.(e));
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
        const id = key.slice(zone.length + 1);
        const el = entry.el;
        this.els.delete(key);
        if (this.frame && zone !== "hand" && el.isConnected && !this.game.battlefield.some((p) => p.id === id) && !el.classList.contains("mtg-bt-landstack")) {
          el.className += " is-ash"; // 戦場を離れた (倒れた): 黒い灰になって崩れてから、消える
          el.style.pointerEvents = "none";
          window.setTimeout(() => el.remove(), 1300);
        } else el.remove();
      }
    }
  }

  private entryOf(el: HTMLElement): Entry | undefined {
    for (const e of this.els.values()) if (e.el === el) return e;
    return undefined;
  }

  // 1枚のカードの中身。画像があれば画像、無ければ名前の代わりの面。P/T と忠誠度は、あるものを両方出す
  private fill(el: HTMLElement, c: CardView, onBoard = false) {
    el.className = "mtg-bt-card";
    for (const [on, cls] of [[c.tapped, "is-tapped"], [c.attacking, "is-attacking"], [c.blocking, "is-blocking"], [c.sick, "is-sick"], [c.prepared, "is-prepared"], [c.token, "is-token"], [c.foil, "is-foil"], [c.exiled, "is-exiled"], [c.playable && !!this.ctl, "is-playable"]] as const) if (on) el.addClass(cls);
    el.empty();
    if (onBoard && this.frame) for (const f of frameClass({ ...c, frame: /\bLand\b|土地/.test(c.typeLine) ? cardInfo(this.app, c.name)?.frame : undefined }).split(" ")) el.addClass(f); // フレームの色 (CSS で描く)。土地は、ノートの frame (枠の版) も見る
    this.face(el, c, onBoard);
    if (onBoard && this.frame && c.damage > 0 && c.power !== null) el.createDiv("mtg-bt-wound"); // 傷: 赤い斜線 (ダメージが載っているクリーチャー)
    if (c.power !== null && c.toughness !== null) {
      const pt = el.createDiv("mtg-bt-pt");
      pt.createSpan({ cls: c.powerMod ? `is-${c.powerMod}` : "", text: String(c.power) }); // 修整を受けている数字: 上がったら黄色、下がったら赤
      pt.createSpan({ text: "/" });
      pt.createSpan({ cls: c.toughnessMod ? `is-${c.toughnessMod}` : "", text: String(c.toughness) });
    }
    if (c.loyalty !== undefined) el.createDiv({ cls: "mtg-bt-pt is-loyalty", text: String(c.loyalty) });
    if (c.damage > 0) el.createDiv({ cls: "mtg-bt-dmg", text: String(c.damage) });
    const counters = Object.entries(c.counters).filter(([k, n]) => k !== "loyalty" && n > 0);
    if (counters.length) {
      // カウンター: 種類ごとに色を変えた印を、カードの縁に並べる (アリーナと同じ。数字は書かない)。カーソルを合わせると、数が浮き出る (+1/+1 カウンター 2 個なら +2/+2)
      const pips = el.createDiv("mtg-bt-pips");
      for (const [k, n] of counters) pips.createDiv({ cls: `mtg-bt-pip ${PIP_CLASS[k] ?? ""}`, attr: { "data-tip": counterTip(k, n), ...(PIP_CLASS[k] ? {} : { style: `background:${pipColor(k)}` }) } });
    }
  }

  private face(el: HTMLElement, c: CardView, onBoard = false) {
    if (onBoard && this.frame) {
      // オリジナルフレーム: 名前の帯と、絵の窓 (カード画像の絵の部分だけ) を、枠の中に置く。枠は CSS
      const svg = el.createSvg("svg", { cls: "mtg-bt-fsvg", attr: { viewBox: `0 0 ${FRAME_W} ${FRAME_H}`, preserveAspectRatio: "none" } }); // 枠の線 (くびれた形)
      svg.createSvg("path", { attr: { d: FRAME_OUTLINE } });
      el.createDiv("mtg-bt-fpat"); // 絵の窓の左右に、少しだけ見える、色ごとの模様
      const lines = el.createSvg("svg", { cls: "mtg-bt-fsvg", attr: { viewBox: `0 0 ${FRAME_W} ${FRAME_H}`, preserveAspectRatio: "none" } }); // 赤い立体筋は、模様の上・名前の帯と絵の窓の下 (帯と窓が、内側の半分を隠す)
      for (const k of ["k", "d", "l", "r"]) lines.createSvg("path", { cls: ["mtg-bt-fln", `fln-${k}`], attr: { d: FRAME_LINE } }); // 赤のカードだけ CSS で見える
      el.createDiv({ cls: "mtg-bt-fnm", text: c.name });
      const win = el.createDiv("mtg-bt-fart");
      const crop = this.urls.get(`crop:${c.name}`);
      const src = crop ?? c.image;
      if (src) {
        win.createEl("img", { attr: { src, alt: c.name, loading: "lazy", draggable: "false" } });
        if (crop || /art_crop/.test(src) || c.token) win.addClass("is-whole"); // 絵の部分だけの画像 (トークンなども) は、窓いっぱいに。カード全体の画像 (切り出せないとき) だけ、絵の部分を切り出す
      }
      return;
    }
    if (c.image) {
      el.createEl("img", { attr: { src: c.image, alt: c.name, loading: "lazy", draggable: "false" } });
    } else el.createDiv({ cls: "mtg-bt-face", text: c.name });
    // 継続効果で型が変わっているカード (Zhao の「Mountain になる」など): いまの型を、札の上に出す
    if (c.typeNow) el.createDiv({ cls: "mtg-bt-typenow", text: c.typeNow, attr: { title: `いまの型: ${c.typeLine} (継続効果で変わっている)` } });
  }

  // 土地の山: 立っている土地は少しずつずらして重ね、タップした土地は、横向きに倒して (枠のときは、少し傾けて灰色にして)、山の脇に並べる。2枚以上なら枚数を出す
  private fillStack(el: HTMLElement, s: LandStack, mine = true) {
    const k = this.frame ? this.lf[mine ? "self" : "opp"] : 1; // 土地の倍率
    const cw = this.cw * k, ch = this.ch * k, tx = (ch - cw) / 2; // 土地1枚の大きさと、横向きにしたときのずれ
    el.className = "mtg-bt-landstack";
    if (this.ctl && s.cards.some((c) => c.playable)) el.addClass("is-playable");
    el.empty();
    const standing = s.cards.filter((c) => !c.tapped);
    const tapped = s.cards.filter((c) => c.tapped);
    const pile = el.createDiv("mtg-bt-pile3d");
    const off = this.frame ? Math.max(3, Math.round(cw * 0.1)) : 5; // 同じ土地の重なり: 1 枚ごとに、カード幅の 1 割ずらす (Arena の見本)
    pile.style.width = `${cw + Math.max(0, standing.length - 1) * off}px`;
    standing.forEach((c, i) => {
      const card = pile.createDiv("mtg-bt-card");
      card.dataset.tid = c.id;
      card.style.left = `${i * off}px`;
      this.face(card, c, true);
    });
    if (tapped.length) {
      const side = el.createDiv("mtg-bt-tapgroup");
      const tilt = this.frame; // 枠のとき: 横に倒さず、少し傾けて立てる (灰色にして、タップのアイコンを重ねる。CSS)
      side.style.width = `${(tilt ? cw : ch) + (tapped.length - 1) * 14}px`;
      side.style.height = `${tilt ? ch : cw}px`;
      tapped.forEach((c, i) => {
        const card = side.createDiv("mtg-bt-card is-lying");
        card.dataset.tid = c.id;
        card.style.left = `${i * 14 + (tilt ? 0 : tx)}px`; // 横向き (縦と横が入れ替わる) が、i * 14 の位置に収まる
        card.style.top = `${tilt ? 0 : -tx}px`;
        this.face(card, c, true);
      });
    }
    if (s.cards.length > 1) el.createDiv({ cls: "mtg-bt-count", text: `×${s.cards.length}` });
  }

  // 山札・墓地: 盤面の上に立体で置く。枚数に応じた厚み (10 枚ごとに 1 層。層ごとに translateZ で高さを付ける)。山札は裏向き、墓地は一番上のカードを見せる。枚数を下に出す
  private paintPile(el: HTMLElement, count: number, top: CardView | undefined, seed: number) {
    const sig = `${count}|${top?.id ?? ""}|${top?.image ?? ""}|${this.scale}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.empty();
    const layers = pileLayers(count);
    el.toggleClass("is-empty", count === 0);
    // 層ごとに高さを付けて、本当の厚みにする。きれいに揃えず、層ごとに、少しずらして傾ける (一番上のカードは、控えめに)
    const tf = (i: number, k: number) => {
      const s = pileScatter(seed, i);
      return `translateZ(${i * LAYER_PX}px) translate(calc(var(--s, 1) * ${s.dx * k}px), calc(var(--s, 1) * ${s.dy * k}px)) rotate(${s.r * k}deg)`;
    };
    for (let i = 0; i < layers; i++) el.createDiv({ cls: `mtg-bt-layer${i % 2 ? " is-odd" : ""}` }).style.transform = tf(i, 1);
    const faceEl = el.createDiv("mtg-bt-dface");
    faceEl.style.transform = tf(layers, 0.6);
    if (top) this.face(faceEl, top);
    el.createDiv({ cls: "mtg-bt-dcount", text: String(count) });
  }

  // 相手の手札: 枚数ぶんの裏向きのカードを、上の端から、扇形に垂らす (--i = 真ん中からの位置)
  private paintOppHand(n: number) {
    const el = this.ui.oppHand;
    if (el.dataset.n === String(n)) return;
    el.dataset.n = String(n);
    el.empty();
    for (let i = 0; i < n; i++) el.createDiv("mtg-bt-ohcard").style.setProperty("--i", String(i - (n - 1) / 2));
  }

  // 枚数の表 (2 x 2)。相手 (右上): 手札・山札 / 追放・墓地。自分 (左下): 山札・手札 / 墓地・追放 (Arena の見本の並び)
  private paintCounts(m: BoardModel) {
    const rows: [("opp" | "self"), SideView, [string, string, number][]][] = [
      ["opp", m.opp, [["hand", "✋", m.opp.handCount], ["lib", "🂠", m.opp.library], ["exile", "🌀", m.opp.exile], ["yard", "🪦", m.opp.graveyard]]],
      ["self", m.self, [["lib", "🂠", m.self.library], ["hand", "✋", m.self.hand.length], ["yard", "🪦", m.self.graveyard], ["exile", "🌀", m.self.exile]]],
    ];
    for (const [side, , cells] of rows) {
      const el = this.ui.counts[side];
      const sig = cells.map((c) => c[2]).join(",");
      if (el.dataset.sig === sig) continue;
      el.dataset.sig = sig;
      el.empty();
      for (const [k, icon, n] of cells) {
        const cell = el.createDiv(`mtg-bt-count-cell is-${k}`);
        cell.createSpan({ cls: "mtg-bt-count-icon", text: icon });
        cell.createSpan({ text: String(n) });
      }
    }
  }

  // 墓地の参照画面 (Arena 風): 暗い幕の上に、タイトル・枚数・扇形のカード (新しいものが右の手前)・遡るバー・完了。バーを左へ動かすと、古いカードが出る (8 枚以上のとき)
  private yardEl?: HTMLElement;
  private openYard(mine: boolean) {
    const p = this.game.players.find((x) => (x === VIEWER) === mine);
    if (p === undefined) return;
    this.yardEl?.remove();
    const cards = [...(this.game.graveyards[p] ?? [])]; // 古い → 新しい
    const stage = this.ui.stage;
    const el = stage.createDiv({ cls: "mtg-bt-yardview", attr: { tabindex: "-1" } });
    this.yardEl = el;
    const close = () => {
      el.remove();
      if (this.yardEl === el) this.yardEl = undefined;
    };
    el.addEventListener("keydown", (e) => e.key === "Escape" && close());
    const w = Math.round(stage.clientWidth * 0.135);
    el.style.setProperty("--yw", `${w}px`);
    el.createDiv({ cls: "mtg-bt-yvtitle", text: mine ? "墓地" : "対戦相手の墓地" });
    el.createDiv({ cls: "mtg-bt-yvcount", text: String(cards.length) });
    const fan = el.createDiv("mtg-bt-yvfan");
    const SHOW = 7;
    const render = (start: number) => {
      fan.empty();
      const win = cards.slice(start, start + SHOW);
      win.forEach((c, j) => {
        const item = fan.createDiv({ cls: `mtg-bt-yvcard${j === win.length - 1 ? " is-last" : ""}` });
        item.style.setProperty("--j", String(j - (win.length - 1) / 2));
        item.style.zIndex = String(j + 1);
        const url = this.urls.get(c.art ? `art:${c.art}` : c.name) ?? this.urls.get(c.name);
        if (url) item.createEl("img", { attr: { src: url, alt: c.name, draggable: "false" } });
        else item.createDiv({ cls: "mtg-bt-face", text: c.name });
      });
    };
    render(Math.max(0, cards.length - SHOW));
    if (cards.length > SHOW) {
      const max = cards.length - SHOW;
      const bar = el.createEl("input", { cls: "mtg-bt-yvbar", attr: { type: "range", min: "0", max: String(max), step: "1" } });
      bar.value = String(max); // 右端 = いちばん新しい。左へ動かすと、過去へ遡る
      bar.addEventListener("input", () => render(Number(bar.value)));
    }
    const done = el.createEl("button", { cls: "mtg-bt-yvdone", text: "完了" });
    done.addEventListener("click", close);
    el.addEventListener("click", (e) => e.target === el && close()); // 幕のクリックでも閉じる
    el.focus();
  }

  // ライフが減ったら、輪が燃えるように光る (攻撃が当たった演出)
  private lastLife: Partial<Record<"self" | "opp", number>> = {};
  private hitLife(el: HTMLElement, life: number, side: "self" | "opp") {
    const prev = this.lastLife[side];
    this.lastLife[side] = life;
    if (prev === undefined || life >= prev) return;
    el.removeClass("is-hit");
    void el.offsetWidth; // アニメーションを、最初からやり直す
    el.addClass("is-hit");
    window.setTimeout(() => el.removeClass("is-hit"), 1000);
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
    if (!el.firstChild) for (const [id, label] of PHASES) el.createDiv({ attr: { "data-phase": id, "aria-label": label, title: label } });
    for (const child of Array.from(el.children) as HTMLElement[]) child.toggleClass("on", child.dataset.phase === m.phase);
    this.setText(this.ui.step, `ターン ${m.turn}・${m.step}`);
    const mine = m.activeSide === "self";
    this.setText(this.ui.turn, mine ? "あなたのターン" : "対戦相手のターン");
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
    // 古いものが左、新しいもの (次に解決されるもの) が右。カードが右へ重なっていく。カーソルを合わせたカードは、前面に出る。効果の説明 (能力ならどの能力か・効果テキスト) は、一番上のカードと、カーソルを合わせたカードに出る
    // 隣り合った同じ項目 (group が同じ) だけ、1 枚にまとめて、×N と出す (間に別のものがあれば、まとめない: 解決の順番が分かるように)
    const groups = groupStack(m.stack);
    groups.forEach(({ s, n }, i) => {
      const card = el.createDiv({ cls: `mtg-bt-stackcard is-${s.controller}${i === groups.length - 1 ? " is-top" : ""}` });
      if (n > 1) card.createDiv({ cls: "mtg-bt-stackcount", text: `×${n}` });
      card.dataset.tid = s.id;
      card.setCssStyles({ zIndex: String(i + 1) });
      if (s.image) card.createEl("img", { attr: { src: s.image, alt: s.name, draggable: "false" } });
      else card.createDiv({ cls: "mtg-bt-face", text: s.name });
      const detail = card.createDiv("mtg-bt-stackdetail");
      detail.createDiv({ cls: "mtg-bt-stacklabel", text: s.label ? `${s.name} の能力 ${s.label}` : s.ability ? `${s.name} の能力` : `${s.controller === "self" ? "あなた" : "相手"}の呪文` });
      // 効果テキスト (カードのノートから。忠誠度能力は、使った能力だけ。モードは、選んだモードだけ)
      const body = detail.createDiv("mtg-bt-stacktext");
      const fill = (text: string) => body.setText(stackEffectText(text, { typeLine: s.typeLine, loyalty: s.loyalty, loyaltyX: s.loyaltyX, modes: s.modes }));
      const cached = this.stackTexts.get(s.name);
      if (cached !== undefined) fill(cached);
      else void cardText(this.app, s.name).catch(() => "").then((t) => { this.stackTexts.set(s.name, t); if (body.isConnected) fill(t); });
      card.addEventListener("mouseenter", () => void this.showPreview(s.name));
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
    if (this.frame) {
      // 盤の大きさに合わせて、カードの大きさを変える。変わったら、大きさの変数と、土地の山の位置を直して描き直す
      ui.stage.style.setProperty("--persp", `${Math.round((ui.stage.clientHeight - 42) * 1.017)}px`); // 遠近の強さ: 盤の高さに比例させる (どの大きさでも、同じ見え方。盤の高さ = ステージの高さ - 上 6 - 下 36)
      const sc = boardScale(ui.stage.clientWidth, ui.stage.clientHeight);
      if (sc !== this.scale) {
        this.scale = sc;
        for (const [k, v] of [["--bw", this.cw], ["--bh", this.ch], ["--tx", this.tapExtra / 2]] as const) ui.stage.style.setProperty(k, `${v}px`);
        ui.stage.style.setProperty("--s", String(sc));
        ui.stage.style.setProperty("--s0", String(sc));
        this.paint();
      }
    }
    const set = (container: HTMLElement, need: number) => {
      const n = container.children.length;
      container.style.setProperty("--ov", `${overlapFor(need, n, container.clientWidth)}px`);
    };
    for (const row of Object.values(ui.rows)) {
      const kids = Array.from(row.children) as HTMLElement[];
      const isStacks = kids.some((k) => k.classList.contains("mtg-bt-landstack"));
      const lgap = this.frame ? this.cw * (row === ui.rows["self-lands"] ? this.lf.self : this.lf.opp) * 0.08 : GAP; // 土地の山どうしのすき間: カード幅の 8% (混み合うと、重ねる)
      const need = isStacks ? kids.reduce((a, k) => a + k.offsetWidth, 0) + Math.max(0, kids.length - 1) * lgap : rowNeed(this.cw, kids.length, kids.filter((k) => k.classList.contains("is-tapped")).length, this.tapExtra);
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
    // 縦のスタック (デッキ構築の画面と同じ): 1 枚ずつ、名前の帯だけを重ねて見せる。カーソルのあったカードが、前面に全体を出す。下に、そのカードの効果テキストと、墓地からの行動のボタン
    const stack = el.createDiv("mtg-bt-yardstack");
    const detail = el.createDiv("mtg-bt-yarddetail");
    let seq = 0;
    const showDetail = (c: GameCard) => {
      const mineSeq = ++seq;
      const acts = mine && this.ctl ? this.ctl.yardActions(c.id) : [];
      void cardText(this.app, c.name).catch(() => "").then((text) => {
        if (mineSeq !== seq) return;
        detail.empty();
        detail.createDiv({ cls: "mtg-bt-pname", text: c.name });
        detail.createDiv({ cls: "mtg-bt-ptext", text: text || "(効果テキストが見つかりません)" });
        // 自分の墓地: 墓地から起動できる能力・唱えられるカードは、ボタンで (Faerie Dreamthief・Timeline Culler)
        for (const a of acts) {
          const btn = detail.createEl("button", { cls: "mtg-bt-yardbtn", text: a.label });
          btn.disabled = !a.usable;
          btn.addEventListener("click", () => this.ask(c.name, this.ctl!.needsForYard(c.id, a.key), (t) => this.run(() => this.ctl!.useYard(c.id, a.key, t))));
        }
      });
    };
    for (const c of cards) {
      const item = stack.createDiv("mtg-bt-yarditem");
      const url = this.urls.get(c.art ? `art:${c.art}` : c.name) ?? this.urls.get(c.name);
      if (url) item.createEl("img", { attr: { src: url, alt: c.name, draggable: "false" } });
      else item.createDiv({ cls: "mtg-bt-face", text: c.name });
      // 墓地から起動できる・唱えられるカードは、紫に光る (使える状態のものは、強く。使えないものは、薄く)
      const acts = mine && this.ctl ? this.ctl.yardActions(c.id) : [];
      if (acts.length) item.addClass(acts.some((a) => a.usable) ? "is-yard-playable" : "is-yard-able");
      item.addEventListener("mouseenter", () => showDetail(c));
    }
    showDetail(cards[0]);
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
