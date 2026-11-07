import json,re,collections,sys,datetime
src=open(sys.argv[1]).read()
T=eval(src[src.index("T=[")+2:src.index("def norm(card):")].strip())
meta={t[0]:t for t in T}
d=json.load(open(sys.argv[2]))
cards=d["cards"]; unk=d["unknown"]
RANK={"ok":0,"part":1,"no":2}
def worst(c): return max([RANK[meta[t][3]] for t in c["tags"]]+[0])
def bestrank(c): return min(c["formats"].values())
n=len(cards)
full=[c for c in cards if worst(c)==0]; lenient=[c for c in cards if worst(c)<=1]
# 形式・順位帯ごとの対応率
def bucket(label,sel):
    return f"| {label} | {len(sel)} | {sum(1 for c in sel if worst(c)==0)} ({sum(1 for c in sel if worst(c)==0)*100//max(1,len(sel))}%) | {sum(1 for c in sel if worst(c)<=1)} ({sum(1 for c in sel if worst(c)<=1)*100//max(1,len(sel))}%) |"
rows=[bucket("全部",cards)]
for fmt,jp in (("commander","統率戦"),("modern","モダン"),("standard","スタンダード"),("legacy","レガシー")):
    sel=[c for c in cards if fmt in c["formats"]]
    rows.append(bucket(f"{jp} (人気上位 {len(sel)} 枚)",sel))
    rows.append(bucket(f"　うち上位 100 枚",[c for c in sel if c["formats"][fmt]<=100]))
# 不足タグ
by_tag=collections.defaultdict(list)
for c in cards:
    for t in c["tags"]: by_tag[t].append(c)
gaps=[]
for tid,label,rx,st,note in T:
    if st=="ok": continue
    cs=by_tag[tid]
    if not cs: continue
    sole=[c for c in cs if all(meta[t][3]=="ok" or t==tid for t in c["tags"])]
    gaps.append((len(sole),len(cs),tid,label,st,note,sole,cs))
gaps.sort(key=lambda x:(-x[0],-x[1]))
# 貪欲法: 実装していくと、書けるカードが、何枚になるか
impl=set(); order=[]
cur=len([c for c in cards if all(meta[t][3]=="ok" or t in impl for t in c["tags"])])
tags_left={g[2] for g in gaps}
while tags_left:
    best=None
    for t in tags_left:
        k=len([c for c in cards if all(meta[x][3]=="ok" or x in impl or x==t for x in c["tags"])])
        if best is None or k>best[1]: best=(t,k)
    t,k=best
    if k==cur and len(order)>=12: break
    order.append((t,k-cur,k)); impl.add(t); cur=k; tags_left.discard(t)
    if len(order)>=15: break
