import { App, EventRef, Modal, Notice, Plugin, Setting, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { buildRule } from "./battle/build";
import { Kind, freeName, parseVersion, sortNewestFirst } from "./battle/history";
import { askClaude, obsidianHttp } from "./battle/claude";
import { CardStatus, cardStatus, report } from "./battle/coverage";
import { blankRule } from "./battle/editor";
import { registerBuiltinNodes } from "./battle/nodes";
import { SAMPLE_RULES } from "./battle/samples";
import { parseRule } from "./battle/ruleMd";
import { toRows } from "./battle/select";
import { BuildRulesModal } from "./BuildRulesModal";
import { RestoreRuleModal } from "./RestoreRuleModal";
import { RULE_EDITOR_VIEW, RuleEditorView } from "./RuleEditorView";
import { ensureCardFile, localCards, oracleEnglish, updateLegality } from "./cards";
import { DECK_DIR, foldCommander, writeDeck } from "./deck";
import { CREATABLE, FORMATS } from "./rules";
import { ImportModal, resolveDeck } from "./import";
import { CARDLIST_VIEW, CardListView } from "./CardListView";
import { COLLECTION_VIEW, CollectionView } from "./CollectionView";
import { CARDS_VIEW, CardsView } from "./CardsView";
import { DASHBOARD_VIEW, DashboardView } from "./DashboardView";
import { DECKLIST_VIEW, DeckListView } from "./DeckListView";
import { DECK_VIEW, DeckView } from "./DeckView";
import { fetchCard, fileSafe } from "./scryfall";
import { priceStore, updateCollectionPrices } from "./prices";
import { DEFAULT_SETTINGS, Settings, SettingsTab, claudeKey } from "./settings";

// 「動き方」はカード行の外なので、デッキ画面で枚数を変えても書き換わらない。統率戦だけコマンダー欄があり、サイドは無い
const RULES_DIR = "Rules"; // カードの能力をノードで組んだ md (Cards/ と同じ並び。Obsidian の画面で手で直せる)

const deckTemplate = (format: string) =>
  `---\nmtg: deck\nformat: ${format}\ntags: [mtg/deck]\n---\n\n${format === "commander" ? "## Commander\n\n## Main\n" : "## Main\n\n## Side\n"}\n## 動き方\n\n- 勝ち筋:\n- 序盤:\n- 中盤:\n- 注意点:\n`;

class NameModal extends Modal {
  private value = "";
  private format = CREATABLE[0];
  private list = "";
  // askFormat: 新しいデッキを作るときはフォーマットも選ぶ
  constructor(app: App, private title: string, private placeholder: string, private onSubmit: (v: string, format: string, list: string) => void, private askFormat = false) {
    super(app);
  }
  onOpen() {
    const submit = () => {
      if (!this.value.trim()) return;
      this.close();
      this.onSubmit(this.value.trim(), this.format, this.list);
    };
    this.setTitle(this.title);
    new Setting(this.contentEl).setName("Name").addText((t) => {
      t.setPlaceholder(this.placeholder).onChange((v) => (this.value = v));
      t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && !e.isComposing && submit());
      t.inputEl.focus();
    });
    if (this.askFormat) {
      new Setting(this.contentEl)
        .setName("Format")
        .setDesc("使えないカード(禁止など)は選べなくなる。統率戦は100枚・同名1種・コマンダー1体")
        .addDropdown((d) => d.addOptions(Object.fromEntries(CREATABLE.map((id) => [id, FORMATS[id].name.toUpperCase()]))).setValue(this.format).onChange((v) => (this.format = v)));
      // 入れると、そのリストを取り込んでデッキを作る (空なら空のデッキ)
      const area = this.contentEl.createEl("textarea", { attr: { rows: "10", placeholder: "Import (任意): Moxfield のテキスト\n4 Lightning Bolt (M11) 149\n...\n\nSIDEBOARD:\n3 Smash to Smithereens (ROE) 160" } });
      area.style.width = "100%";
      area.addEventListener("input", () => (this.list = area.value));
    }
    new Setting(this.contentEl).addButton((b) => b.setButtonText("OK").setCta().onClick(submit));
  }
  onClose() {
    this.contentEl.empty();
  }
}

