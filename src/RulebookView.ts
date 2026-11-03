import { ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { LibAbility, instantiate, keywordId, statusOf } from "./abilities";
import { Completion, completeAbility, completeAll, migrateRecords, reassignCards, smokeAbility } from "./abilityai";
import { deleteAbility, saveAbility } from "./abilitystore";
import { Proposal, ProposalData, applyProposal, compileCard, parseRule, proposeUpdate, saveProposal, staleRule } from "./cardrules";
import { Ability, describeAbility, normalizeAbility } from "./effects";
import { deleteMacro } from "./macros";
import { PendingItem, isReady, readPending, writePending } from "./pending";
import { RbCard, Rulebook, collectRulebook, findCards } from "./rulebook";
import { Memo, hasBackup, readMemos, readRuleText, restoreBackup, writeMemos, writeRuleText } from "./rulestore";
import { Settings } from "./settings";
import { CATEGORIES, CATEGORY_EN, Status, TYPE_ENTRIES, TypeEntry, entryById, titleOf } from "./typecatalog";

export const RULEBOOK_VIEW = "mtg-rulebook";

const MARK: Record<Status, string> = { implemented: "✅", partial: "🟡", planned: "⬜" };
const STATUS_JA: Record<Status, string> = { implemented: "実装済み", partial: "一部だけ", planned: "未実装" };
type Tab = "abilities" | "cards" | "todo"; // 能力 (共有の能力の辞書) / カード / 未処理

const problem = (c: RbCard): string => (c.needs && !c.rule ? "記録なし" : staleRule(c.rule) ? "古い記録" : c.rule?.unsupported.length ? "一部未対応" : c.rule ? "OK" : "不要");

// ルールブック: 実装されているルール(型)・マクロと、カードごとの処理の記録を見る・書く。保存先は隠しフォルダ (rulestore.ts)
// 注意: View / Component の名前 (open, close, load など) を、メンバーに使わない (test/viewnames.test.ts が確かめる)
export class RulebookView extends ItemView {
  private tab: Tab = "abilities";
  private search = "";
  private statusFilter = "all";
  private groupBy: "usage" | "category" | "status" = "usage"; // 型の並べ方。カテゴリは、見た目の整理 (動きには関係しない)
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
        void this.refresh(t === "todo");
      };
    };
    tabBtn("abilities", "能力");
    tabBtn("cards", "カード");
    tabBtn("todo", "未処理");
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
    if (this.tab === "abilities") this.renderAbilities();
    else if (this.tab === "cards") this.renderCards();
    else this.renderTodo();
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

  private renderTypes(root: HTMLElement) {
    const filter = createDiv("mtg-rb-filters");
    root.appendChild(filter);
    new Setting(filter).setName("状態").addDropdown((d) => d.addOptions({ all: "すべて", implemented: "✅ 実装済み", partial: "🟡 一部だけ", planned: "⬜ 未実装" }).setValue(this.statusFilter).onChange((v) => ((this.statusFilter = v), this.render())));
    new Setting(filter).setName("並べ方").setDesc("カテゴリは、見やすくするための整理で、動きには関係しない").addDropdown((d) => d.addOptions({ usage: "使っているカードが多い順", status: "状態別(未実装が先)", category: "カテゴリ別" }).setValue(this.groupBy).onChange((v) => ((this.groupBy = v as typeof this.groupBy), this.render())));
    const matches = (e: TypeEntry) => (this.statusFilter === "all" || e.status === this.statusFilter) && (!this.search || [e.id, e.title, titleOf(e), e.summary].some((t) => t.toLowerCase().includes(this.search)));
    const used = (e: TypeEntry) => this.data!.usage.get(e.id)?.size ?? 0;
    const list = TYPE_ENTRIES.filter(matches);
    const count = (st: Status) => TYPE_ENTRIES.filter((e) => e.status === st).length;
    root.createDiv({ text: `✅ 実装済み ${count("implemented")} / 🟡 一部だけ ${count("partial")} / ⬜ 未実装 ${count("planned")} — ${list.length} 件を表示`, cls: "mtg-dim" });
    const section = (title: string, entries: TypeEntry[]) => {
      if (!entries.length) return;
      const det = root.createEl("details", { cls: "mtg-rb-cat" });
      det.open = true;
      det.createEl("summary", { text: title });
      for (const e of entries) this.typeRow(det, e);
    };
    if (this.groupBy === "usage") {
      // 使っているカードが多い順 (動作の一覧。カテゴリは、各行の小さなタグ)
      section("動作・ルールの一覧", [...list].sort((a, b) => used(b) - used(a) || a.title.localeCompare(b.title)));
    } else if (this.groupBy === "status") {
      for (const [st, label] of [["planned", "⬜ 未実装"], ["partial", "🟡 一部だけ"], ["implemented", "✅ 実装済み"]] as const) section(`${label} — ${list.filter((e) => e.status === st).length} 件`, list.filter((e) => e.status === st).sort((a, b) => used(b) - used(a)));
    } else {
      for (const cat of CATEGORIES) {
        const all = TYPE_ENTRIES.filter((e) => e.category === cat);
        section(`${CATEGORY_EN[cat]} (${cat}) — ✅${all.filter((e) => e.status === "implemented").length} 🟡${all.filter((e) => e.status === "partial").length} ⬜${all.filter((e) => e.status === "planned").length}`, list.filter((e) => e.category === cat));
      }
    }
  }

  private typeRow(parent: HTMLElement, e: TypeEntry) {
    const row = parent.createDiv("mtg-rb-entry");
    const head = row.createDiv("mtg-rb-entry-head");
    head.createSpan({ text: MARK[e.status], attr: { title: STATUS_JA[e.status] } });
    head.createSpan({ text: titleOf(e), cls: "mtg-rb-title" });
    head.createSpan({ text: e.title.match(/\((.+)\)$/)?.[1] ?? (e.title !== titleOf(e) ? e.title : ""), cls: "mtg-dim" });
    const n = this.data!.usage.get(e.id)?.size ?? 0;
    if (n) head.createSpan({ text: `${n}枚`, cls: "mtg-rb-used" });
    head.createSpan({ text: CATEGORY_EN[e.category], cls: "mtg-rb-tag" });
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

  // ---- 能力 (共有の能力の辞書) ----

  private abilityText(l: LibAbility): string {
    if (l.keyword && !l.ability) return `エンジンのキーワード (${l.keyword})`;
    const raw = instantiate(l);
    const ab = raw ? normalizeAbility(raw) : undefined;
    return ab ? describeAbility(ab) : "(処理がまだ無い)";
  }

  private abilityRow(parent: HTMLElement, l: LibAbility, mode: "done" | "todo") {
    const st = statusOf(l);
    const cards = this.data!.abilityUsage.get(l.id) ?? new Set<string>();
    const row = parent.createDiv("mtg-rb-entry");
    const head = row.createDiv("mtg-rb-entry-head");
    head.createSpan({ text: st === "done" ? "✅" : st === "needs" ? "🔧" : "⬜" });
    head.createSpan({ text: l.title, cls: "mtg-rb-title" });
    head.createSpan({ text: l.id, cls: "mtg-dim" });
    if (l.keyword) head.createSpan({ text: "キーワード", cls: "mtg-rb-tag" });
    if (cards.size) head.createSpan({ text: `${cards.size}枚`, cls: "mtg-rb-used" });
    row.createDiv({ text: l.effect, cls: "mtg-rb-summary" });
    const key = `ability:${l.id}`;
    const isOpen = this.expanded.has(key);
    head.onclick = () => (isOpen ? this.expanded.delete(key) : this.expanded.add(key), this.render());
    if (!isOpen) return;
    const body = row.createDiv("mtg-rb-detail");
    body.createEl("h4", { text: "処理(関数)" });
    body.createDiv({ text: this.abilityText(l), cls: "mtg-rb-text" });
    if (Object.keys(l.params).length) {
      body.createEl("h4", { text: "引数(既定値)" });
      body.createDiv({ text: Object.entries(l.params).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("、"), cls: "mtg-rb-text" });
    }
    if (l.examples.length) {
      body.createEl("h4", { text: "照合の例" });
      l.examples.forEach((e) => body.createDiv({ text: e, cls: "mtg-rb-text" }));
    }
    if (l.needs?.length) {
      body.createEl("h4", { text: "新しい関数が要る(実装待ち)" });
      for (const n of l.needs) {
        body.createDiv({ text: `${n.title} (${n.name}): ${n.description}`, cls: "mtg-rb-text" });
        body.createDiv({ text: `受け取るもの: ${n.inputs || "-"} / 必要な状態: ${n.state || "-"} / 待つ型: ${n.waitFor.join(", ")}`, cls: "mtg-dim" });
      }
    }
    body.createEl("h4", { text: "使っているカード" });
    this.cardChips(body.createDiv("mtg-rb-chips"), cards);
    if (mode === "todo") this.completeBox(body, l);
    if (!l.keyword || l.ability) {
      const det = body.createEl("details");
      det.createEl("summary", { text: "定義(JSON)を直接直す" });
      const raw = det.createEl("textarea", { cls: "mtg-rb-json", attr: { rows: "12" } });
      raw.value = JSON.stringify(l, null, 1);
      det.createEl("button", { text: "保存" }).onclick = async () => {
        try {
          const v = (await import("./abilities")).validateLib(JSON.parse(raw.value));
          if (!v.lib) return void new Notice(`保存できない: ${v.error}`);
          await saveAbility(this.app, v.lib);
          new Notice("保存した");
          await this.refresh(true);
        } catch (e) {
          new Notice(`JSON が読めない: ${(e as Error).message}`);
        }
      };
    }
    if (!l.keyword) {
      body.createEl("button", { text: "この能力を削除" }).onclick = async () => {
        if (cards.size) return void new Notice("使っているカードがあるので、削除できない");
        await deleteAbility(this.app, l.id);
        await this.refresh(true);
      };
    }
  }

  private renderAbilities() {
    const d = this.data!;
    const all = [...d.library.values()];
    const done = all.filter((l) => statusOf(l) === "done");
    const todo = all.length - done.length;
    this.body.createDiv({ text: `能力 ${all.length} 件 — ✅ 処理済み ${done.length} / 未処理・実装待ち ${todo} (未処理タブ)。能力は、カードが共有する部品。カード固有の能力は、カードタブで見る。`, cls: "mtg-dim" });
    // 既存のカードの記録を、能力に分ける (まだ ref を使っていない記録)
    const old = d.cards.filter((c) => c.rule && !(c.rule.refs?.length));
    if (old.length) {
      const bar = this.body.createDiv("mtg-rb-bar");
      const b = bar.createEl("button", { text: `既存の記録 ${old.length} 枚を、能力に分ける (AI)`, cls: "mod-cta" });
      b.onclick = async () => {
        const key = this.getKey();
        if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
        b.disabled = true;
        const n = new Notice("記録を能力に分けています…", 0);
        const r = await migrateRecords(this.app, key, (i, t, k) => n.setMessage(`記録を能力に分けています… ${i}/${t} (${k})`));
        n.hide();
        new Notice(`${r.migrated.length} 枚を分けた ($${r.cost.toFixed(3)})${r.failed.length ? ` · 失敗 ${r.failed.length} 枚` : ""}。直す前の版は、各カードに1つ前の分が残っている`, 10000);
        await this.refresh(true);
      };
    }
    const used = (l: LibAbility) => d.abilityUsage.get(l.id)?.size ?? 0;
    const rows = done.filter((l) => !this.search || [l.id, l.title, l.effect].some((t) => t.toLowerCase().includes(this.search))).sort((a, b) => used(b) - used(a) || a.title.localeCompare(b.title));
    const det = this.body.createEl("details", { cls: "mtg-rb-cat" });
    det.open = true;
    det.createEl("summary", { text: `処理済みの能力 — ${rows.length} 件(使っているカードが多い順)` });
    if (!rows.length) det.createDiv({ text: "まだありません。「既存の記録を、能力に分ける」か、カードの登録で、増えていきます。", cls: "mtg-dim" });
    for (const l of rows) this.abilityRow(det, l, "done");
    // 関数の一覧 (エンジンにできること)。能力の処理は、これを組み合わせて書く
    const fn = this.body.createEl("details", { cls: "mtg-rb-cat" });
    fn.createEl("summary", { text: `関数の一覧(エンジンにできること) — ${TYPE_ENTRIES.length} 件` });
    this.renderTypes(fn.createDiv());
  }

  // ---- 未処理 ----

  // 未処理の能力に、処理を補う。指示を書いて「補完して」→ 案 (日本語) を見て保存。保存したら、割り振られていなかったカードを、割り振り直す
  private completeBox(body: HTMLElement, l: LibAbility) {
    body.createEl("h4", { text: "補完する" });
    const hint = body.createEl("textarea", { cls: "mtg-rb-memo", attr: { rows: "2", placeholder: "例: トランプルは、エンジンのキーワードに割り当てる / 空のまま「補完して」で、効果の文と照合の例から作る" } });
    const box = body.createDiv();
    const make = body.createEl("button", { text: "補完して", cls: "mod-cta" });
    make.onclick = async () => {
      const key = this.getKey();
      if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
      make.disabled = true;
      box.empty();
      const note = new Notice("AI が処理を作成中…", 0);
      try {
        const c: Completion = await completeAbility(this.app, key, l.id, hint.value.trim());
        note.hide();
        box.createEl("h5", { text: `案 (費用 $${c.cost.toFixed(3)})` });
        box.createDiv({ text: this.abilityText(c.lib), cls: "mtg-rb-text" });
        if (c.lib.needs?.length) c.lib.needs.forEach((n) => box.createDiv({ text: `新しい関数が要る: ${n.title} (${n.name}): ${n.description}`, cls: "mtg-rb-text" }));
        if (c.error) box.createDiv({ text: `⚠ ${c.error}`, cls: "mtg-rb-text" });
        const act = box.createDiv("mtg-rb-bar");
        act.createEl("button", { text: c.lib.needs?.length ? "実装待ちとして保存" : "この処理で保存", cls: "mod-cta" }).onclick = async () => {
          if (c.error && !c.lib.needs?.length) return void new Notice(`保存できない: ${c.error}`);
          await saveAbility(this.app, c.lib);
          new Notice("保存した。割り振られていなかったカードを、割り振り直す…");
          const k2 = this.getKey();
          if (k2 && !c.lib.needs?.length) {
            const r = await reassignCards(this.app, k2);
            new Notice(`割り振り直した: ${r.changed.length} 枚 ($${r.cost.toFixed(3)})`);
          }
          await this.refresh(true);
        };
        act.createEl("button", { text: "やめる" }).onclick = () => box.empty();
      } catch (e) {
        note.hide();
        new Notice(`失敗: ${(e as Error).message}`);
      }
      make.disabled = false;
    };
  }

  private renderTodo() {
    const d = this.data!;
    const todo = [...d.library.values()].filter((l) => statusOf(l) !== "done" && (!this.search || [l.id, l.title, l.effect].some((t) => t.toLowerCase().includes(this.search))));
    this.body.createDiv({ text: "処理がまだ無い能力と、カード固有の動かない部分。指示で補完すると、能力タブに移る。新しい関数が要るものは、実装待ち(🔧)になる。", cls: "mtg-dim" });
    const bar = this.body.createDiv("mtg-rb-bar");
    const all = bar.createEl("button", { text: "原文から補完(安全なものは、そのまま保存)", cls: "mod-cta" });
    all.onclick = async () => {
      const key = this.getKey();
      if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
      all.disabled = true;
      const n = new Notice("未処理の能力を補完しています…", 0);
      const r = await completeAll(this.app, key, (i, t, id) => n.setMessage(`未処理の能力を補完しています… ${i}/${t} (${id})`));
      if (r.done.length) {
        n.setMessage("割り振られていなかったカードを、割り振り直しています…");
        const re = await reassignCards(this.app, key);
        r.cost += re.cost;
      }
      n.hide();
      new Notice(`補完: ${r.done.length} 件を処理済みにした / 残り ${r.left.length} 件 ($${r.cost.toFixed(3)})`, 10000);
      await this.refresh(true);
    };
    bar.createEl("button", { text: "カードを割り振り直す" }).onclick = async () => {
      const key = this.getKey();
      if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
      const n = new Notice("割り振り直しています…", 0);
      const r = await reassignCards(this.app, key, (i, t, k) => n.setMessage(`割り振り直しています… ${i}/${t} (${k})`));
      n.hide();
      new Notice(`割り振り直した: ${r.changed.length} 枚 ($${r.cost.toFixed(3)})`);
      await this.refresh(true);
    };
    const sec = this.body.createEl("details", { cls: "mtg-rb-cat" });
    sec.open = true;
    sec.createEl("summary", { text: `未処理・実装待ちの能力 — ${todo.length} 件` });
    if (!todo.length) sec.createDiv({ text: "ありません。", cls: "mtg-dim" });
    for (const l of todo.sort((a, b) => (d.abilityUsage.get(b.id)?.size ?? 0) - (d.abilityUsage.get(a.id)?.size ?? 0))) this.abilityRow(sec, l, "todo");
    const own = this.body.createEl("details", { cls: "mtg-rb-cat" });
    own.open = true;
    own.createEl("summary", { text: "カード固有の動かない部分" });
    this.renderUnsupported(own);
    const pend = this.body.createEl("details", { cls: "mtg-rb-cat" });
    pend.createEl("summary", { text: `新しい関数が要る処理(実装待ち) — ${this.pendingItems.filter((p) => p.status === "waiting").length} 件` });
    this.renderPending(pend);
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
    body.createEl("h4", { text: "割り振られた能力(自動で割り振られる。原文と見比べて確認する)" });
    const refs = c.rule?.refs ?? [];
    const own = (c.rule?.abilities.length ?? 0) - refs.filter((r) => this.data!.library.get(r.ability)?.ability).length;
    for (const k of c.keywords) {
      const l = this.data!.library.get(keywordId(k));
      body.createDiv({ text: `${l && statusOf(l) === "done" ? "✅" : "⬜"} ${l?.title ?? k} (キーワード) — ${l?.effect ?? "ライブラリに無い"}`, cls: "mtg-rb-text" });
    }
    for (const r of refs) {
      const l = this.data!.library.get(r.ability);
      body.createDiv({ text: `${l && statusOf(l) === "done" ? "✅" : "⬜"} ${l?.title ?? r.ability} ${Object.keys(r.args).length ? JSON.stringify(r.args) : ""} — ${l?.effect ?? "ライブラリに見つからない"}`, cls: "mtg-rb-text" });
    }
    if (own > 0) body.createDiv({ text: `＋ このカード固有の能力 ${own} 件(上の「エンジンの理解」のうち、能力に割り振られていないもの)`, cls: "mtg-rb-text" });
    if (!c.keywords.length && !refs.length && own <= 0) body.createDiv({ text: "なし", cls: "mtg-dim" });
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
    if (c.rule || c.needs) {
      bar.createEl("button", { text: "割り振り直す" }).onclick = async () => {
        const key = this.getKey();
        if (!key) return void new Notice("設定で Claude の API キーを選ぶ");
        const n = new Notice("AI が割り振り直しています…", 0);
        try {
          const instruction = "能力ライブラリを使って、割り振り直す。登録済みの能力で書けるものは ref で書き、キーワードはエンジンに任せ、残りは、このカード固有の能力として書く。";
          this.proposal = { key: c.key, p: await proposeUpdate(this.app, key, c.key, instruction), instruction };
        } catch (e) {
          new Notice(`失敗: ${(e as Error).message}`);
        }
        n.hide();
        this.render();
      };
    }
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

  private renderUnsupported(root: HTMLElement) {
    const rows = [...this.data!.unsupported.entries()].filter(([t]) => !this.search || t.toLowerCase().includes(this.search)).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
    root.createDiv({ text: "カードの記録に残っている「未対応」の文を、同じ文ごとにまとめたもの(カードが多い順)。直すには、カードの記録タブで、そのカードの「処理を書く」を使う。", cls: "mtg-dim" });
    if (!rows.length) root.createDiv({ text: "未対応の効果はありません。" });
    for (const [text, keys] of rows) {
      const row = root.createDiv("mtg-rb-entry");
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
    if (this.tab === "todo") this.render();
  }

  private renderPending(root: HTMLElement) {
    root.createDiv({ text: "今の関数では書けない処理(AI が、新しい関数の仕様を書いたもの)。Claude Code に「実装待ちを見て」と伝えると、読んで、関数を作る。実装されると、元の記録の更新案が、ここに出る。", cls: "mtg-dim" });
    const items = this.pendingItems.filter((p) => !this.search || p.key.toLowerCase().includes(this.search) || p.needs.some((n) => n.title.toLowerCase().includes(this.search)));
    if (!items.length) root.createDiv({ text: "実装待ちはありません。" });
    for (const it of items.sort((a, b) => Number(b.status === "waiting") - Number(a.status === "waiting") || b.created.localeCompare(a.created))) {
      const row = root.createDiv("mtg-rb-entry");
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