# 提案
PROP={
"e_pump_dynamic":"**数える部品の拡張**: `countCards` の数える対象を広げる (戦場のパーマネントを型・色・トークンで絞る、墓地・手札・ライフ・カウンターの数)。`staticModify`・`modify` の数値に、数える部品の出力 (`$n`) を渡せるようにする。「〜1つにつき +1/+1」「〜の数に等しいダメージ」がまとめて書ける。",
"e_token_ability":"**トークンの能力**: `createToken` に `keywords=`(飛行など)と、組み込みの定義名 `predefined=treasure|food|clue|blood|map` を足す。名前つきの能力 (Treasure の「{T}、生け贄: 好きな色のマナ」など) は、定義名から、起動型能力を持たせる。",
"e_replace_other":"**置換効果の部品**: 「〜なら、かわりに〜」を、ダメージ・引く・戦場に出る・墓地に置く、の4つの入口に分けて、`replace event=... with ...` の形で書けるようにする。設計が要るので、先に仕様を決める。",
"e_kw_action":"**キーワード処理の組み合わせノード**: explore・amass・connive・investigate・populate・incubate などは、いまあるノードの組み合わせ (カウンター・トークン・見る・捨てる) で書ける。コードを書かずに、「組み合わせノード」として、データで定義して配る形にできる。条件の語 (raid・revolt・morbid・threshold・delirium) は、`条件ノード` (そのターンの出来事・墓地の内訳) として足す。",
"e_sac_cost_other":"**生け贄のコスト**: `cost` に `sacrificeOther=型 count=N` を足す (自分で選んで、ほかのパーマネントを生け贄に捧げる)。選ぶ質問は、`playerRemoves` と同じ仕組みを使う。",
"e_x_cost":"**数式の X**: X を、`math` で計算して、各ノードに渡せるようにする (いまは X そのものだけ)。",
"e_evasion":"**回避・制限の部品**: `cantBeBlocked` (全体・特定の型にだけ)・`mustAttack`・`cantAttack` を、継続効果と、条件つきで足す。`cantBlock` は、すでにある。",
"e_token_copy":"**パーマネントのコピー**: `copyPermanent target=$t` (トークンとして、コピーを作る・自分をコピーにする)。コピーの対象の能力も、そのまま持つ。",
"e_play_exile":"**追放してプレイ**: `exilePlay` を広げる (土地もプレイできる・期限を指定できる・「このカードで追放したカード」を覚える)。墓地・ライブラリーの上から唱える効果も、同じ仕組みで書く。",
"kw_partner":"**統率戦の対戦**: 統率戦のデッキは、まだ対戦に使えません (コマンダーの扱い・コマンダー・タックスが要る)。ノードではなく、対戦の仕組みの仕事です。",
"e_choose_type":"**種類を選ぶ**: `chooseType kind=creatureType|cardType|basicLandType` を足す。選んだものは、`affect type=chosen` で使う (`chooseColor` と同じ形)。",
"trg_other":"**イベントの追加**: scry・surveil・cycle・copy・proliferate・investigate・explore などのイベントを足す。",
"e_extra_land":"**追加の土地**: `extraLand count=N` (そのターンに出せる土地の数を増やす)。",
"trg_lifegain":"**ライフのイベント**: `when event=lifegain / lifeloss` を足す (そのターンの量を読む `lifeGained`・`lifeLost` は、すでにある)。",
"kw_crew":"**乗り物**: `crew N` (タップして、そのターン、クリーチャーになる)。`becomes` (そのターンだけ) と `cost tapCreatures` の組み合わせで近づける。",
"kw_suspend":"**特殊な唱え方**: foretell・suspend・madness・echo などは、1 つずつ別の仕事 (出た数が少ない順に、あとで)。",
"e_ability_copy":"**能力のコピー**: `copyAbility` (スタックの能力をコピー)。",
"e_redirect":"**対象の変更**: `changeTarget target=$spell` を足す。",
"kw_enchant":"**オーラ**: `enchant 型` の宣言と、付ける対象を選ぶ唱え方 (いまは、出たときに付ける形だけ)。",
"kw_protection":"**プロテクション**: 対象にできない・ダメージを受けない・ブロックされない・付けられない、の4つの制限の組み合わせとして、`protection from=色/型` を足す。",
"e_tutor_top":"**探して上に置く**: `search` に `to=top` を足す。",
"e_no_hand_size":"**手札の上限**: `handSize N / none` を足す。",
"e_extra_turn":"**追加の戦闘**: `extraCombat`。",
"e_counters_remove":"**カウンターの取り除き・倍**: `removeCounter` (効果)・`doubleCounters`・`proliferate`。",
"kw_flashback":"**フラッシュバック・Escape**: 墓地から唱えて、解決したら追放する。`castFromGraveyard` に、`exileAfter` を足す。",
"e_flicker":"**追放して戻す**: `move` が、追放領域のカードを動かせるようにする (`exile` の出力を、あとで戻す)。",
"kw_transform":"**変身・両面**: 面の切り替え (カードの 2 つ目の面を持つ)。仕事が大きい。",
"kw_adventure":"**アドベンチャー・分割**: 部屋と同じ形で、半分を唱えられる仕組みを広げる。",
"e_saga":"**Saga・Class**: 章・レベルのカウンター。",
"e_return_own":"**自分で選んで手札に戻す**: `playerRemoves how=bounce` を足す (土地を戻す「バウンスランド」など)。",
"e_pay_life_x":"**X 点のライフの追加コスト**。",
"e_mana_land_type":"**土地が出せる色**: `addMana color=landColors` (コントロールする土地が出せる色のどれか)。",
"e_evasion2":"**特殊な回避**: shadow・landwalk など。",
"e_flash_perm":"**フラッシュを与える**: 唱えるタイミングを変える継続効果。",
"e_crew_stun":"**アンタップしない**: `doesntUntap` (継続効果)。",
}
out=[]
A=out.append
today=datetime.date.today().isoformat()
A("# 人気カードの効果と、ノードの対応状況")
A("")
A(f"> 自動で作った分析です ({today})。`scripts/node-gap-analysis/` で、もう一度作り直せます。「効果の分類」は、オラクルテキストを、文字のパターンで分けた、おおまかな見積もりです。数字は、目安として読んでください。")
A("")
A("## 目的")
A("")
A("人気のカードに採用されている効果のうち、いまのノード (104 個) で書けないものを洗い出して、**次に作るノードの優先順位**を決める。")
A("")
A("## 調べたカード")
A("")
A(f"Scryfall の人気順 (EDHREC の順位) で、統率戦・モダン・スタンダード・レガシーの上位から集めた、重複なしの **{n} 枚**。基本土地は除く。人気の順位は、統率戦の人気なので、**統率戦で好まれるカード (マナ加速・土地・除去・ドロー) に偏っています**。構築戦の人気は、別の資料 (MTGGoldfish など) が要ります。")
A("")
A("## 対応率")
A("")
A("- **書ける**: そのカードの効果が、すべて、いまのノードで書ける。")
A("- **ほぼ書ける**: 一部の効果が、簡単な形だけ書ける (「一部」を含む)。")
A("")
A("| 範囲 | 枚数 | 書ける | ほぼ書ける |")
A("|---|---|---|---|")
rows and [A(r) for r in rows]
A("")
A(f"効果の行は全部で {d['lines']} 行。パターンに当てはまらなかった行は {len(unk)} 行 ({len(unk)*100//max(1,d['lines'])}%)。")
A("")
A("## 次に作るノードの優先順位")
A("")
A("「**それだけで書けるようになるカード**」は、そのタグが、そのカードの、**唯一の足りない部分**であるときの枚数。多いほど、作る効果が大きい。")
A("")
A("| 順位 | 足りない効果 | 状態 | それだけで書ける | 出てくるカード | 提案 |")
A("|---|---|---|---|---|---|")
for i,(sole,tot,tid,label,st,note,solec,cs) in enumerate(gaps[:25],1):
    ex="、".join(c["name"] for c in sorted(solec,key=bestrank)[:4])
    A(f"| {i} | {label} | {'一部だけ' if st=='part' else '書けない'} | {sole} 枚 | {tot} 枚 ({ex}…) | {note} |")