export default class MagicTheObsidian extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  private target?: DeckView; // サイドバーの一覧からカードを足す先 (最後に触ったデッキ/コレクション画面)
  private prevCount = 0;
  private closedByTab = false;
  private opening = false;

  async onload() {
    registerBuiltinNodes();
    // data.json: 設定 + 価格キャッシュ (フラットな1つのオブジェクト)
    const d = (await this.loadData()) ?? {};
    this.settings = {
      textLang: d.textLang ?? DEFAULT_SETTINGS.textLang,
      cardLang: d.cardLang ?? DEFAULT_SETTINGS.cardLang,
      sidebar: d.sidebar ?? DEFAULT_SETTINGS.sidebar,
      listArt: d.listArt ?? DEFAULT_SETTINGS.listArt,
      dashboardTab: d.dashboardTab ?? DEFAULT_SETTINGS.dashboardTab,
      currency: d.currency ?? DEFAULT_SETTINGS.currency,
      claudeKeySecret: d.claudeKeySecret ?? DEFAULT_SETTINGS.claudeKeySecret,
      claudeModel: d.claudeModel ?? DEFAULT_SETTINGS.claudeModel,
    };
    priceStore.prices = d.prices ?? {};
    priceStore.updated = d.pricesUpdated ?? "";
    priceStore.rates = d.rates ?? {};
    const saveAll = () => this.saveData({ ...this.settings, prices: priceStore.prices, pricesUpdated: priceStore.updated, rates: priceStore.rates });
    priceStore.save = saveAll;
    this.addSettingTab(
      new SettingsTab(this.app, this, this.settings, saveAll, () => {
        for (const l of this.deckLeaves()) if (l.view instanceof DeckView) l.view.rebuild();
        for (const l of this.app.workspace.getLeavesOfType(CARDLIST_VIEW)) if (l.view instanceof CardListView) l.view.refresh();
        this.prevCount = 0; // 次の同期で開き直す
        void this.syncSidebar();
      }),
    );
    this.registerView(DECK_VIEW, (leaf) => new DeckView(leaf, this.settings));
    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, { collection: () => void this.openOrReveal(COLLECTION_VIEW), deck: () => void this.openOrReveal(DECKLIST_VIEW), cards: () => void this.openOrReveal(CARDS_VIEW) }));
    this.registerView(CARDS_VIEW, (leaf) => new CardsView(leaf, this.settings));
    this.registerView(
      DECKLIST_VIEW,
      (leaf) =>
        new DeckListView(leaf, {
          open: (f) => void this.openDeck(f),
          create: () => new NameModal(this.app, "Create deck", "赤単バーン", (n, f, l) => void (l.trim() ? this.importDeck(n, l, f) : this.createDeck(n, f)), true).open(),
        }),
    );
    this.registerView(COLLECTION_VIEW, (leaf) => new CollectionView(leaf, this.settings));
    // ノード設定画面: 「保存」で、saveRule が履歴を残してから md を書く
    this.registerView(
      RULE_EDITOR_VIEW,
      (leaf) =>
        new RuleEditorView(leaf, {
          load: async (card) => {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${card}.md`));
            if (!(f instanceof TFile)) return { rule: blankRule(card) };
            try {
              const rule = parseRule(await this.app.vault.read(f));
              return rule.card === card ? { rule } : { error: `card: が "${rule.card}" で、ファイル名 (${card}) と合わない` };
            } catch (e) {
              return { error: `${(e as Error).message} (md を直すか、空のルールから作り直してください)` };
            }
          },
          save: async (card, md) => {
            await this.ensureRulesDir();
            return this.saveRule(card, md, "edit");
          },
        }),
    );
    this.registerView(CARDLIST_VIEW, (leaf) => new CardListView(leaf, this.settings, () => this.liveTarget()));

    const ws = this.app.workspace;
    this.registerEvent(
      ws.on("active-leaf-change", (leaf) => {
        this.dashboardIfEmpty(leaf);
        if (leaf?.view.getViewType() === DECK_VIEW) void this.followDeck(leaf);
        this.tieSidebar(leaf);
      }),
    );
    this.registerEvent(ws.on("layout-change", () => void this.syncSidebar()));
    // デッキ画面のメイン/サイドのタブを押したとき、サイドバーが畳まれていたら開く
    this.registerEvent((ws as unknown as { on(n: string, cb: () => void): EventRef }).on("mtg-show-list", () => void this.showList(ws.getActiveViewOfType(DeckView)?.leaf)));
    ws.onLayoutReady(() => {
      this.dashboardIfEmpty(ws.getMostRecentLeaf());
      void this.syncSidebar();
    });

    this.addCommand({
      id: "fetch-card",
      name: "Fetch card from Scryfall",
      callback: () => new NameModal(this.app, "Fetch card from Scryfall", "Lightning Bolt", (n) => this.fetchCardNote(n)).open(),
    });
    this.addCommand({
      id: "create-deck",
      name: "Create deck",
      callback: () => new NameModal(this.app, "Create deck", "赤単バーン", (n, f, l) => void (l.trim() ? this.importDeck(n, l, f) : this.createDeck(n, f)), true).open(),
    });
    this.addCommand({
      id: "import-deck",
      name: "Import deck (Moxfield text)",
      callback: () => new ImportModal(this.app, true, (n, t, f) => void this.importDeck(n, t, f)).open(),
    });
    this.addCommand({ id: "open-collection", name: "Open collection", callback: () => void this.openOrReveal(COLLECTION_VIEW) });
    this.addCommand({
      id: "update-legality",
      name: "Update card legality (cards without it)",
      callback: async () => {
        const keys = localCards(this.app).filter((c) => !c.legal || !c.restricted).map((c) => c.file.basename);
        if (!keys.length) return void new Notice("リーガル情報が無いカードはない");
        new Notice(`リーガル情報を更新中… ${keys.length} 枚`);
        try {
          new Notice(`リーガル情報を更新: ${(await updateLegality(this.app, keys)).size} 枚`);
        } catch (e) {
          new Notice(`更新失敗: ${(e as Error).message}`);
        }
      },
    });
    this.addCommand({ id: "battle-sample-rules", name: "Battle: create sample rules", callback: () => void this.createSampleRules() });
    this.addCommand({ id: "battle-build-rules", name: "Battle: build rules with AI", callback: () => void this.openBuildRules() });
    this.addCommand({ id: "battle-edit-rule", name: "Battle: edit rule nodes", callback: () => void this.openEditor() });
    this.addCommand({ id: "battle-restore-rule", name: "Battle: restore rule version", callback: () => void this.openRestore() });
    this.addCommand({ id: "battle-rules-coverage", name: "Battle: rules coverage", callback: () => void this.rulesCoverage() });
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openOrReveal(DASHBOARD_VIEW) });
    this.addRibbonIcon("layout-dashboard", "Magic the Obsidian", () => void this.openOrReveal(DASHBOARD_VIEW));
    this.addCommand({
      id: "update-prices",
      name: "Update collection prices",
      callback: async () => {
        new Notice("価格を更新中…");
        try {
          new Notice(`価格を更新: ${await updateCollectionPrices(this.app)} 件`);
        } catch (e) {
          new Notice(`価格の更新失敗: ${(e as Error).message}`);
        }
      },
    });
    this.addCommand({
      id: "open-deck-view",
      name: "Open current deck in deck view",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const isDeck = file && this.app.metadataCache.getFileCache(file)?.frontmatter?.mtg === "deck";
        if (isDeck && !checking) void this.openDeck(file);
        return !!isDeck;
      },
    });
  }

  // 開いたデッキ (タブを切り替えたデッキ) を、サイドバーの一覧の追加先にする。
  // 背面だったタブは未読み込み (deferred) のことがあるので、読み込んでから使う
  private async followDeck(leaf: WorkspaceLeaf) {
    await (leaf as unknown as { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
    if (leaf.view instanceof DeckView) {
      this.target = leaf.view;
      this.updateLists();
    }
  }

  // サイドバーを開いて、カード一覧のタブを前に出す。操作中のデッキ画面 (back) には、そのまま戻す
  private async showList(back?: WorkspaceLeaf) {
    const ws = this.app.workspace;
    const list = ws.getLeavesOfType(CARDLIST_VIEW)[0];
    if (!list || !this.settings.sidebar) return;
    await ws.revealLeaf(list);
    if (back) ws.setActiveLeaf(back, { focus: true });
  }

  // サイドバーの一覧はデッキ画面と一緒に出入りする: 他のタブに切り替えたら畳み、デッキ画面に戻ったら開き直す
  private tieSidebar(leaf: WorkspaceLeaf | null) {
    const ws = this.app.workspace;
    if (!leaf || leaf.getRoot() !== ws.rootSplit) return; // サイドバー自身や別ウィンドウのタブは触らない
    if (leaf.view.getViewType() === DECK_VIEW) {
      if (this.closedByTab) void this.showList(leaf);
      this.closedByTab = false;
    } else if (ws.getLeavesOfType(CARDLIST_VIEW).some((l) => l.view.containerEl.isShown())) {
      ws.rightSplit.collapse();
      this.closedByTab = true;
    }
  }

  // 新しいタブ (空のタブ) をダッシュボードにする。サイドバーや別ウィンドウのタブは触らない
  private dashboardIfEmpty(leaf: WorkspaceLeaf | null) {
    if (!this.settings.dashboardTab || !leaf || leaf.view.getViewType() !== "empty") return;
    if (leaf.getRoot() !== this.app.workspace.rootSplit) return;
    void leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
  }

  // 開いていればそのタブへ、無ければ新しいタブで
  private async openOrReveal(type: string) {
    const ws = this.app.workspace;
    const open = ws.getLeavesOfType(type)[0];
    if (open) return void ws.revealLeaf(open);
    await ws.getLeaf(true).setViewState({ type, active: true });
  }

  private deckLeaves() {
    const ws = this.app.workspace;
    return [...ws.getLeavesOfType(DECK_VIEW), ...ws.getLeavesOfType(COLLECTION_VIEW)];
  }

  // サイドバーの追加先はデッキ画面だけ (コレクション画面は自前の Add cards)
  private liveTarget(): DeckView | undefined {
    // 背面のタブは未読み込み (deferred) のことがある。その view にはメソッドが無いので、読み込んでから使う
    const views = this.app.workspace
      .getLeavesOfType(DECK_VIEW)
      .map((l) => {
        void (l as unknown as { loadIfDeferred?: () => Promise<void> }).loadIfDeferred?.();
        return l.view;
      })
      .filter((v): v is DeckView => v instanceof DeckView);
    return this.target && views.includes(this.target) ? this.target : views[0];
  }

  private updateLists() {
    // 背面のタブは未読み込み (deferred) で、まだ CardListView ではない
    for (const l of this.app.workspace.getLeavesOfType(CARDLIST_VIEW)) if (l.view instanceof CardListView) l.view.updateTarget();
  }

  // デッキ画面が0→1になったときだけ自動で開く (手で閉じたら、また0になるまで開き直さない)。デッキ画面が無いときは、手で開いても閉じる
  private async syncSidebar() {
    const ws = this.app.workspace;
    const count = ws.getLeavesOfType(DECK_VIEW).length;
    const lists = ws.getLeavesOfType(CARDLIST_VIEW);
    if (!this.settings.sidebar || count === 0) {
      // 一覧が見えていたなら、閉じるときにサイドバーも畳む。他のタブだけが見えているときは触らない
      const shown = lists.some((l) => l.view.containerEl.isShown());
      lists.forEach((l) => l.detach());
      if (shown) ws.rightSplit.collapse();
    } else if (this.prevCount === 0 && !lists.length && !this.opening) {
      this.opening = true;
      try {
        const leaf = ws.getRightLeaf(false);
        if (leaf) {
          const deck = ws.getActiveViewOfType(DeckView)?.leaf;
          await leaf.setViewState({ type: CARDLIST_VIEW, active: false });
          await this.showList(deck); // デッキ画面を開いたとき、サイドバーに一覧が出る
        }
      } finally {
        this.opening = false;
      }
    }
    this.prevCount = count;
    this.updateLists();
  }

  private async ensureRulesDir() {
    if (!this.app.vault.getAbstractFileByPath(RULES_DIR)) await this.app.vault.createFolder(RULES_DIR);
  }

  // 打ち消し3種のサンプルを Rules/ に作る (すでにあるファイルは上書きしない)
  private async createSampleRules() {
    await this.ensureRulesDir();
    let made = 0;
    for (const [name, md] of Object.entries(SAMPLE_RULES)) {
      const path = normalizePath(`${RULES_DIR}/${fileSafe(name)}.md`);
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      await this.app.vault.create(path, md);
      made++;
    }
    new Notice(`サンプルのルールを ${made} 枚作った (すでにあるものは飛ばした)`);
  }

  // Cards/ の全カードについて、Rules/<名前>.md の状況 (ok / partial / unbuilt。ノートが無ければ「ルールのノートが無い」)
  private async ruleStatuses(): Promise<Map<string, CardStatus>> {
    const out = new Map<string, CardStatus>();
    for (const c of localCards(this.app)) {
      const name = c.file.basename;
      const f = this.app.vault.getAbstractFileByPath(normalizePath(`${RULES_DIR}/${name}.md`));
      out.set(name, cardStatus(name, f instanceof TFile ? await this.app.vault.read(f) : undefined));
    }
    return out;
  }

  // 状況を Rules/_coverage.md に書き出す
  private async rulesCoverage() {
    await this.ensureRulesDir();
    const statuses = [...(await this.ruleStatuses()).values()];
    const path = normalizePath(`${RULES_DIR}/_coverage.md`);
    const body = report(statuses.sort((a, b) => a.card.localeCompare(b.card)));
    const old = this.app.vault.getAbstractFileByPath(path);
    if (old instanceof TFile) await this.app.vault.modify(old, body);
    else await this.app.vault.create(path, body);
    new Notice(`ルールの状況を書き出した: ok ${statuses.filter((s) => s.status === "ok").length} / ${statuses.length} 枚`);
  }

  // AI にノードを組み立ててもらうカードを、画面で選ぶ (初期のチェックは、ルールのノートが無いカード)
  private async openBuildRules() {
    if (!claudeKey(this.app, this.settings)) return void new Notice("設定で Claude の API キーを選んでください (Magic the Obsidian → AI)");
    const statuses = await this.ruleStatuses();
    new BuildRulesModal(this.app, toRows([...statuses.keys()], statuses), (names, ruling) => void this.buildRulesFor(names, ruling)).open();
  }

  // 選ばれたカードを順に AI へ(裁定後のテキストがあれば、それも送る)。成功したら Rules/<名前>.md に書く。履歴は saveRule が残す。失敗したカードは元のまま
  private async buildRulesFor(names: string[], ruling?: string) {
    const key = claudeKey(this.app, this.settings);
    if (!key) return void new Notice("設定で Claude の API キーを選んでください (Magic the Obsidian → AI)");
    await this.ensureRulesDir();
    let made = 0;
    let over = 0;
    let failed = 0;
    for (const [i, name] of names.entries()) {
      new Notice(`AI に頼んでいる (${i + 1}/${names.length}): ${name}`);
      try {
        const oracle = await oracleEnglish(this.app, name);
        const { md } = await buildRule({ card: name, oracle, ruling, ask: (system, messages) => askClaude({ apiKey: key, model: this.settings.claudeModel, system, messages, http: obsidianHttp }) });
        if ((await this.saveRule(name, md, "ai")) === "created") made++;
        else over++;
      } catch (e) {
        failed++;
        new Notice(`${name}: ${(e as Error).message}`);
      }
    }
    new Notice(`AI のルール作成: 作った ${made} 枚 / 上書きした ${over} 枚 / 失敗 ${failed} 枚`);
  }

  // ---- ルールの履歴: Rules/_backup/<カード名>/<日時>-<種類>.md ----
  private ruleName(path: string): string | null {
    const m = path.match(new RegExp(`^${RULES_DIR}/([^/]+)\\.md$`));
    return m && !m[1].startsWith("_") ? m[1] : null;
  }

  // ルールの保存の入口。すでにあれば、書き換える前の内容を先に履歴に残してから書く (履歴の保存に失敗したら書かない)。
  // AI の作り替え (kind="ai") と、版を戻す (kind="restore") が使う。あとで作るノード設定画面の「保存」も、kind="edit" でこれを呼ぶ。
  // md を直接書き換えた分は、保存のタイミングが分からないので、履歴には残さない
  private async saveRule(name: string, md: string, kind: Kind): Promise<"created" | "updated" | "same"> {
    const path = normalizePath(`${RULES_DIR}/${fileSafe(name)}.md`);
    const old = this.app.vault.getAbstractFileByPath(path);
    if (!(old instanceof TFile)) {
      await this.app.vault.create(path, md);
      return "created";
    }
    const before = await this.app.vault.read(old);
    if (before === md) return "same";
    await this.snapshot(name, before, kind);
    await this.app.vault.modify(old, md);
    return "updated";
  }

  private versionFiles(name: string): TFile[] {
    const dir = `${RULES_DIR}/_backup/${name}/`;
    return this.app.vault.getFiles().filter((f) => f.path.startsWith(dir) && !f.path.slice(dir.length).includes("/"));
  }

  // 書き換わる前の内容を、履歴に1ファイル足す。直前の版と同じ内容なら足さない
  private async snapshot(name: string, content: string, kind: Kind) {
    for (const d of [normalizePath(`${RULES_DIR}/_backup`), normalizePath(`${RULES_DIR}/_backup/${name}`)]) if (!this.app.vault.getAbstractFileByPath(d)) await this.app.vault.createFolder(d);
    const files = this.versionFiles(name);
    const latest = sortNewestFirst(files.map((f) => f.name))[0];
    const lf = files.find((f) => f.name === latest);
    if (lf && (await this.app.vault.read(lf)) === content) return;
    await this.app.vault.create(normalizePath(`${RULES_DIR}/_backup/${name}/${freeName(new Date(), kind, new Set(files.map((f) => f.name)))}`), content);
  }

  // 開いている Rules/<名前>.md か Cards/<名前>.md のノード設定画面を開く (同じカードが開いていれば、そのタブへ)
  private async openEditor() {
    const path = this.app.workspace.getActiveFile()?.path ?? "";
    const card = this.ruleName(path) ?? path.match(/^Cards\/([^/]+)\.md$/)?.[1];
    if (!card) return void new Notice("Rules/<カード名>.md か Cards/<カード名>.md を開いてから実行してください");
    const open = this.app.workspace.getLeavesOfType(RULE_EDITOR_VIEW).find((l) => l.getViewState().state?.card === card);
    if (open) return void this.app.workspace.revealLeaf(open);
    await this.app.workspace.getLeaf(true).setViewState({ type: RULE_EDITOR_VIEW, state: { card }, active: true });
  }

  // 開いているルール (または履歴のノート) の、版の一覧から戻す
  private openRestore() {
    const path = this.app.workspace.getActiveFile()?.path ?? "";
    const name = this.ruleName(path) ?? path.match(new RegExp(`^${RULES_DIR}/_backup/([^/]+)/[^/]+\\.md$`))?.[1];
    if (!name) return void new Notice("Rules/<カード名>.md か、その履歴のノートを開いてから実行してください");
    const files = this.versionFiles(name);
    const versions = sortNewestFirst(files.map((f) => f.name)).map((n) => ({ file: files.find((f) => f.name === n)!, ...parseVersion(n)! }));
    if (!versions.length) return void new Notice(`${name}: 履歴はまだない`);
    new RestoreRuleModal(this.app, name, versions, (f) => void this.restoreVersion(name, f), (f) => void this.app.workspace.getLeaf(true).openFile(f)).open();
  }

  // 選んだ版に戻す。いまの内容は、saveRule が先に履歴に残す (戻したことも取り消せる)
  private async restoreVersion(name: string, file: TFile) {
    const r = await this.saveRule(name, await this.app.vault.read(file), "restore");
    new Notice(r === "same" ? `${name}: すでにこの版です` : `${name}: ${parseVersion(file.name)?.stamp ?? file.name} の版に戻した`);
  }

  private async fetchCardNote(query: string) {
    try {
      const file = await ensureCardFile(this.app, await fetchCard(query), this.settings);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice(`Card fetch failed: ${(e as Error).message}`);
    }
  }

  private async createDeck(name: string, format: string) {
    const path = normalizePath(`${DECK_DIR}/${fileSafe(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return new Notice(`Already exists: ${path}`);
    if (!this.app.vault.getAbstractFileByPath(DECK_DIR)) await this.app.vault.createFolder(DECK_DIR);
    await this.openDeck(await this.app.vault.create(path, deckTemplate(format)));
  }

  private async importDeck(name: string, text: string, format: string) {
    const path = normalizePath(`${DECK_DIR}/${fileSafe(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) return void new Notice(`Already exists: ${path}`);
    const r = await resolveDeck(this.app, this.settings, text);
    if (!r) return;
    if (!this.app.vault.getAbstractFileByPath(DECK_DIR)) await this.app.vault.createFolder(DECK_DIR);
    await this.openDeck(await this.app.vault.create(path, writeDeck(deckTemplate(format), format === "commander" ? r.deck : foldCommander(r.deck))));
  }

  private async openDeck(file: TFile) {
    // 同じデッキが既に開いていれば、そのタブへ
    const open = this.app.workspace.getLeavesOfType(DECK_VIEW).find((l) => l.getViewState().state?.path === file.path);
    if (open) return void this.app.workspace.revealLeaf(open);
    try {
      await this.app.workspace.getLeaf(true).setViewState({ type: DECK_VIEW, state: { path: file.path }, active: true });
    } catch (e) {
      console.error(e);
      new Notice(`Deck view failed: ${(e as Error).message}`);
    }
  }
}
