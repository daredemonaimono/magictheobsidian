import { Label } from "../i18n";

// 引数の型と、呼び出せるもの (動作・条件・引数つきの対象)。id は言語に依らない。
export interface Choice {
  id: string;
  label: Label;
}
export interface ParamDef {
  id: string;
  label: Label;
  type: "number" | "choice" | "multi" | "card" | "mana"; // multi = choices から、いくつでも選ぶ (値は id を | でつなぐ) / mana = マナ・シンボルの並び ({2}{R}・{C}{C}{C}。107.4) / card = 登録してあるカード (Cards/) を、名前で指す
  choices?: Choice[];
  filter?: "token"; // card のとき: 選べるカード (token = トークンのカードだけ)
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
// 色 (105.1)
export const COLOR_CHOICES = [choice("any", "色を問わない", "any color"), choice("white", "白", "white"), choice("blue", "青", "blue"), choice("black", "黒", "black"), choice("red", "赤", "red"), choice("green", "緑", "green")];

// マナ・シンボルの並び ({4}・{C}{C}{C}・{2}{R}・{W/U}・{X} など。107.4)
export const isMana = (v: string): boolean => /^(\{[0-9A-Z]+(?:\/[0-9A-Z]+)*\})+$/.test(v);
