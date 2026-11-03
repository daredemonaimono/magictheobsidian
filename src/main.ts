import { App, EventRef, Modal, Notice, Plugin, Setting, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { ensureCardFile, localCards, updateLegality } from "./cards";
import { DECK_DIR, foldCommander, writeDeck } from "./deck";
import { CREATABLE, FORMATS } from "./rules";
import { ImportModal, resolveDeck } from "./import";
import { CARDLIST_VIEW, CardListView } from "./CardListView";
import { COLLECTION_VIEW, CollectionView } from "./CollectionView";
import { CARDS_VIEW, CardsView } from "./CardsView";
import { DASHBOARD_VIEW, DashboardView } from "./DashboardView";
import { DECKLIST_VIEW, DeckListView } from "./DeckListView";
import { DECK_VIEW, DeckView } from "./DeckView";
import { BOT_VIEW, BotView } from "./BotView";
import { BATTLE_VIEW, BattleView } from "./BattleView";
import { BOTLOG_VIEW, BotLogView } from "./BotLogView";
import { fetchCard, fileSafe } from "./scryfall";
import { priceStore, updateCollectionPrices } from "./prices";
import { DEFAULT_SETTINGS, Settings, SettingsTab } from "./settings";

// 「動き方」はカード行の外なので、デッキ画面で枚数を変えても書き換わらない。統率戦だけコマンダー欄があり、サイドは無い
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
    // data.json: 設定 + 価格キャッシュ (フラットな1つのオブジェクト)
    const d = (await this.loadData()) ?? {};
    this.settings = {
      textLang: d.textLang ?? DEFAULT_SETTINGS.textLang,
      cardLang: d.cardLang ?? DEFAULT_SETTINGS.cardLang,
      sidebar: d.sidebar ?? DEFAULT_SETTINGS.sidebar,
      listArt: d.listArt ?? DEFAULT_SETTINGS.listArt,
      dashboardTab: d.dashboardTab ?? DEFAULT_SETTINGS.dashboardTab,
      currency: d.currency ?? DEFAULT_SETTINGS.currency,
      botModel: d.botModel ?? DEFAULT_SETTINGS.botModel,
      botKey: d.botKey ?? DEFAULT_SETTINGS.botKey,
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
    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, { collection: () => void this.openOrReveal(COLLECTION_VIEW), deck: () => void this.openOrReveal(DECKLIST_VIEW), cards: () => void this.openOrReveal(CARDS_VIEW), bot: () => void this.openBot(BOT_VIEW), battle: () => void this.openBot(BATTLE_VIEW) }));
    this.registerView(BATTLE_VIEW, (leaf) => new BattleView(leaf, this.settings, () => this.app.secretStorage.getSecret(this.settings.botKey)));
    this.registerView(BOT_VIEW, (leaf) => new BotView(leaf, this.settings, () => this.app.secretStorage.getSecret(this.settings.botKey)));
    this.registerView(BOTLOG_VIEW, (leaf) => new BotLogView(leaf));
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
    this.addCommand({ id: "open-bot", name: "Open bot trial (solo)", callback: () => void this.openBot(BOT_VIEW) });
    this.addCommand({ id: "open-bot-battle", name: "Open bot battle (you vs bot)", callback: () => void this.openBot(BATTLE_VIEW) });
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

  // Bot の試し: メインに Bot 画面、右サイドバーにカード効果とログ
  private async openBot(type: string) {
    const ws = this.app.workspace;
    await this.openOrReveal(type);
    let log = ws.getLeavesOfType(BOTLOG_VIEW)[0];
    if (!log) {
      log = ws.getRightLeaf(false)!;
      await log.setViewState({ type: BOTLOG_VIEW, active: false });
    }
    await ws.revealLeaf(log);
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
