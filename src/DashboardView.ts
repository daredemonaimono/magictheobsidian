import { ItemView, WorkspaceLeaf } from "obsidian";

export const DASHBOARD_VIEW = "mtg-dashboard";

export interface DashboardActions {
  collection: () => void;
  deck: () => void;
  cards: () => void;
  sidebarLeft: () => boolean; // サイドバーを左に出しているか (ボタンの文字)
  pluginId: string; // このプラグインの id (コマンドの id の頭: "<id>:<コマンド>")
}

// Obsidian の内部の API (型には無い)。コマンドの一覧・ホットキー・設定画面を開く。使えなければ、その機能だけ出さない
interface InternalApp {
  commands?: { listCommands(): { id: string; name: string }[]; executeCommandById(id: string): boolean };
  hotkeyManager?: { getHotkeys?(id: string): Hotkey[] | undefined; getDefaultHotkeys?(id: string): Hotkey[] | undefined };
  setting?: { open(): void; openTabById(id: string): { searchComponent?: { setValue(v: string): void }; updateHotkeyVisibility?: () => void } | undefined };
}
interface Hotkey {
  modifiers: string[];
  key: string;
}

// 操作の入口 (まとまりごと)。command は、このプラグインのコマンドの id。ここに足すだけで、ダッシュボードにボタンが出る。
// ねらい: 左のバー (ファイル一覧) を見なくても、すべての操作が、ダッシュボードから始められること。ここに無い操作は、下の「すべてのコマンド」に出る (コマンドを足すと、自動で並ぶ)
const SECTIONS: { title: string; buttons: { label: string; command: string; hint?: string }[] }[] = [
  {
    title: "対戦",
    buttons: [
      { label: "対戦を始める", command: "battle-start" },
      { label: "対戦の履歴・リプレイ", command: "battle-replay" },
      { label: "CPU 同士の自動対戦 (デバッグ)", command: "battle-self-play" },
      { label: "デッキのメモの下書き (AI)", command: "battle-draft-memo" },
    ],
  },
  {
    title: "デッキ・カード",
    buttons: [
      { label: "新しいデッキ", command: "create-deck" },
      { label: "デッキを取り込む", command: "import-deck" },
      { label: "カードを取得 (Scryfall)", command: "fetch-card" },
      { label: "リーガルを更新", command: "update-legality" },
      { label: "価格を更新", command: "update-prices" },
      { label: "カード画像を保存", command: "cache-images" },
    ],
  },
  {
    title: "ルール・ノード",
    buttons: [
      { label: "AI でルールを作る", command: "battle-build-rules" },
      { label: "ノードを編集 (開いているカード)", command: "battle-edit-rule", hint: "Cards/ か Rules/ のノートを開いてから。カードは、「カード」の一覧から選ぶと、右に出る情報から編集できます" },
      { label: "ルールの版を戻す", command: "battle-restore-rule" },
      { label: "ルールの状況を書き出す", command: "battle-rules-coverage" },
      { label: "足りないノードの一覧を更新", command: "refresh-gaps" },
      { label: "共通の AI ルール (_agent.md)", command: "create-agent-note" },
      { label: "用語集のノートを作る", command: "battle-create-glossary" },
    ],
  },
  {
    title: "画面",
    buttons: [{ label: "カード情報 (開いているノート)", command: "card-info" }],
  },
];

const KEY_JA: Record<string, string> = { Mod: "Ctrl/⌘", Ctrl: "Ctrl", Meta: "⌘", Shift: "Shift", Alt: "Alt" };
const fmtKey = (h: Hotkey) => [...h.modifiers.map((m) => KEY_JA[m] ?? m), h.key.length === 1 ? h.key.toUpperCase() : h.key].join("+");

