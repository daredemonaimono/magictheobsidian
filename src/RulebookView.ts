import { ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { Proposal, parseRule, proposeUpdate, saveProposal, staleRule, compileCard } from "./cardrules";
import { describeAbility } from "./effects";
import { RbCard, Rulebook, collectRulebook } from "./rulebook";
import { Memo, hasBackup, readMemos, readRuleText, restoreBackup, writeMemos, writeRuleText } from "./rulestore";
import { Settings } from "./settings";
import { CATEGORIES, CATEGORY_EN, Status, TYPE_ENTRIES, TypeEntry, titleOf } from "./typecatalog";

export const RULEBOOK_VIEW = "mtg-rulebook";

const MARK: Record<Status, string> = { implemented: "✅", partial: "🟡", planned: "⬜" };
const STATUS_JA: Record<Status, string> = { implemented: "実装済み", partial: "一部だけ", planned: "未実装" };
type Tab = "types" | "cards" | "unsupported";

const problem = (c: RbCard): string => (c.needs && !c.rule ? "記録なし" : staleRule(c.rule) ? "古い記録" : c.rule?.unsupported.length ? "一部未対応" : c.rule ? "OK" : "不要");

// ルールブック: 実装されているルール(型)と、カードごとの処理の記録を見る・直す。保存先は隠しフォルダ (rulestore.ts)
export class RulebookView extends ItemView {
  private tab: Tab = "types";
  private search = "";
  private statusFilter = "all";
  private deckOnly = true;
  private cardFilter = "all";
  private expanded = new Set<string>(); // 開いている行 (View の open() と名前が重ならないように)
  private data?: Rulebook;
  private memos: Record<string, Memo> = {};
  private body!: HTMLElement;
  private proposal?: { key: string; p: Proposal; instruction: string };

  constructor(leaf: WorkspaceLeaf, private settings: Settings, private getKey: () => string | null) {
    super(leaf);
  }

  getViewType() {
    return RULEBOOK_VIEW;
  }
  getDisplayText() {
    return "ルールブック";
  }
  getIcon() {
    return "book-open";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-rb");
    const head = root.createDiv("mtg-rb-head");
    head.createEl("h2", { text: "ルールブック" });
    const tabs = head.createDiv("mtg-rb-tabs");
    const tabBtn = (t: Tab, label: string) => {
      const b = tabs.createEl("button", { text: label });
      b.toggleClass("is-on", this.tab === t);
      b.onclick = () => ((this.tab = t), void this.refresh(false), tabs.querySelectorAll("button").forEach((x) => x.removeClass("is-on")), b.addClass("is-on"));
    };
    tabBtn("types", "型(実装の状況)");
    tabBtn("cards", "カードの記録");
    tabBtn("unsupported", "未実装の効果");
    const search = head.createEl("input", { type: "text", placeholder: "検索" });
    search.oninput = () => ((this.search = search.value.trim().toLowerCase()), this.render());
    this.body = root.createDiv("mtg-rb-body");
    await this.refresh(true);
  }

  async refresh(reload: boolean) {
    if (reload || !this.data) {
      this.body.setText("読み込み中…");
      this.data = await collectRulebook(this.app);
      this.memos = await readMemos(this.app);
    }
    this.render();
  }

  private render() {
    this.body.empty();
    if (!this.data) return;
    if (this.tab === "types") this.renderTypes();
    else if (this.tab === "cards") this.renderCards();
    else this.renderUnsupported();
  }

  // ---- 型 ----

  private cardChips(parent: HTMLElement, keys: Iterable<string>) {
    const list = [...keys].map((k) => this.data!.cards.find((c) => c.key === k)).filter((c): c is RbCard => !!c).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return void parent.createSpan({ text: "(いまのデッキ・コレクション・記録には無い)", cls: "mtg-dim" });
    for (const c of list.slice(0, 60)) {
      const a = parent.createEl("a", { text: c.name, cls: "mtg-rb-chip", attr: { title: [c.decks.length ? `デッキ: ${c.decks.join(", ")}` : "", c.inCollection ? "コレクション" : ""].filter(Boolean).join(" / ") } });
      a.onclick = () => void this.app.workspace.openLinkText(c.key, "", true);
    }
    if (list.length > 60) parent.createSpan({ text: ` …ほか ${list.length - 60} 枚`, cls: "mtg-dim" });
  }

  private renderTypes() {
    const filter = createDiv("mtg-rb-filters");
    this.body.appendChild(filter);
    new Setting(filter).setName("状態").addDropdown((d) =>
      d.addOptions({ all: "すべて", implemented: "✅ 実装済み", partial: "🟡 一部だけ", planned: "⬜ 未実装", request: "要望あり" }).setValue(this.statusFilter).onChange((v) => ((this.statusFilter = v), this.render())),
    );
    const matches = (e: TypeEntry) =>
      (this.statusFilter === "all" || (this.statusFilter === "request" ? this.memos[e.id]?.request : e.status === this.statusFilter)) &&
      (!this.search || [e.id, e.title, titleOf(e), e.summary].some((t) => t.toLowerCase().includes(this.search)));
    for (const cat of CATEGORIES) {
      const entries = TYPE_ENTRIES.filter((e) => e.category === cat && matches(e));
      if (!entries.length) continue;
      const all = TYPE_ENTRIES.filter((e) => e.category === cat);
      const det = this.body.createEl("details", { cls: "mtg-rb-cat" });
      det.open = true;
      det.createEl("summary", { text: `${CATEGORY_EN[cat]} (${cat}) — ✅${all.filter((e) => e.status === "implemented").length} 🟡${all.filter((e) => e.status === "partial").length} ⬜${all.filter((e) => e.status === "planned").length}` });
      for (const e of entries) this.typeRow(det, e);
    }
  }

  private typeRow(parent: HTMLElement, e: TypeEntry) {
    const row = parent.createDiv("mtg-rb-entry");
    const head = row.createDiv("mtg-rb-entry-head");
    head.createSpan({ text: MARK[e.status], attr: { title: STATUS_JA[e.status] } });
    head.createSpan({ text: titleOf(e), cls: "mtg-rb-title" });
    head.createSpan({ text: e.title.match(/\((.+)\)$/)?.[1] ?? (e.title !== titleOf(e) ? e.title : ""), cls: "mtg-dim" });
    if (this.memos[e.id]?.request) head.createSpan({ text: "要望", cls: "mtg-rb-req" });
    const n = this.data!.usage.get(e.id)?.size ?? 0;
    if (n) head.createSpan({ text: `${n}枚`, cls: "mtg-dim" });
    row.createDiv({ text: e.summary, cls: "mtg-rb-summary" });
    const isOpen = this.expanded.has(e.id);
    head.onclick = () => (isOpen ? this.expanded.delete(e.id) : this.expanded.add(e.id), this.render());
    if (!isOpen) return;
    const body = row.createDiv("mtg-rb-detail");
    const sec = (title: string, text?: string) => text && (body.createEl("h4", { text: title }), body.createDiv({ text, cls: "mtg-rb-text" }));
    sec("どう実装されているか", e.impl);
    sec("制限・未対応", e.limits);
    if (e.shape) (body.createEl("h4", { text: "書き方(記録の JSON)" }), body.createEl("pre").createEl("code", { text: e.shape }));
    sec("例", e.example);
    body.createEl("h4", { text: "使っているカード" });
    this.cardChips(body.createDiv("mtg-rb-chips"), this.data!.usage.get(e.id) ?? []);
    body.createEl("h4", { text: "要望・メモ" });
    const area = body.createEl("textarea", { cls: "mtg-rb-memo", attr: { rows: "3", placeholder: "この型について、作ってほしいこと・気づいたこと" } });
    area.value = this.memos[e.id]?.memo ?? "";
    const save = async (patch: Partial<Memo>) => {
      this.memos[e.id] = { memo: area.value, request: this.memos[e.id]?.request ?? false, ...patch };
      await writeMemos(this.app, this.memos);
    };
    area.onchange = () => void save({});
    const req = body.createEl("label", { cls: "mtg-rb-reqlabel" });
    const cb = req.createEl("input", { type: "checkbox" });
    cb.checked = this.memos[e.id]?.request ?? false;
    req.createSpan({ text: " 作ってほしい(要望)" });
    cb.onchange = () => void save({ request: cb.checked }).then(() => this.render());
  }

  // ---- カード ----

  private renderCards() {
    const filter = createDiv("mtg-rb-filters");
    this.body.appendChild(filter);
    new Setting(filter).setName("対象").addDropdown((d) => d.addOptions({ deck: "デッキのカード", all: "デッキ・コレクション・記録のあるカード全部" }).setValue(this.deckOnly ? "deck" : "all").onChange((v) => ((this.deckOnly = v === "deck"), this.render())));
    new Setting(filter).setName("状態").addDropdown((d) => d.addOptions({ all: "すべて", problem: "問題あり", none: "記録なし", partial: "一部未対応", stale: "古い記録", ok: "OK" }).setValue(this.cardFilter).onChange((v) => ((this.cardFilter = v), this.render())));
    const cards = this.data!.cards.filter((c) => (!this.deckOnly || c.decks.length) && (!this.search || c.name.toLowerCase().includes(this.search)) && this.cardOk(c));
    this.body.createDiv({ text: `${cards.length} 枚`, cls: "mtg-dim" });
    for (const c of cards.slice(0, 200)) this.cardRow(this.body, c);
    if (cards.length > 200) this.body.createDiv({ text: `…ほか ${cards.length - 200} 枚 (検索で絞る)`, cls: "mtg-dim" });
  }

  private cardOk(c: RbCard) {
    const p = problem(c);
    return this.cardFilter === "all" || (this.cardFilter === "problem" ? !["OK", "不要"].includes(p) : this.cardFilter === "none" ? p === "記録なし" : this.cardFilter === "partial" ? p === "一部未対応" : this.cardFilter === "stale" ? p === "古い記録" : p === "OK");
  }

  private cardRow(parent: HTMLElement, c: RbCard) {
    const row = parent.createDiv("mtg-rb-entry");
    const head = row.createDiv("mtg-rb-entry-head");
    const p = problem(c);
    head.createSpan({ text: p === "OK" || p === "不要" ? "✅" : p === "記録なし" ? "⬜" : "🟡" });
    head.createSpan({ text: c.name, cls: "mtg-rb-title" });
    head.createSpan({ text: p, cls: "mtg-dim" });
    if (c.decks.length) head.createSpan({ text: c.decks.join(", "), cls: "mtg-rb-tag" });
    if (c.inCollection) head.createSpan({ text: "コレクション", cls: "mtg-rb-tag" });
    const isOpen = this.expanded.has(`card:${c.key}`);
    head.onclick = () => (isOpen ? this.expanded.delete(`card:${c.key}`) : this.expanded.add(`card:${c.key}`), this.render());
    if (!isOpen) return;
    const body = row.createDiv("mtg-rb-detail");
    const a = body.createEl("a", { text: "カードのノートを開く" });
    a.onclick = () => void this.app.workspace.openLinkText(c.key, "", true);
    body.createEl("h4", { text: "原文" });
    body.createDiv({ text: c.oracle || "(なし)", cls: "mtg-rb-text" });
    body.createEl("h4", { text: "エンジンの理解" });
    if (c.rule?.abilities.length) c.rule.abilities.forEach((ab) => body.createDiv({ text: describeAbility(ab), cls: "mtg-rb-text" }));
    else body.createDiv({ text: c.rule ? "(能力なし)" : c.needs ? "記録がありません。下の「作る」で、AI が作ります。" : "記録は要りません(キーワードだけ・バニラ・基本土地)。", cls: "mtg-dim" });
    if (c.rule?.unsupported.length) {
      body.createEl("h4", { text: "動かない部分(未対応)" });
      c.rule.unsupported.forEach((u) => body.createDiv({ text: `⚠ ${u}`, cls: "mtg-rb-text" }));
    }
    this.editor(body, c);
  }

  // JSON の直接編集と、AI に指示して直す欄
  private editor(body: HTMLElement, c: RbCard) {
    body.createEl("h4", { text: "AI に指示して、記録を作る・直す" });
    const hint = body.createEl("textarea", { cls: "mtg-rb-memo", attr: { rows: "2", placeholder: c.rule ? "例: Bowmasters の追加のダメージの対象は、クリーチャーかプレイヤーにする" : "(空のまま「作る」を押すと、原文から作ります)" } });
    hint.value = this.proposal?.key === c.key ? this.proposal.instruction : "";
    const bar = body.createDiv("mtg-rb-bar");
    const make = bar.createEl("button", { text: c.rule ? "案を作る" : "作る", cls: "mod-cta" });
    make.onclick = async () => {
      const key = this.getKey();
      if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
      make.disabled = true;
      const note = new Notice("AI が案を作成中…", 0);
      try {
        if (!c.rule && !hint.value.trim()) {
          const r = await compileCard(this.app, key, c.key);
          new Notice(r.ok ? `記録を作成 ($${r.cost.toFixed(3)})` : `作成に失敗: ${r.error}`);
          await this.refresh(true);
        } else {
          this.proposal = { key: c.key, p: await proposeUpdate(this.app, key, c.key, hint.value.trim() || "原文から作り直す"), instruction: hint.value };
          this.render();
        }
      } catch (e) {
        new Notice(`失敗: ${(e as Error).message}`);
      }
      note.hide();
      make.disabled = false;
    };
    if (c.rule) {
      void hasBackup(this.app, c.key).then((has) => {
        if (!has) return;
        bar.createEl("button", { text: "直す前の版に戻す" }).onclick = async () => (await restoreBackup(this.app, c.key), new Notice("直す前の版に戻した"), this.refresh(true));
      });
    }
    if (this.proposal?.key === c.key) {
      const pr = this.proposal.p;
      const box = body.createDiv("mtg-rb-proposal");
      box.createEl("h4", { text: `案(費用 $${pr.cost.toFixed(3)})` });
      const cols = box.createDiv("mtg-rb-cols");
      const col = (title: string, abs: { kind: string }[] | undefined, unsup: string[]) => {
        const d = cols.createDiv();
        d.createEl("h5", { text: title });
        if (!abs?.length) d.createDiv({ text: "(能力なし)", cls: "mtg-dim" });
        (abs as import("./effects").Ability[] | undefined)?.forEach((ab) => d.createDiv({ text: describeAbility(ab), cls: "mtg-rb-text" }));
        unsup.forEach((u) => d.createDiv({ text: `⚠ ${u}`, cls: "mtg-rb-text" }));
      };
      col("いまの記録", pr.before?.abilities, pr.before?.unsupported ?? []);
      col("直した案", pr.after.abilities, pr.after.unsupported);
      const act = box.createDiv("mtg-rb-bar");
      act.createEl("button", { text: "この案で保存", cls: "mod-cta" }).onclick = async () => {
        await saveProposal(this.app, c.key, pr.after, this.proposal!.instruction);
        this.proposal = undefined;
        new Notice("保存した (直す前の版は、1つ前の分だけ残る)");
        await this.refresh(true);
      };
      act.createEl("button", { text: "やめる" }).onclick = () => ((this.proposal = undefined), this.render());
    }
    // JSON を直接直す
    const det = body.createEl("details");
    det.createEl("summary", { text: "記録(ルール md)を直接直す" });
    const raw = det.createEl("textarea", { cls: "mtg-rb-json", attr: { rows: "14" } });
    void readRuleText(this.app, c.key).then((t) => (raw.value = t ?? ""));
    det.createEl("button", { text: "保存" }).onclick = async () => {
      if (!parseRule(raw.value)) return void new Notice("読み取れない形 (```json の中の JSON が壊れている)");
      await writeRuleText(this.app, c.key, raw.value.replace(/^status: .*$/m, "status: manual"), true);
      new Notice("保存した (status は manual になり、作り直されない)");
      await this.refresh(true);
    };
  }

  // ---- 未実装の効果 ----

  private renderUnsupported() {
    const rows = [...this.data!.unsupported.entries()].filter(([t]) => !this.search || t.toLowerCase().includes(this.search)).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
    this.body.createDiv({ text: "カードの記録に残っている「未対応」の文を、同じ文ごとにまとめたもの(カードが多い順)。", cls: "mtg-dim" });
    if (!rows.length) this.body.createDiv({ text: "未対応の効果はありません。" });
    for (const [text, keys] of rows) {
      const row = this.body.createDiv("mtg-rb-entry");
      row.createDiv({ text: `⚠ ${text}`, cls: "mtg-rb-title" });
      this.cardChips(row.createDiv("mtg-rb-chips"), keys);
    }
  }
}
