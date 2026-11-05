import { App, Notice, Plugin, PluginSettingTab, SecretComponent, Setting } from "obsidian";
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
  sidebar: boolean; // カード一覧を右サイドバーに出す。オフなら画面内の検索欄 (従来の表示)
  claudeKeySecret: string; // API キーの、Obsidian のキーチェーン (app.secretStorage) 上の名前。キーそのものは data.json に書かない
  claudeModel: string; // ノードの組み立てに使うモデル
  battleOpponent: "cpu" | "passive"; // 対戦の相手。cpu = 雑魚 CPU (土地を出す・呪文を唱える) / passive = 何もしない
  battleStops: "always" | "smart"; // 対戦の優先権の止まり方。always = 毎回止まる / smart = 使えるものがあるときだけ (メインフェイズでは、必ず止まる)
}

export const DEFAULT_SETTINGS: Settings = { textLang: "en", cardLang: "en", sidebar: true, listArt: true, dashboardTab: true, currency: "USD", claudeKeySecret: "", claudeModel: "claude-opus-5-5", battleStops: "smart", battleOpponent: "cpu" };

// 設定で選んだ名前のキーを、キーチェーンから取る。未設定・見つからないときは null
export const claudeKey = (app: App, s: Settings): string | null => (s.claudeKeySecret ? app.secretStorage.getSecret(s.claudeKeySecret) : null);

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
    lang("効果テキストの言語 / Text language", "カード名と効果テキスト。無い言語は英語で表示。新しく取得するカードから反映。", "textLang");
    lang("カードの言語 / Card language", "カード画像とイラスト選択の言語。その言語の版が無いカードは英語になる。新しく取得するカードから反映。", "cardLang");
    new Setting(this.containerEl)
      .setName("対戦の相手 / Battle opponent")
      .setDesc("雑魚 CPU: 機械的な決まりで動く(マリガン・土地を出す・呪文を唱える。攻撃とブロックは、まだしない)。何もしない: 相手は何もしない(自分の操作の確認用)。開いている対戦の画面を開き直したときと、新しく始める対戦から反映。")
      .addDropdown((d) =>
        d
          .addOptions({ cpu: "雑魚 CPU", passive: "何もしない" })
          .setValue(this.settings.battleOpponent)
          .onChange(async (v) => {
            this.settings.battleOpponent = v === "passive" ? "passive" : "cpu";
            await this.save();
          }),
      );
    new Setting(this.containerEl)
      .setName("対戦の止まり方 / Battle priority stops")
      .setDesc("「次へ」は、次のステップへ進む。何もできないステップ(土地を出せない・唱えられない・使える能力が無い。土地やカードの能力のマナを全部出したと仮定)で、「使えるものがあるときだけ」は、真ん中の帯の時間ゲージ(5秒)が進んで、自動で次へ進む。できることがあるステップは、ゲージが満タンのまま待つ。「毎回止まる」は、ゲージが動かず、自分で「次へ」を押すまで待つ。")
      .addDropdown((d) =>
        d
          .addOptions({ smart: "何もできないとき、ゲージで自動で進む", always: "毎回止まる" })
          .setValue(this.settings.battleStops)
          .onChange(async (v) => {
            this.settings.battleStops = v === "always" ? "always" : "smart";
            await this.save();
          }),
      );
    new Setting(this.containerEl).setName("AI(ノードの組み立て) / AI").setHeading();
    new Setting(this.containerEl)
      .setName("API キー / Claude API key")
      .setDesc("Obsidian のキーチェーンに保存される。このプラグインの設定(data.json)には、保存先の名前だけが残る。")
      .addComponent((el) =>
        new SecretComponent(this.app, el).setValue(this.settings.claudeKeySecret).onChange(async (id) => {
          this.settings.claudeKeySecret = id ?? "";
          await this.save();
        }),
      );
    new Setting(this.containerEl)
      .setName("モデル / Model")
      .setDesc("安く済ませたいときは claude-sonnet-5-5 など。")
      .addText((t) =>
        t.setValue(this.settings.claudeModel).onChange(async (v) => {
          this.settings.claudeModel = v.trim() || DEFAULT_SETTINGS.claudeModel;
          await this.save();
        }),
      );
  }
}
