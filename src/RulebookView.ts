import { ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { Proposal, ProposalData, applyProposal, compileCard, parseRule, proposeUpdate, saveProposal, staleRule } from "./cardrules";
import { Ability, describeAbility } from "./effects";
import { deleteMacro } from "./macros";
import { PendingItem, isReady, readPending, writePending } from "./pending";
import { RbCard, Rulebook, collectRulebook, findCards } from "./rulebook";
import { Memo, hasBackup, readMemos, readRuleText, restoreBackup, writeMemos, writeRuleText } from "./rulestore";
import { Settings } from "./settings";
import { CATEGORIES, CATEGORY_EN, Status, TYPE_ENTRIES, TypeEntry, entryById, titleOf } from "./typecatalog";

export const RULEBOOK_VIEW = "mtg-rulebook";

const MARK: Record<Status, string> = { implemented: "✅", partial: "🟡", planned: "⬜" };
const STATUS_JA: Record<Status, string> = { implemented: "実装済み", partial: "一部だけ", planned: "未実装" };
type Tab = "types" | "cards" | "unsupported" | "pending";

const problem = (c: RbCard): string => (c.needs && !c.rule ? "記録なし" : staleRule(c.rule) ? "古い記録" : c.rule?.unsupported.length ? "一部未対応" : c.rule ? "OK" : "不要");

// ルールブック: 実装されているルール(型)・マクロと、カードごとの処理の記録を見る・書く。保存先は隠しフォルダ (rulestore.ts)
// 注意: View / Component の名前 (open, close, load など) を、メンバーに使わない (test/viewnames.test.ts が確かめる)
export class RulebookView extends ItemView {
  private tab: Tab = "types";
  private search = "";
  private statusFilter = "all";
  private deckOnly = true;
  private cardFilter = "all";
  private expanded = new Set<string>(); // 開いている行
  private data?: Rulebook;
  private memos: Record<string, Memo> = {};
  private body!: HTMLElement;
  private extra: RbCard[] = []; // 検索で見つけた、デッキ・コレクション・記録に無いカード
  private proposal?: { key: string; p: Proposal; instruction: string };
  private pendingItems: PendingItem[] = [];
  private autoDone = false;

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
      b.onclick = () => {
        this.tab = t;
        tabs.querySelectorAll("button").forEach((x) => x.removeClass("is-on"));
        b.addClass("is-on");
        void this.refresh(t === "pending");
      };
    };
    tabBtn("types", "型・マクロ");
    tabBtn("cards", "カードの記録");
    tabBtn("unsupported", "未実装の効果");
    tabBtn("pending", "実装待ち");
    const search = head.createEl("input", { type: "text", placeholder: "検索" });
    let timer = 0;
    search.oninput = () => {
      this.search = search.value.trim().toLowerCase();
      this.render();
      // デッキ・コレクション・記録に無いカードも、名前で探せる (Cards/ のノートから)
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        this.extra = this.search.length >= 2 ? await findCards(this.app, this.search, new Set(this.data?.cards.map((c) => c.key))) : [];
        if (this.tab === "cards") this.render();
      }, 300);
    };
    this.body = root.createDiv("mtg-rb-body");
    await this.refresh(true);
    void this.autoProposals();
  }

  async refresh(reload: boolean) {
    if (reload || !this.data) {
      this.body.setText("読み込み中…");
      this.data = await collectRulebook(this.app);
      this.memos = await readMemos(this.app);
      this.pendingItems = await readPending(this.app);
    }
    this.render();
  }

  private render() {
    this.body.empty();
    if (!this.data) return;
    if (this.tab === "types") this.renderTypes();
    else if (this.tab === "cards") this.renderCards();
    else if (this.tab === "unsupported") this.renderUnsupported();
    else this.renderPending();
  }

  // ---- 共通の部品 ----

  private cardChips(parent: HTMLElement, keys: Iterable<string>) {
    const list = [...keys].map((k) => this.data!.cards.find((c) => c.key === k)).filter((c): c is RbCard => !!c).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return void parent.createSpan({ text: "(いまのデッキ・コレクション・記録には無い)", cls: "mtg-dim" });
    for (const c of list.slice(0, 60)) {
      const a = parent.createEl("a", { text: c.name, cls: "mtg-rb-chip", attr: { title: [c.decks.length ? `デッキ: ${c.decks.join(", ")}` : "", c.inCollection ? "コレクション" : ""].filter(Boolean).join(" / ") } });
      a.onclick = () => void this.app.workspace.openLinkText(c.key, "", true);
    }
    if (list.length > 60) parent.createSpan({ text: ` …ほか ${list.length - 60} 枚`, cls: "mtg-dim" });
  }

  // 案の表示: 記録の変更 (前後)、新しいマクロ、実装待ちの関数、エラー
  private showProposal(parent: HTMLElement, data: ProposalData, before?: { abilities: Ability[]; unsupported: string[] }) {
    const cols = parent.createDiv(before ? "mtg-rb-cols" : "");
    const col = (title: string, abs: Ability[] | undefined, unsup: string[]) => {
      const d = cols.createDiv();
      d.createEl("h5", { text: title });
      if (!abs?.length) d.createDiv({ text: "(能力なし)", cls: "mtg-dim" });
      abs?.forEach((ab) => d.createDiv({ text: describeAbility(ab), cls: "mtg-rb-text" }));
      unsup.forEach((u) => d.createDiv({ text: `⚠ ${u}`, cls: "mtg-rb-text" }));
    };
    if (before) col("いまの記録", before.abilities, before.unsupported);
    col(before ? "直した案" : "案", data.abilities, data.unsupported);
    if (data.macros.length) {
      parent.createEl("h5", { text: `新しく作るマクロ (${data.macros.length})` });
      for (const m of data.macros) {
        parent.createDiv({ text: `${m.name}(${m.params.join(", ")}): ${m.title} — ${m.description}`, cls: "mtg-rb-text" });
        parent.createEl("pre").createEl("code", { text: JSON.stringify(m.steps, null, 1) });
      }
    }
    if (data.needs.length) {
      parent.createEl("h5", { text: `新しい関数が要る部分 (${data.needs.length}) — 実装待ちに入る` });
      for (const n of data.needs) {
        parent.createDiv({ text: `${n.title} (${n.name}): ${n.description}`, cls: "mtg-rb-text" });
        parent.createDiv({ text: `受け取るもの: ${n.inputs || "-"} / 必要な状態: ${n.state || "-"} / 待つ型: ${n.waitFor.join(", ")}`, cls: "mtg-dim" });
      }
    }
    data.errors.forEach((e) => parent.createDiv({ text: `⚠ ${e}`, cls: "mtg-rb-text" }));
  }

  // ---- 型・マクロ ----

  private renderTypes() {
    const filter = createDiv("mtg-rb-filters");
    this.body.appendChild(filter);
    new Setting(filter).setName("状態").addDropdown((d) => d.addOptions({ all: "すべて", implemented: "✅ 実装済み", partial: "🟡 一部だけ", planned: "⬜ 未実装" }).setValue(this.statusFilter).onChange((v) => ((this.statusFilter = v), this.render())));
    const matches = (e: TypeEntry) => (this.statusFilter === "all" || e.status === this.statusFilter) && (!this.search || [e.id, e.title, titleOf(e), e.summary].some((t) => t.toLowerCase().includes(this.search)));
    for (const cat of CATEGORIES) {
      const entries = TYPE_ENTRIES.filter((e) => e.category === cat && matches(e));
      if (!entries.length) continue;
      const all = TYPE_ENTRIES.filter((e) => e.category === cat);
      const det = this.body.createEl("details", { cls: "mtg-rb-cat" });
      det.open = true;
      det.createEl("summary", { text: `${CATEGORY_EN[cat]} (${cat}) — ✅${all.filter((e) => e.status === "implemented").length} 🟡${all.filter((e) => e.status === "partial").length} ⬜${all.filter((e) => e.status === "planned").length}` });
      for (const e of entries) this.typeRow(det, e);
    }
    // マクロ (命令の組み合わせに名前をつけた部品。あなたと AI が作る)
    const macros = [...this.data!.macros.values()].filter((m) => !this.search || [m.name, m.title, m.description].some((t) => t.toLowerCase().includes(this.search)));
    const det = this.body.createEl("details", { cls: "mtg-rb-cat" });
    det.open = true;
    det.createEl("summary", { text: `Macros (マクロ) — ${this.data!.macros.size} 件` });
    if (!macros.length) det.createDiv({ text: "まだありません。カードの「処理を書く」で、AI が、同じ組み合わせを部品にして、ここに登録します。", cls: "mtg-dim" });
    for (const m of macros) {
      const row = det.createDiv("mtg-rb-entry");
      const head = row.createDiv("mtg-rb-entry-head");
      head.createSpan({ text: "🧩" });
      head.createSpan({ text: m.name, cls: "mtg-rb-title" });
      head.createSpan({ text: m.title, cls: "mtg-dim" });
      const n = this.data!.macroUsage.get(m.name)?.size ?? 0;
      if (n) head.createSpan({ text: `${n}枚`, cls: "mtg-dim" });
      row.createDiv({ text: `(${m.params.join(", ")}) ${m.description}`, cls: "mtg-rb-summary" });
      const isOpen = this.expanded.has(`macro:${m.name}`);
      head.onclick = () => (isOpen ? this.expanded.delete(`macro:${m.name}`) : this.expanded.add(`macro:${m.name}`), this.render());
      if (!isOpen) continue;
      const body = row.createDiv("mtg-rb-detail");
      body.createEl("h4", { text: "中身(命令の並び。\"$名前\" は引数)" });
      body.createEl("pre").createEl("code", { text: JSON.stringify(m.steps, null, 1) });
      body.createEl("h4", { text: "使っているカード" });
      this.cardChips(body.createDiv("mtg-rb-chips"), this.data!.macroUsage.get(m.name) ?? []);
      body.createEl("button", { text: "このマクロを削除" }).onclick = async () => {
        if ((this.data!.macroUsage.get(m.name)?.size ?? 0) > 0) return void new Notice("使っているカードがあるので、削除できない (先に、そのカードの記録を直す)");
        await deleteMacro(this.app, m.name);
        await this.refresh(true);
      };
    }
  }

  private typeRow(parent: HTMLElement, e: TypeEntry) {
    const row = parent.createDiv("mtg-rb-entry");
    const head = row.createDiv("mtg-rb-entry-head");
    head.createSpan({ text: MARK[e.status], attr: { title: STATUS_JA[e.status] } });
    head.createSpan({ text: titleOf(e), cls: "mtg-rb-title" });
    head.createSpan({ text: e.title.match(/\((.+)\)$/)?.[1] ?? (e.title !== titleOf(e) ? e.title : ""), cls: "mtg-dim" });
    const n = this.data!.usage.get(e.id)?.size ?? 0;
    if (n) head.createSpan({ text: `${n}枚`, cls: "mtg-dim" });
    const waiting = this.pendingItems.filter((p) => p.status === "waiting" && p.needs.some((x) => x.waitFor.includes(e.id))).length;
    if (waiting) head.createSpan({ text: `実装待ち ${waiting}件`, cls: "mtg-rb-req" });
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
    body.createEl("h4", { text: "メモ" });
    const area = body.createEl("textarea", { cls: "mtg-rb-memo", attr: { rows: "2", placeholder: "この型についてのメモ" } });
    area.value = this.memos[e.id]?.memo ?? "";
    let t = 0;
    const save = async () => {
      if (area.value.trim()) this.memos[e.id] = { memo: area.value.trim(), request: false };
      else delete this.memos[e.id];
      await writeMemos(this.app, this.memos);
    };
    area.oninput = () => (window.clearTimeout(t), (t = window.setTimeout(() => void save(), 500)));
    area.onchange = () => void save();
  }

  // ---- カード ----

  private renderCards() {
    const filter = createDiv("mtg-rb-filters");
    this.body.appendChild(filter);
    new Setting(filter).setName("対象").addDropdown((d) => d.addOptions({ deck: "デッキのカード", all: "デッキ・コレクション・記録のあるカード全部" }).setValue(this.deckOnly ? "deck" : "all").onChange((v) => ((this.deckOnly = v === "deck"), this.render())));
    new Setting(filter).setName("状態").addDropdown((d) => d.addOptions({ all: "すべて", problem: "問題あり", none: "記録なし", partial: "一部未対応", stale: "古い記録", ok: "OK" }).setValue(this.cardFilter).onChange((v) => ((this.cardFilter = v), this.render())));
    const cards = [...this.data!.cards.filter((c) => (!this.deckOnly || c.decks.length) && (!this.search || c.name.toLowerCase().includes(this.search)) && this.cardOk(c)), ...(this.search ? this.extra.filter((c) => this.cardOk(c)) : [])];
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
    const waiting = this.pendingItems.some((x) => x.key === c.key && x.status === "waiting");
    head.createSpan({ text: p === "OK" || p === "不要" ? "✅" : p === "記録なし" ? "⬜" : "🟡" });
    head.createSpan({ text: c.name, cls: "mtg-rb-title" });
    head.createSpan({ text: p, cls: "mtg-dim" });
    if (waiting) head.createSpan({ text: "実装待ち", cls: "mtg-rb-req" });
    if (c.decks.length) head.createSpan({ text: c.decks.join(", "), cls: "mtg-rb-tag" });
    if (c.inCollection) head.createSpan({ text: "コレクション", cls: "mtg-rb-tag" });
    const isOpen = this.expanded.has(`card:${c.key}`);
    head.onclick = () => (isOpen ? this.expanded.delete(`card:${c.key}`) : this.expanded.add(`card:${c.key}`), this.render());
    if (!isOpen) return;
    const body = row.createDiv("mtg-rb-detail");
    body.createEl("a", { text: "カードのノートを開く" }).onclick = () => void this.app.workspace.openLinkText(c.key, "", true);
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

  // 「処理を書く」: 書いた処理を、今ある関数・マクロに割り振る。足りなければ、新しいマクロを作る。それでも足りなければ、新しい関数の仕様を「実装待ち」に入れる
  private editor(body: HTMLElement, c: RbCard) {
    body.createEl("h4", { text: "処理を書く" });
    body.createDiv({ text: "どう動いてほしいかを、自然な文で書く。AI が、今ある関数に割り振る(足りなければ、マクロを作る。それでも足りない部分は、新しい関数の仕様として「実装待ち」に入る)。保存の前に、前後を見比べられる。", cls: "mtg-dim" });
    const hint = body.createEl("textarea", { cls: "mtg-rb-memo", attr: { rows: "3", placeholder: c.rule ? "例: 戦場に出たとき、相手に1点ダメージを与える。そのあと、アマス1(トークンとカウンター)" : "(空のまま「作る」を押すと、原文から作ります)" } });
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
      box.createEl("h4", { text: `案 (費用 $${pr.cost.toFixed(3)})` });
      this.showProposal(box, pr.data, pr.before);
      const act = box.createDiv("mtg-rb-bar");
      act.createEl("button", { text: "この案で保存", cls: "mod-cta" }).onclick = async () => {
        const r = await saveProposal(this.app, c.key, pr.data, this.proposal!.instruction);
        this.proposal = undefined;
        new Notice(`保存した${r.macros ? ` · マクロ ${r.macros} 件を登録` : ""}${r.needs ? ` · 実装待ち ${r.needs} 件` : ""} (直す前の版は、1つ前の分だけ残る)`);
        await this.refresh(true);
      };
      act.createEl("button", { text: "やめる" }).onclick = () => ((this.proposal = undefined), this.render());
    }
    // 記録 (ルール md) を直接直す
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
    this.body.createDiv({ text: "カードの記録に残っている「未対応」の文を、同じ文ごとにまとめたもの(カードが多い順)。直すには、カードの記録タブで、そのカードの「処理を書く」を使う。", cls: "mtg-dim" });
    if (!rows.length) this.body.createDiv({ text: "未対応の効果はありません。" });
    for (const [text, keys] of rows) {
      const row = this.body.createDiv("mtg-rb-entry");
      row.createDiv({ text: `⚠ ${text}`, cls: "mtg-rb-title" });
      this.cardChips(row.createDiv("mtg-rb-chips"), keys);
    }
  }

  // ---- 実装待ち ----

  // 実装された関数を使って直せるようになった記録の、更新案を作る (API キーがあるときだけ。保存は、確認してから)
  private async autoProposals() {
    if (this.autoDone) return;
    this.autoDone = true;
    const key = this.getKey();
    if (!key) return;
    const todo = this.pendingItems.filter((p) => isReady(p) && !p.proposal);
    if (!todo.length) return;
    const n = new Notice(`実装された関数を使った更新案を作成中… ${todo.length} 件`, 0);
    for (const it of todo) {
      try {
        const pr = await proposeUpdate(this.app, key, it.key, `${it.instruction}\n\n(次の関数が使えるようになった: ${it.needs.map((x) => x.title).join("、")}。それを使って、記録を作り直す)`);
        it.proposal = { ...pr.data, cost: pr.cost };
      } catch (e) {
        console.error(e);
      }
    }
    await writePending(this.app, this.pendingItems);
    n.hide();
    new Notice("更新案を作った。「実装待ち」タブで確認して、保存する", 8000);
    if (this.tab === "pending") this.render();
  }

  private renderPending() {
    this.body.createDiv({ text: "今の関数では書けない処理(AI が、新しい関数の仕様を書いたもの)。Claude Code に「実装待ちを見て」と伝えると、読んで、関数を作る。実装されると、元の記録の更新案が、ここに出る。", cls: "mtg-dim" });
    const items = this.pendingItems.filter((p) => !this.search || p.key.toLowerCase().includes(this.search) || p.needs.some((n) => n.title.toLowerCase().includes(this.search)));
    if (!items.length) this.body.createDiv({ text: "実装待ちはありません。" });
    for (const it of items.sort((a, b) => Number(b.status === "waiting") - Number(a.status === "waiting") || b.created.localeCompare(a.created))) {
      const row = this.body.createDiv("mtg-rb-entry");
      const head = row.createDiv("mtg-rb-entry-head");
      const ready = isReady(it);
      head.createSpan({ text: it.status === "done" ? "✅" : it.proposal ? "📝" : ready ? "🔔" : "⏳" });
      const name = this.data!.cards.find((c) => c.key === it.key)?.name ?? it.key;
      head.createSpan({ text: name, cls: "mtg-rb-title" });
      head.createSpan({ text: it.status === "done" ? "完了" : it.proposal ? "更新案あり(確認して保存)" : ready ? "実装された(更新案を作れる)" : "実装待ち", cls: "mtg-dim" });
      head.createEl("a", { text: "カードを開く" }).onclick = (ev) => (ev.stopPropagation(), void this.app.workspace.openLinkText(it.key, "", true));
      row.createDiv({ text: it.instruction.length > 160 ? `${it.instruction.slice(0, 160)}…` : it.instruction, cls: "mtg-rb-summary" });
      const body = row.createDiv("mtg-rb-detail");
      for (const n of it.needs) {
        const done = n.waitFor.every((id) => !!entryById(id) && entryById(id)!.status !== "planned");
        body.createDiv({ text: `${done ? "✅" : "⏳"} ${n.title} (${n.name}): ${n.description}`, cls: "mtg-rb-text" });
        body.createDiv({ text: `受け取るもの: ${n.inputs || "-"} / 必要な状態: ${n.state || "-"} / 待つ型: ${n.waitFor.join(", ")}`, cls: "mtg-dim" });
      }
      const bar = body.createDiv("mtg-rb-bar");
      if (ready && !it.proposal && it.status === "waiting") {
        const b = bar.createEl("button", { text: "更新案を作る", cls: "mod-cta" });
        b.onclick = async () => {
          const key = this.getKey();
          if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
          b.disabled = true;
          try {
            const pr = await proposeUpdate(this.app, key, it.key, `${it.instruction}\n\n(次の関数が使えるようになった: ${it.needs.map((x) => x.title).join("、")}。それを使って、記録を作り直す)`);
            it.proposal = { ...pr.data, cost: pr.cost };
            await writePending(this.app, this.pendingItems);
          } catch (e) {
            new Notice(`失敗: ${(e as Error).message}`);
          }
          this.render();
        };
      }
      if (it.proposal) {
        const box = body.createDiv("mtg-rb-proposal");
        box.createEl("h4", { text: `更新案 (費用 $${it.proposal.cost.toFixed(3)})` });
        this.showProposal(box, it.proposal as unknown as ProposalData);
        const act = box.createDiv("mtg-rb-bar");
        act.createEl("button", { text: "この案で保存", cls: "mod-cta" }).onclick = async () => {
          await applyProposal(this.app, it.key, it.proposal as unknown as ProposalData, it.instruction, { status: "manual", backup: true });
          it.status = "done";
          it.proposal = undefined;
          await writePending(this.app, this.pendingItems);
          new Notice("保存した (直す前の版は、1つ前の分だけ残る)");
          await this.refresh(true);
        };
        act.createEl("button", { text: "案を捨てる" }).onclick = async () => ((it.proposal = undefined), await writePending(this.app, this.pendingItems), this.render());
      }
      bar.createEl("button", { text: "削除" }).onclick = async () => {
        this.pendingItems = this.pendingItems.filter((x) => x.id !== it.id);
        await writePending(this.app, this.pendingItems);
        this.render();
      };
    }
  }
}