// ホーム画面。操作は、ここから始められる (左のバーを隠しても困らないように)。ボタンは、コマンドを実行する。「すべてのコマンド」に、ホットキーも出る
export class DashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private actions: DashboardActions) {
    super(leaf);
  }

  getViewType() {
    return DASHBOARD_VIEW;
  }
  getDisplayText() {
    return "Magic the Obsidian";
  }
  getIcon() {
    return "layout-dashboard";
  }

  private get internal(): InternalApp {
    return this.app as unknown as InternalApp;
  }
  private run(command: string) {
    this.internal.commands?.executeCommandById(`${this.actions.pluginId}:${command}`);
  }
  private hotkeysOf(id: string): string[] {
    const hm = this.internal.hotkeyManager;
    const keys = hm?.getHotkeys?.(id) ?? hm?.getDefaultHotkeys?.(id) ?? [];
    return keys.map(fmtKey);
  }
  private openHotkeySettings() {
    try {
      this.internal.setting?.open();
      const tab = this.internal.setting?.openTabById("hotkeys");
      tab?.searchComponent?.setValue("Magic the Obsidian");
      tab?.updateHotkeyVisibility?.();
    } catch {
      /* 開けなくても、設定の「ホットキー」から、手で開ける */
    }
  }

  async onOpen() {
    await this.refresh();
  }

  async refresh() {
    const root = this.contentEl;
    root.empty();
    root.addClass("mtg-dashboard");
    root.createEl("h2", { text: "Magic the Obsidian" });
    const row = root.createDiv("mtg-dash-buttons");
    row.createEl("button", { text: "コレクション" }).onclick = () => this.actions.collection();
    row.createEl("button", { text: "デッキ" }).onclick = () => this.actions.deck();
    row.createEl("button", { text: "カード" }).onclick = () => this.actions.cards();
    root.createDiv({ text: "「カード」で、カードを押すと、右のサイドバーに、ルールの設定と、採用しているデッキが出ます。", cls: "mtg-dim mtg-dash-hint" });

    // 操作の入口 (まとまりごと)
    for (const sec of SECTIONS) {
      root.createEl("h3", { text: sec.title });
      const box = root.createDiv("mtg-dash-ops");
      for (const b of sec.buttons) {
        const keys = this.hotkeysOf(`${this.actions.pluginId}:${b.command}`);
        const btn = box.createEl("button", { text: b.label, attr: { "aria-label": [b.hint, keys.length ? `ホットキー: ${keys.join(", ")}` : ""].filter(Boolean).join(" / ") } });
        if (keys.length) btn.createSpan({ text: keys[0], cls: "mtg-dash-key" });
        btn.onclick = () => this.run(b.command);
      }
      // 画面: サイドバー (カード一覧・カード情報・対戦のプレビューとログ) を、左に出すモード
      if (sec.title === "画面") {
        const left = this.actions.sidebarLeft();
        const keys = this.hotkeysOf(`${this.actions.pluginId}:toggle-sidebar-side`);
        const btn = box.createEl("button", { text: left ? "サイドバーを右に戻す" : "サイドバーを左にする", cls: left ? "mod-cta" : "", attr: { "aria-label": "カード一覧・カード情報・対戦のプレビューとログを出す側を切り替える (対戦中は、切り替えられません)" } });
        if (keys.length) btn.createSpan({ text: keys[0], cls: "mtg-dash-key" });
        btn.onclick = () => this.run("toggle-sidebar-side");
      }
    }

    // すべてのコマンド (このプラグインのもの。コマンドを足すと、自動で並ぶ)
    const all = (this.internal.commands?.listCommands() ?? []).filter((c) => c.id.startsWith(`${this.actions.pluginId}:`) && c.id !== `${this.actions.pluginId}:toggle-left-bar`).sort((a, b) => a.name.localeCompare(b.name));
    if (all.length) {
      const head = root.createDiv("mtg-dash-allhead");
      head.createEl("h3", { text: "すべてのコマンド" });
      head.createEl("button", { text: "ホットキーを設定する" }).onclick = () => this.openHotkeySettings();
      const list = root.createDiv("mtg-dash-cmds");
      for (const c of all) {
        const line = list.createDiv("mtg-dash-cmd");
        line.createSpan({ text: c.name.replace(/^Magic the Obsidian:\s*/, ""), cls: "mtg-dash-cmdname" });
        const keys = this.hotkeysOf(c.id);
        line.createSpan({ text: keys.length ? keys.join(", ") : "ホットキー未設定", cls: keys.length ? "mtg-dash-key" : "mtg-dim" });
        line.createEl("button", { text: "実行" }).onclick = () => this.internal.commands?.executeCommandById(c.id);
      }
    }
  }
}
