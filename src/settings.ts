import { App, Notice, Plugin, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { MODELS } from "./claude";
import { CURRENCIES, updateRates } from "./prices";

// Scryfall の言語コード
export const LANGS: Record<string, string> = {
  en: "English",
  ja: "日本語",
  ko: "한국어",
  zhs: "简体中文",
  zht: "繁體中文",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  pt: "Português",
  ru: "Русский",
};

export interface Settings {
  textLang: string; // カード名・効果テキスト
  cardLang: string; // カード画像 (収録一覧)
  listArt: boolean; // サイドバーの一覧に、カードのイラストを薄く出す
  dashboardTab: boolean; // 新しいタブ (空のタブ) をダッシュボードにする
  currency: string; // 資産価格の通貨 (EUR で取れた価格はこれに換算する)
  botModel: string; // ボットの試しで使うモデル
  battleStops: string[]; // Bot 対戦で、あなたが優先権で止まるステップ
  botKey: string; // Claude API キーの保存名 (値は Obsidian のキーチェーンに入り、ここには書かない)
  sidebar: boolean; // カード一覧を右サイドバーに出す。オフなら画面内の検索欄 (従来の表示)
}

export const DEFAULT_SETTINGS: Settings = { textLang: "en", cardLang: "en", sidebar: true, listArt: true, dashboardTab: true, currency: "USD", botModel: "claude-haiku-5-5", botKey: "", battleStops: ["main1", "main2", "end"] };

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private settings: Settings, private save: () => Promise<void>, private onSidebar: () => void) {
    super(app, plugin);
  }
  display() {
    this.containerEl.empty();
    const lang = (name: string, desc: string, key: "textLang" | "cardLang") =>
      new Setting(this.containerEl)
        .setName(name)
        .setDesc(desc)
        .addDropdown((d) =>
          d
            .addOptions(LANGS)
            .setValue(this.settings[key])
            .onChange(async (v) => {
              this.settings[key] = v;
              await this.save();
            }),
        );
    new Setting(this.containerEl)
      .setName("新しいタブをダッシュボードにする / New tab is the dashboard")
      .setDesc("新しいタブ(空のタブ)を開くと、ダッシュボードが開く。オフにすると、Obsidian 標準の新しいタブに戻る。")
      .addToggle((t) =>
        t.setValue(this.settings.dashboardTab).onChange(async (v) => {
          this.settings.dashboardTab = v;
          await this.save();
        }),
      );
    new Setting(this.containerEl)
      .setName("カード一覧をサイドバーに出す / Card list in sidebar")
      .setDesc("デッキ画面を開いている間だけ右サイドバーが出る。条件が空のときはデッキ内のカード、検索・フィルターすると追加できる(クリックで追加、Shift+クリックで削除)。オフにすると、画面内の検索欄(従来の表示)に戻る。")
      .addToggle((t) =>
        t.setValue(this.settings.sidebar).onChange(async (v) => {
          this.settings.sidebar = v;
          await this.save();
          this.onSidebar();
        }),
      );
    new Setting(this.containerEl)
      .setName("一覧にイラストを出す / Art in card list")
      .setDesc("サイドバーの一覧に、カードのイラストを薄く出す。重いと感じたらオフ。見えている行の分だけ読み込む。")
      .addToggle((t) =>
        t.setValue(this.settings.listArt).onChange(async (v) => {
          this.settings.listArt = v;
          await this.save();
          this.onSidebar();
        }),
      );
    new Setting(this.containerEl)
      .setName("価格の通貨 / Currency")
      .setDesc("コレクションの価格と合計の通貨。Scryfall の USD を換算して出す。USD が無いカードは、EUR の価格を換算する。為替レートは、価格の更新と、この設定を変えたときに取る。")
      .addDropdown((d) =>
        d
          .addOptions(CURRENCIES)
          .setValue(this.settings.currency)
          .onChange(async (v) => {
            this.settings.currency = v;
            await this.save();
            await updateRates().catch(() => new Notice("為替レートを取れなかった"));
          }),
      );
    new Setting(this.containerEl)
      .setName("Bot: Claude API キー / API key")
      .setDesc("キーの値は Obsidian のキーチェーンに保存され、data.json やノートには書かれない。Bot の試し(ひとり回し)で使う。")
      .addComponent((el) =>
        new SecretComponent(this.app, el).setValue(this.settings.botKey).onChange(async (v) => {
          this.settings.botKey = v ?? "";
          await this.save();
        }),
      );
    new Setting(this.containerEl)
      .setName("Bot: モデル / Model")
      .setDesc("Bot 画面の初期のモデル。")
      .addDropdown((d) =>
        d
          .addOptions(Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, m.label])))
          .setValue(this.settings.botModel)
          .onChange(async (v) => {
            this.settings.botModel = v;
            await this.save();
          }),
      );
    lang("効果テキストの言語 / Text language", "カード名と効果テキスト。無い言語は英語で表示。新しく取得するカードから反映。", "textLang");
    lang("カードの言語 / Card language", "カード画像とイラスト選択の言語。その言語の版が無いカードは英語になる。新しく取得するカードから反映。", "cardLang");
  }
}