A("")
A("## 順に作っていくと、書けるカードが、どれだけ増えるか")
A("")
A(f"いまは {len([c for c in cards if worst(c)==0])} 枚 ({len([c for c in cards if worst(c)==0])*100//n}%)。効果の大きい順に作ると:")
A("")
A("| 作る順 | 効果 | 増える枚数 | 合計 |")
A("|---|---|---|---|")
for i,(t,inc,tot) in enumerate(order,1):
    A(f"| {i} | {meta[t][1]} | +{inc} | {tot} 枚 ({tot*100//n}%) |")
A("")
A("## 提案する部品 (大きい順)")
A("")
for i,(sole,tot,tid,label,st,note,solec,cs) in enumerate(gaps[:20],1):
    A(f"### {i}. {label}")
    A("")
    A(f"- それだけで書けるようになる: **{sole} 枚** / 出てくる: {tot} 枚")
    A(f"- いまの状態: {note}")
    if tid in PROP: A(f"- 提案: {PROP[tid]}")
    A("- 例: "+"、".join(c["name"] for c in sorted(cs,key=bestrank)[:8]))
    A("")
A("## すでに書ける効果 (参考: 出てくる回数の多い順)")
A("")
oks=[(len(by_tag[t[0]]),t[1]) for t in T if t[3]=="ok" and by_tag[t[0]]]
for k,l in sorted(oks,reverse=True)[:15]: A(f"- {l}: {k} 枚")
A("")
A("## 注意")
A("")
A("- 効果の分類は、文字のパターンです。1 枚のカードが、実際には書けても「書けない」とされたり、その逆もあります。優先順位を決める目安として使い、作るときは、そのカードの実際のテキストで、確かめてください。")
A("- 「ほぼ書ける」の中には、「簡単な形なら書ける」ものも含みます。")
A("- 人気の順位は、統率戦の偏りがあります。構築戦 (モダン・レガシー・ヴィンテージ) の、実際のデッキリスト (MTGGoldfish・Melee など) を足すと、精度が上がります。")
A("- 分類できなかった行の例 (パターンの追加の手がかり):")
import random
random.seed(2)
for nm,l in random.sample(unk,min(15,len(unk))): A(f"  - {nm}: {l[:100]}")
open(sys.argv[3],"w").write("\n".join(out)+"\n")
print("ok",len(gaps),len(order))
