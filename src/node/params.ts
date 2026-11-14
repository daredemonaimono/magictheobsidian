import { Label } from "../i18n";

// 引数の型と、呼び出せるもの (動作・条件・引数つきの対象)。id は言語に依らない。
export interface Choice {
  id: string;
  label: Label;
}
export interface ParamDef {
  id: string;
  label: Label;
  type: "number" | "choice" | "multi" | "card" | "mana" | "text"; // multi = choices から、いくつでも選ぶ (値は id を | でつなぐ) / mana = マナ・シンボルの並び ({2}{R}・{C}{C}{C}。107.4) / card = 登録してあるカード (Cards/) を、名前で指す
  choices?: Choice[];
  filter?: "token" | "emblem"; // card のとき: 選べるカード (token = トークンのカードだけ / emblem = 紋章のカードだけ)
  optional?: boolean; // 無くてもよい (空・無しは、検証で止めない。md には、空の値を書かない)
  default: string; // 選択のときは、choice の id
}
// 引数を持って呼び出せるもの: 動作・条件・引数つきの対象 (「各〜」)
export interface Callable {
  id: string;
  label: Label;
  fn?: string; // 割り振られた関数の名前。md には、この名前の呼び出しで書く
  params: ParamDef[];
  only?: string[]; // 使える種類 (無ければ、どれでも)
}

export const choice = (id: string, ja: string, en: string): Choice => ({ id, label: { ja, en } });
// 条件 (ノードで使う、人・もの) の、引数の共通の選択肢
export const WHO_CHOICES = [choice("you", "あなた", "you"), choice("target-player", "対象のプレイヤー", "target player"), choice("controller-of-target", "対象のコントローラー (109.4)", "the target's controller"), choice("owner-of-target", "対象の持ち主 (108.3)", "the target's owner")];
// 色 (105.1)
export const COLOR_CHOICES = [choice("any", "色を問わない", "any color"), choice("white", "白", "white"), choice("blue", "青", "blue"), choice("black", "黒", "black"), choice("red", "赤", "red"), choice("green", "緑", "green")];

// マナ・シンボルの並び ({4}・{C}{C}{C}・{2}{R}・{W/U}・{X} など。107.4)
export const isMana = (v: string): boolean => /^(\{[0-9A-Z]+(?:\/[0-9A-Z]+)*\})+$/.test(v);
