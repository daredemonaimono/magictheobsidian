import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

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

export type PriceSource = "scryfall" | "scryfall-first" | "tcg";

export interface Settings {
  textLang: string; // カード名・効果テキスト
  cardLang: string; // カード画像 (収録一覧)
  listArt: boolean; // サイドバーの一覧に、カードのイラストを薄く出す
  dashboardTab: boolean; // 新しいタブ (空のタブ) をダッシュボードにする
  priceSource: PriceSource; // 価格の取得元
  tcgKey: string; // TCG Price Lookup の API キー。空なら使わない
  sidebar: boolean; // カード一覧を右サイドバーに出す。オフなら画面内の検索欄 (従来の表示)
}

export const DEFAULT_SETTINGS: Settings = { textLang: "en", cardLang: "en", sidebar: true, listArt: true, dashboardTab: true, priceSource: "scryfall-first", tcgKey: "" };

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
      .setName("価格の取得元 / Price source")
      .setDesc("価格の更新で使う API。「Scryfall 優先」は、Scryfall で値段が取れなかったカードだけ TCG Price Lookup で取る。TCG Price Lookup を使うには、下に API キーが要る。")
      .addDropdown((d) =>
        d
          .addOptions({ scryfall: "Scryfall のみ", "scryfall-first": "Scryfall 優先 (取れない分だけ TCG Price Lookup)", tcg: "TCG Price Lookup のみ" })
          .setValue(this.settings.priceSource)
          .onChange(async (v) => {
            this.settings.priceSource = v as PriceSource;
            await this.save();
          }),
      );
    new Setting(this.containerEl)
      .setName("TCG Price Lookup の API キー / API key")
      .setDesc("価格の取得元で TCG Price Lookup を使うときに入れる (無料枠は1日100回)。キーは tcgpricelookup.com で発行する。空だと、Scryfall のみになる。")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(this.settings.tcgKey).onChange(async (v) => {
          this.settings.tcgKey = v.trim();
          await this.save();
        });
      });
    lang("効果テキストの言語 / Text language", "カード名と効果テキスト。無い言語は英語で表示。新しく取得するカードから反映。", "textLang");
    lang("カードの言語 / Card language", "カード画像とイラスト選択の言語。その言語の版が無いカードは英語になる。新しく取得するカードから反映。", "cardLang");
  }
}
