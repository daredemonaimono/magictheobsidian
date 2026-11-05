// スタックのカードの下に出す、効果テキスト。カードのテキスト (ノートの本文。段落は空行で区切られる) から、使った効果だけを取り出す。画面 (BattleView) が使う、純粋な関数
export interface StackTextOpts {
  typeLine?: string; // 先頭の型行の段落を、取り除く
  loyalty?: number; // プレインズウォーカーの能力の忠誠度コスト (+1 → 1、−2 → −2)
  loyaltyX?: boolean; // −X の能力
  modes?: number[]; // 選んだモード (1 始まり)
}

const norm = (s: string) => s.replace(/[−–—]/g, "-").replace(/＋/g, "+").replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));

// 忠誠度能力の段落 ("+1: …" "-2：…" "−X: …") の、コスト部分 ("+1" "-2" "-X")。無ければ undefined
const loyaltyHead = (p: string): string | undefined => norm(p).match(/^\s*([+-]?\d+|[+-]?X)\s*[:：]/i)?.[1].toUpperCase();

export function stackEffectText(text: string, o: StackTextOpts = {}): string {
  let paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (o.typeLine && paras[0] && norm(paras[0]) === norm(o.typeLine)) paras = paras.slice(1);
  // 忠誠度能力: 使った能力の段落だけ
  if (o.loyalty !== undefined || o.loyaltyX) {
    const want = o.loyaltyX ? "-X" : o.loyalty! > 0 ? `+${o.loyalty}` : String(o.loyalty);
    const hit = paras.find((p) => {
      const h = loyaltyHead(p);
      return h !== undefined && (h === want || (!o.loyaltyX && o.loyalty! > 0 && h === String(o.loyalty)));
    });
    if (hit) return hit;
  }
  // モード: 「以下から選ぶ」の見出しと、選んだモード (• で始まる段落) だけ
  if (o.modes?.length) {
    const bullets = paras.filter((p) => /^[•・●]/.test(p));
    const first = paras.findIndex((p) => /^[•・●]/.test(p));
    if (bullets.length && first > 0) return [paras[first - 1], ...o.modes.map((i) => bullets[i - 1]).filter(Boolean)].join("\n");
  }
  return paras.join("\n\n");
}
