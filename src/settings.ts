import { App, Notice, Plugin, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { AiSettings, DEFAULT_AI, PROVIDERS, Provider, SCENES, Scene } from "./battle/aiConfig";
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
  sidebar: boolean; // カード一覧・対戦のプレビューとログを右サイドバーに出す。オフなら画面内 (従来の表示)
  ai: AiSettings; // AI の接続 (キー) と、場面ごとの使い分け (対戦の相手・ルールを書かせる・メモの下書き)
  battleOpponent: "cpu" | "claude" | "passive"; // 対戦の相手。cpu = 雑魚 CPU / claude = AI (API を、判断のたびに呼ぶ。種類は、ai の battle) / passive = 何もしない
  battleHistory: boolean; // 対戦の履歴を Battles/ に保存する (終わったとき・途中でやめたとき)
  battleEffects: boolean; // 対戦の演出 (ダメージ・ライフの数字を大きく出す)
  battleStops: "always" | "smart"; // 対戦の優先権の止まり方。always = 毎回止まる / smart = 使えるものがあるときだけ (メインフェイズでは、必ず止まる)
}

export const DEFAULT_SETTINGS: Settings = { textLang: "en", cardLang: "en", sidebar: true, listArt: true, dashboardTab: true, currency: "USD", ai: DEFAULT_AI, battleStops: "smart", battleOpponent: "cpu", battleHistory: true, battleEffects: true };

// 設定の名前で、キーチェーンから取る (空・見つからないときは null)
export const secretKey = (app: App, name: string): string | null => (name ? app.secretStorage.getSecret(name) : null);

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private settings: Settings, private save: () => Promise<void>, private onSidebar: () => void) {
    super(app, plugin);
  }
  display() {
    this.containerEl.empty();
    const section = (name: string, desc?: string) => {
      const st = new Setting(this.containerEl).setName(name).setHeading();
      if (desc) st.setDesc(desc);
    };
    section("一般 / General");
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
      .setName("サイドバーを使う / Use sidebar (デッキ画面のカード一覧・対戦のプレビューとログ)")
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
    // ---- 対戦: 相手・進み方・履歴・演出
    // 切り替えボタン (トグル式): 1つだけ選べる
    const toggles = <T extends string>(name: string, desc: string, options: [T, string][], current: T, onPick: (v: T) => Promise<void>) => {
      const st = new Setting(this.containerEl).setName(name).setDesc(desc);
      const row = st.controlEl.createDiv("mtg-seg");
      for (const [v, label] of options) {
        const b = row.createEl("button", { text: label, cls: v === current ? "is-on" : "" });
        b.addEventListener("click", async () => {
          await onPick(v);
          this.display(); // 選んだものに合わせて、画面を出し直す
        });
      }
    };
    section("対戦 / Battle");
    toggles<"cpu" | "claude" | "passive">(
      "対戦の相手 / Battle opponent",
      "雑魚 CPU: 機械的な決まりで動く(マリガン・土地・呪文・攻撃・ブロック)。AI: 盤面を API で渡して、判断させる(判断のたびに、有料の API を呼ぶことがある。どの AI かは、下の「AI の使い分け」。キーが無い・失敗したときは、以降、雑魚 CPU になる)。何もしない: 相手は何もしない(自分の操作の確認用)。開いている対戦の画面を開き直したときと、新しく始める対戦から反映。",
      [["cpu", "雑魚 CPU"], ["claude", "AI"], ["passive", "何もしない"]],
      this.settings.battleOpponent,
      async (v) => {
        this.settings.battleOpponent = v;
        await this.save();
      },
    );
    new Setting(this.containerEl)
      .setName("対戦の止まり方 / Battle priority stops")
      .setDesc("「次へ」は、次のステップへ進む。何もできないステップ(土地を出せない・唱えられない・使える能力が無い。土地やカードの能力のマナを全部出したと仮定)で、「使えるものがあるときだけ」は、真ん中の帯の時間ゲージ(3秒)が進んで、自動で次へ進む。できることがあるステップは、ゲージが満タンのまま待つ。「毎回止まる」は、ゲージが動かず、自分で「次へ」を押すまで待つ。")
      .addDropdown((d) =>
        d
          .addOptions({ smart: "何もできないとき、ゲージで自動で進む", always: "毎回止まる" })
          .setValue(this.settings.battleStops)
          .onChange(async (v) => {
            this.settings.battleStops = v === "always" ? "always" : "smart";
            await this.save();
          }),
      );
    new Setting(this.containerEl)
      .setName("対戦の履歴を保存する / Save battle history")
      .setDesc("対戦が終わったとき(や、途中でやめたとき)、Battles/ に、ログとリプレイ用の記録を、ノートとして保存する。")
      .addToggle((t) =>
        t.setValue(this.settings.battleHistory).onChange(async (v) => {
          this.settings.battleHistory = v;
          await this.save();
        }),
      );
    new Setting(this.containerEl)
      .setName("対戦の演出 / Battle effects")
      .setDesc("ダメージやライフが変わったとき、数字を大きく出して、ふくらませて消す。相手の手札を見たとき、手札を前に出す。重いと感じたらオフ。")
      .addToggle((t) =>
        t.setValue(this.settings.battleEffects).onChange(async (v) => {
          this.settings.battleEffects = v;
          await this.save();
        }),
      );

    // ---- AI: 接続 (キー) は種類ごとに 1 つ。使い分けは、場面ごと。種類を切り替えても、キーも、各種類のモデルも、残る
    const ai = this.settings.ai;
    section("AI の接続 / AI connections", "API キーは、Obsidian のキーチェーンに保存される(設定のファイルには、保存先の名前だけが残る)。使わない種類は、空のままでよい。種類を切り替えても、ここの設定は、消えない。");
    const keyRow = (p: Provider, name: string, desc: string) =>
      new Setting(this.containerEl)
        .setName(name)
        .setDesc(desc)
        .addComponent((el) =>
          new SecretComponent(this.app, el).setValue(ai.keys[p]).onChange(async (id) => {
            ai.keys[p] = id ?? "";
            await this.save();
          }),
        );
    keyRow("claude", "Claude の API キー / Claude API key", "Anthropic。");
    keyRow("openai", "OpenAI の API キー / OpenAI API key", "OpenAI。自分のパソコンで動かす AI (互換 API) で、キーが要らないときは、空のままでよい。");
    new Setting(this.containerEl)
      .setName("OpenAI の URL (互換 API のとき) / Base URL")
      .setDesc("既定は https://api.openai.com/v1。Ollama なら http://localhost:11434/v1 。LM Studio なら http://localhost:1234/v1 。URL を変えると、キー無しでも使える。")
      .addText((t) =>
        t.setValue(ai.openaiBaseUrl).onChange(async (v) => {
          ai.openaiBaseUrl = v.trim() || DEFAULT_AI.openaiBaseUrl;
          await this.save();
        }),
      );
    keyRow("gemini", "Gemini の API キー / Gemini API key", "Google。");

    section("AI の使い分け / AI by task", "場面ごとに、使う AI の種類と、モデルを選ぶ(例: 対戦の相手は、安い Haiku。ルールを書かせるのは、強い Opus)。種類を切り替えても、各種類のモデルは、残る。モデル名は、各社の最新のものを、自分で入れる(初期値は、仮のもの)。盤面・履歴・カードの情報が、選んだ会社のサーバーに送られる。");
    const hint: Record<Provider, string> = { claude: "例: claude-haiku-5-5(安い)/ claude-sonnet-5-5 / claude-opus-5-5 / claude-fable-5-1(強い・高い)", openai: "例: gpt-4o-mini", gemini: "例: gemini-2.5-flash" };
    for (const [scene, label, desc] of SCENES) {
      const sc = ai.scenes[scene as Scene];
      toggles<Provider>(label, desc, PROVIDERS, sc.provider, async (v) => {
        sc.provider = v;
        await this.save();
      });
      new Setting(this.containerEl)
        .setName(`　モデル (${PROVIDERS.find(([id]) => id === sc.provider)![1]})`)
        .setDesc(hint[sc.provider])
        .addText((t) =>
          t.setValue(sc.models[sc.provider]).onChange(async (v) => {
            sc.models[sc.provider] = v.trim() || DEFAULT_AI.scenes[scene as Scene].models[sc.provider];
            await this.save();
          }),
        );
    }
  }
}
