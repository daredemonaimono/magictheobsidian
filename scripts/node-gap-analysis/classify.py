import json,re,collections,sys
cards=json.load(open(sys.argv[1]))
# (id, 日本語名, 正規表現, 状態, 説明) 状態: ok=書ける / part=一部だけ書ける / no=書けない
T=[
# --- キーワード (1 行がキーワードだけのもの)
("kw_basic","基本のキーワード (飛行・先制攻撃・速攻など)",r"^(flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance|flash|defender|prowess)\b","ok","keyword"),
("kw_ward","護法",r"^ward\b","ok","ward"),
("kw_cycling","サイクリング",r"\bcycling\b|\btypecycling\b|\blandcycling\b","ok","cost discardSelf"),
("kw_kicker","キッカー",r"\bkicker\b|\bmultikicker\b","ok","additionalCost kicked (multikicker は 1 回だけ)"),
("kw_equip","装備",r"^equip\b","ok","起動型能力 + attach"),
("kw_enchant","オーラ (enchant ...)",r"^enchant (creature|permanent|land|artifact|player|nonbasic|enchantment)","part","attach (出たとき付ける)"),
("kw_delve","Delve",r"^delve\b","ok","delve"),
("kw_evoke","Evoke",r"^evoke\b","ok","altCost + 出たとき if=alt"),
("kw_protection","プロテクション",r"protection from|\bprotection\b","no","無い (対象・ダメージ・ブロックを防ぐ)"),
("kw_flashback","フラッシュバック",r"^flashback\b","no","唱えたあと追放する仕組みが無い (castFromGraveyard は唱えるだけ)"),
("kw_escape","Escape",r"^escape\b","no","墓地から唱えて追放を払うコストが無い"),
("kw_persist","Undying / Persist",r"^(undying|persist)\b","no","戻ってくるときカウンターを置く仕組みが無い (書けば近い)"),
("kw_cascade","Cascade",r"^cascade\b","no","ライブラリーを上から追放して唱える仕組みが無い"),
("kw_convoke","Convoke / Affinity / Improvise",r"^(convoke|affinity|improvise)\b","no","コストの代わりにタップ・数える軽減が無い"),
("kw_morph","Morph / Disguise / Manifest",r"\b(morph|megamorph|disguise|manifest)\b","no","裏向きの仕組みが無い"),
("kw_suspend","Suspend / Foretell / Madness / Echo ほか特殊な唱え方",r"^(suspend|foretell|madness|echo|cumulative upkeep|fading|vanishing|rebound|buyback|replicate|casualty|bestow|dash|emerge|ninjutsu|unearth|encore|prototype|mutate|overload|spectacle|miracle|splice|retrace|jump-start|aftermath|entwine|escalate|conspire|cleave|surge|undaunted|riot|blitz)\b","no","特殊な唱え方・維持の仕組みが無い"),
("kw_transform","変身・両面カード (daybound など)",r"\btransform\b|\bdaybound\b|\bnightbound\b|\bmeld\b|\bdisturb\b","no","変身の仕組みが無い"),
("kw_adventure","アドベンチャー / 分割カード",r"\badventure\b|\bsplit second\b|\baftermath\b","no","別の半分を唱える仕組みが無い (部屋だけ対応)"),
("kw_partner","Partner / コマンダー関連",r"\bpartner\b|\bcommander\b|\bcompanion\b|\bbackground\b|\bchoose a background\b","no","統率戦は、対戦に使えない"),
# --- 常在・誘発の条件
("trg_etb","出たとき誘発",r"\bwhen(ever)? (~|this creature|this permanent|this artifact|this enchantment|another|a|an|one or more|you|each)[^.]*\benters?\b|\bwhen ~ enters\b","ok","when event=enters"),
("trg_dies","死亡・離れたとき誘発",r"\bdies\b|leaves the battlefield|put into a graveyard from","ok","when event=leaves"),
("trg_attack","攻撃したとき誘発",r"\bwhenever .* attacks?\b|\bwhenever you attack\b|\bwhen .* attacks\b","ok","when event=attacks (first/once)"),
("trg_block","ブロックしたとき",r"\bblocks?\b|\bbecomes blocked\b","part","when event=blocks (ブロックされたときは無い)"),
("trg_dmg","ダメージを与えたとき誘発",r"\bwhenever .* deals? (combat )?damage\b|\bwhen .* deals (combat )?damage","ok","when event=damaged"),
("trg_cast","唱えたとき誘発",r"\bwhenever (you|a player|an opponent|each opponent) casts?\b|\bwhen you cast\b","ok","when event=cast"),
("trg_step","ステップの開始時誘発",r"\bat the beginning of\b","ok","when event=step"),
("trg_draw","引いたとき誘発",r"\bwhenever (you|a player|an opponent|each opponent) draws?\b","ok","when event=drew"),
("trg_landfall","土地が出たとき (landfall)",r"\blandfall\b|\bwhenever a land enters\b|\bwhenever .* land .* enters\b","ok","when event=enters type=land"),
("trg_target","対象になったとき",r"\bbecomes? the target\b","ok","when event=targeted"),
("trg_lifegain","ライフを得たとき・失ったとき誘発",r"\bwhenever you gain life\b|\bwhenever .* (gains?|loses?) life\b|\bwhenever you lose life\b","no","ライフ増減のイベントが無い (このターンの量を読むだけ)"),
("trg_counter","カウンターが置かれたとき誘発",r"\bwhenever .* counters? (is|are) (put|placed)\b|\bwhenever you put\b","no","カウンターのイベントが無い"),
("trg_sacrifice","生け贄に捧げたとき誘発",r"\bwhenever you sacrifice\b|\bwhenever .* is sacrificed\b|\bsacrifices? (a|another)\b.*\bwhenever\b","no","生け贄のイベントが無い"),
("trg_token","トークンを作ったとき誘発",r"\bwhenever you create\b|\bwhenever one or more tokens\b","no","トークン作成のイベントが無い"),
("trg_other","ほかの誘発イベント (scry・tap・cycle・copy・proliferate など)",r"\bwhenever you (scry|surveil|tap|untap|cycle|copy|proliferate|investigate|explore|connive|play|put|return|exile|reveal|activate|turn|mill|discard)\b|\bwhenever .* (is|are) (tapped|untapped|exiled|returned|turned|created)\b|\bwhenever you (cast or copy)\b|\bmagecraft\b","part","discard(手札→墓地)は書ける。それ以外はイベントが無い"),
# --- 効果
("e_draw","カードを引く",r"\bdraws? (a|an|one|two|three|four|\d+|x|that many|cards)\b|\bdraw (a|two|three|x|\d+) cards?\b|\bdraw a card\b","ok","draw"),
("e_discard","捨てる",r"\bdiscards?\b","ok","discard"),
("e_mill","切削",r"\bmills?\b|\bmill\b","ok","mill"),
("e_scry","占術・諜報",r"\b(scry|surveil)\b","ok","look + choose + move"),
("e_look_top","ライブラリーの上を見る",r"look at the top|reveal the top|\bexile the top\b","ok","look + choose + move / exilePlay"),
("e_search","ライブラリーから探す",r"\bsearch your library\b|\bsearches? their library\b|\bsearch .* library\b","ok","search (戦場・手札へ。上に置くは無い)"),
("e_tutor_top","探して一番上に置く",r"search .* put (it|that card|them) (on top|into your library)","no","search に to=top が無い"),
("e_shuffle","切る",r"\bshuffle\b","ok","shuffle"),
("e_destroy","破壊",r"\bdestroys?\b","ok","destroy / select"),
("e_exile","追放",r"\bexiles?\b","ok","exile / move to=exile"),
("e_flicker","追放して戻す (フリッカー)",r"exile (target|another|up to|it|that|this)[^.]*\.? ?(then )?return|exile .* then return .* to the battlefield","no","追放領域のカードを戻す node が無い"),
("e_bounce","手札に戻す",r"return (target|another|up to|each|all|that|it)[^.]* to (its|their) owner'?s? hand|return (target|another)[^.]* to your hand|\bbounce\b","ok","bounce / move to=hand"),
("e_reanimate","墓地から戻す",r"return (target|another|up to|all|that|it|a)[^.]* (card )?from (your|a|an|that|their|any) graveyard","ok","target zone=graveyard + move"),
("e_sac_self","自身を生け贄に捧げる",r"sacrifice ~","ok","cost sacrifice=true"),
("e_sac_forced","相手に生け贄に捧げさせる",r"(target player|target opponent|each opponent|each player|that player|defending player|an opponent) sacrifices","ok","playerRemoves how=sacrifice"),
("e_sac_cost_other","ほかのものを生け贄に捧げるコスト・効果",r"\bsacrifice (another|a|an|two|three|x|\d+|any number)\b|\bsacrifice (a|an) (creature|artifact|land|permanent|food|treasure|clue)","ok","cost sacrificeOther=型"),
("e_damage","ダメージ",r"\bdeals? (\d+|x|that much|damage equal|twice|double)\b|\bdeals? damage\b","ok","damage (数が決まらないときは statOf・countCards と)"),
("e_counterspell","呪文を打ち消す",r"\bcounter target (spell|noncreature|creature|instant|sorcery|activated|triggered)","ok","counter (能力の打ち消しは無い)"),
("e_counter_ability","能力を打ち消す",r"counter target (activated|triggered|ability)|counter target .* ability","no","能力の打ち消しが無い"),
("e_lifegain","ライフを得る",r"\bgains? (\d+|x|that much|life equal)|\bgain (\d+|x) life\b","ok","gainLife"),
("e_lifeloss","ライフを失う",r"\bloses? (\d+|x|that much|life equal)|\blose (\d+|x) life\b","ok","loseLife"),
("e_token","トークンを作る",r"\bcreates? (a|an|one|two|three|four|\d+|x|that many|twice)[^.]*\btokens?\b","ok","createToken (名前・型・P/T・色)"),
("e_token_ability","能力つきのトークン (飛行など・Treasure・Food・Clue)",r"\btokens? (with|that has|that have)\b|\b(treasure|food|clue|blood|map|powerstone|junk|gold)\b.* token|\binvestigate\b|\btoken\b.*\"","ok","createToken keywords= / predefined=treasure|food|clue|blood (引用符の中に能力を書くトークンは、まだ)"),
("e_token_copy","コピーのトークン・パーマネントのコピー",r"\bcopy of\b|\bthat's a copy\b|becomes a copy|\bclone\b|\bcreate a token that's a copy","ok","copyPermanent"),
("e_counters","カウンターを置く",r"\bput (a|an|one|two|three|x|\d+|that many|another)[^.]* counters?\b|\bwith (a|an|two|three|\d+|x)[^.]* counters? on it\b","ok","addCounter / entersWith"),
("e_proliferate","Proliferate",r"\bproliferate\b","no","カウンターを増やす node が無い"),
("e_counters_remove","カウンターを取り除く・倍にする",r"remove (a|an|one|all|x|\d+)[^.]* counters?|double the number of","part","cost removeCounter だけ (効果で取り除く node が無い)"),
("e_pump","+N/+N の修整",r"\bgets? [+-]\d+/[+-]\d+\b|\bget [+-]\d+/[+-]\d+\b|\bgets? [+-]x/[+-]x\b","ok","modify / staticModify"),
("e_pump_dynamic","数で変わる修整 (「〜1つにつき +1/+1」)",r"\bfor each\b|\bequal to the number of\b|\bwhere x is\b","ok","countCards (色・トークン・墓地・手札・追放) / lifeTotal / staticModify perZone"),
("e_anthem","常在の強化 (全体強化)",r"\b(creatures|other creatures|each creature) you control (get|have)\b|\bother [a-z]+s? you control get\b|\ball creatures get\b","ok","affect + staticModify / staticGrant (「ほかの」「種族」は、type で絞る。「ほかの」だけ不可)"),
("e_grant_kw","キーワードを与える",r"\bgains? (flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance|defender|prowess)\b|\bhave (flying|first strike|haste|vigilance|lifelink|deathtouch|trample|menace|reach)","ok","grant / staticGrant"),
("e_tap_untap","タップ・アンタップ",r"\b(taps?|untaps?)\b","ok","tap / untap"),
("e_mana","マナを加える",r"\badd \{|\badds? (one|two|three|x|\d+)[^.]* mana\b|\badd (one|two|three) mana","ok","addMana"),
("e_mana_any","好きな色のマナ",r"mana of any color|one mana of any|any color","ok","addMana color=any"),
("e_mana_land_type","「土地が出せる色・相手の土地が出せる色のマナ」",r"any type that a land|any color that a|color of mana (that )?(a|an) .* (land|permanent) (you control )?could produce|mana of any type","no","「コントロールする土地が出せる色」を読む仕組みが無い"),
("e_extra_land","追加の土地を出せる",r"play an additional land|additional land|play lands from","no","土地を出せる回数を増やす仕組みが無い"),
("e_extra_turn","追加ターン・追加の戦闘",r"\bextra turn\b|\badditional combat\b|\bextra combat\b","part","追加のターンだけ。追加の戦闘は無い"),
("e_gain_control","コントロールを奪う",r"\bgain control\b|\bgains? control\b","no","コントロールを交換するだけ (奪うは無い)"),
("e_fight","格闘",r"\bfights?\b","no","fight が無い"),
("e_prevent","ダメージの軽減・防止",r"\bprevent\b|\bprevention\b|\bredirect","no","軽減・防止が無い"),
("e_evasion","ブロックされない・攻撃できない",r"can't be blocked|can't attack|can't block|must attack|attacks each combat|can't be countered|can't be the target|can't lose|can't win","part","cantBlock・cantBeBlocked・cantAttack・mustAttack。「打ち消されない」「負けない」などは、まだ"),
("e_copy_spell","呪文のコピー",r"\bcopy (target|that|it|this)? ?(instant|sorcery|spell)\b|\bcopy target\b|\bcopy that spell\b","ok","copySpell"),
("e_ability_copy","能力のコピー・誘発を増やす",r"\bcopy (target )?(activated|triggered) ability\b|triggers an additional time|trigger an additional","part","extraTriggers (誘発を増やす) だけ"),
("e_cost_reduce","コスト軽減",r"cost \{?[0-9x]?\}? ?less to cast|costs? \{\d\} less|cost[s]? less","ok","reduceCost"),
("e_cost_increase","コスト増加 (税)",r"costs? \{[0-9x]\}? more|cost[s]? (an additional|more) ","no","唱えるコストを増やす仕組みが無い (upkeepTax・castLimit だけ)"),
("e_restrict_cast","唱えられない・起動できない",r"can't cast|can't activate|players can't|your opponents can't|can't be activated","ok","cantCast / cantActivate"),
("e_enter_tapped","タップ状態で出る",r"enters (the battlefield )?tapped|enter tapped","ok","entersTapped"),
("e_enter_counters","カウンターを置いて出る",r"enters (the battlefield )?with","ok","entersWith"),
("e_graveyard_hate","墓地に行くかわりに追放",r"exile (it|that card|them) instead|if a (card|creature|permanent) would be put into a graveyard","ok","exileInstead"),
("e_replace_other","そのほかの置換効果 (もし〜なら かわりに)",r"\bif .* would\b|\binstead\b","part","modifyAmount (トークン・カウンター・ダメージ・ライフ・引く枚数の倍化) と exileInstead・entersWith。ほかの「かわりに」は、まだ"),
("e_modes","モード (以下から選ぶ)",r"choose (one|two|up to one|one or both|one or more)\b|^• ","ok","modes"),
("e_choose_color","色を選ぶ",r"choose a color|choose (white|blue|black|red|green)","ok","chooseColor"),
("e_choose_type","「クリーチャー・タイプ」「カード名」などを選ぶ",r"choose a creature type|choose a card type|choose a basic land type|choose a card name|name a card|choose a number|choose (a|an) (land|card|artifact)? ?type","no","色だけ選べる (chooseColor)"),
("e_x_cost","X を選ぶ呪文・能力",r"\bx\b[^a-z]*(\{|$)|\{x\}|where x is|x is","part","X は選べる。数式の X は、限られる"),
("e_loyalty","プレインズウォーカーの忠誠度能力",r"^[+−-]\d+:|^[+−−]x:|^0:","ok","cost loyalty"),
("e_aura_equip_attach","付ける・外す",r"\battach\b|\bunattach\b","ok","attach"),
("e_regen","再生",r"\bregenerate\b","ok","regenerate"),
("e_become","〜になる (クリーチャー化・型の変更)",r"\bbecomes? (a|an|the)\b|\bis a\b.*\bin addition\b|\bis (a|an) .* creature","ok","becomes / setTypes"),
("e_look_hand","手札を見る・公開させる",r"\blook at (target|an|each|that)[^.]* hand\b|look at target player's hand|\blook at (target|an) opponent's hand\b|\breveals? (their|his or her|your) hand\b|\bchoose .* from it\b|\bopponent reveals\b","ok","lookHand"),
("e_play_exile","追放したカードをプレイしてよい",r"you may (play|cast) (it|that card|those cards|them)|may play lands from|cast .* from (exile|your graveyard|the top)|play (it|them) this turn","part","exilePlay / castFromGraveyard (墓地・追放から唱える一部)"),
("e_monarch","Monarch・Initiative・エネルギー・毒・経験・投票・日夜",r"\bmonarch\b|\binitiative\b|\benergy\b|\bpoison\b|\binfect\b|\btoxic\b|\bexperience counter\b|\bvote\b|\bday\b.*\bnight\b|\bdungeon\b|\bring-bearer\b|\bthe ring\b","no","仕組みが無い"),
("e_gy_scry_misc","土地・パーマネントのタップを要求・アンタップしない",r"doesn't untap|don't untap|skip your|skip (the|your|their)","part","untapDuring の逆 (アンタップしない) は stun だけ"),
("e_saga","Saga・Class・Case・Role など",r"\bsaga\b|\bclass\b|\bcase\b|\brole\b|\blevel up\b|\bsolve\b","no","章・レベルの仕組みが無い"),
("e_creature_type_lord","種族の強化 (Elf・Goblin など)",r"\b(elves|goblins|zombies|vampires|merfolk|soldiers|humans|dragons|angels|wizards|spirits|slivers|knights|warriors|rogues|clerics|beasts|birds|cats|dinosaurs|demons|pirates|artifacts) you control\b","ok","affect type=..."),
("e_types","土地・パーマネントの型や色を変える",r"\bis (a|an) .* (land|artifact|creature) in addition\b|all lands are|lands you control are|\bbecomes? (red|blue|green|black|white)\b","ok","setTypes / setColors / staticAddType"),
("e_equipped_has","装備・オーラが与える修整・能力",r"equipped creature (gets|has)|enchanted (creature|permanent|land) (gets|has)|equipped creature and","ok","affect who=attached + staticModify / staticGrant"),
("e_no_hand_size","手札の上限の変更",r"no maximum hand size|maximum hand size","no","手札の上限を変える仕組みが無い"),
("e_kw_action","そのほかのキーワード処理 (extort・evolve・explore・amass・connive・bolster・adapt など)",r"\b(extort|evolve|exploit|fabricate|bolster|support|adapt|amass|connive|explore|incubate|learn|populate|detain|goad|living weapon|mentor|training|afterlife|annihilator|battle cry|bushido|flanking|rampage|soulbond|mayhem|offspring|squad|gift|spree|tiered|impending|bargain|backup|craft|plot|saddle|solve|collect evidence|discover|renown|unleash|undaunted|ravenous|hideaway|ascend|boast|descend|disturb|domain|enlist|toxic|cloak|manifest dread|seek|valiant|alliance|constellation|eerie|raid|revolt|threshold|delirium|metalcraft|morbid|formidable|ferocious|coven|spectacle|riot)\b","part","explore・amass・connive・bolster・investigate (Clue)・turnStat (raid・morbid)・graveyardTypes (delirium)。ほかのキーワード処理は、まだ"),
("kw_crew","Crew・Saddle・Station (乗り物)",r"^crew\b|\bcrew \d|\bsaddle \d|\bstation\b|\bvehicle\b","no","乗り物 (タップして、クリーチャーになる) の仕組みが無い"),
("kw_warp_speed","Warp・速度",r"^warp\b|start your engines|max speed","ok","altCost + exilePlay / startEngines"),
("e_flash_perm","「フラッシュを持つかのように唱えてよい」",r"as though (it|they) had flash|cast .* as though .* had flash","no","唱えるタイミングを変える効果が無い"),
("e_redirect","対象の変更",r"change the target|choose new targets|redirect","no","対象を変える node が無い"),
("e_put_battlefield","戦場に出す",r"\bput (target|a|an|up to|all|that|it|those)[^.]* onto the battlefield\b|\breturn (it|that card|them) to the battlefield\b","ok","move to=battlefield"),
("e_put_top","ライブラリーの上・下に置く",r"on top of (your|their|its owner's) library|on the bottom of","ok","move to=top / bottom"),
("e_crew_stun","「アンタップしない」",r"doesn't untap|don't untap","part","stun カウンターだけ"),
("kw_storm","Storm",r"^storm\b","ok","storm"),
("e_evasion2","特殊な回避 (shadow・fear・landwalk など)",r"^(shadow|fear|intimidate|skulk|horsemanship|[a-z]+walk)\b","no","特殊な回避が無い (飛行・威嚇・ブロックできないだけ)"),
("e_opening","開始時に戦場に出す",r"opening hand","ok","startOnBattlefield"),
("e_return_own","自分のパーマネントを 1 つ選んで手札に戻す",r"return (a|an|another) [a-z ]+ you control to (its|their) owner's hand","ok","playerRemoves how=bounce"),
("e_pay_life_x","X 点のライフを払う追加コスト",r"pay x life|pay x\b","part","additionalCost に X のライフが無い"),
("e_activated_generic","起動型能力 (コスト: 効果)",r"^[^.:]*\{[^}]+\}[^.:]*:|^\{t\}[^:]*:|^[^:]{1,60}, (sacrifice|discard|pay|exile|tap|remove)[^:]*:","ok","cost + 効果のノード"),
]
def norm(card):
    t=card["text"]
    nm=card["name"]; short=nm.split(",")[0].split(" // ")[0]
    for n in sorted({nm,short,nm.split(" // ")[0]},key=len,reverse=True):
        if n: t=t.replace(n,"~")
    t=re.sub(r"\([^)]*\)","",t)  # 注釈文
    return [l.strip().lower() for l in t.split("\n") if l.strip()]
STATUS_RANK={"ok":0,"part":1,"no":2}
res=[]
unk=collections.Counter(); unk_lines=[]
tag_cards=collections.defaultdict(list)
lines_total=0; lines_unknown=0
for c in cards:
    tags=set()
    for line in norm(c):
        lines_total+=1
        hit=False
        for tid,label,rx,st,note in T:
            if re.search(rx,line):
                tags.add(tid); hit=True
        if not hit:
            lines_unknown+=1
            unk_lines.append((c["name"],line))
    c["tags"]=sorted(tags)
    for t in tags: tag_cards[t].append(c["name"])
meta={t[0]:t for t in T}
def worst(tags):
    r=0
    for t in tags:
        r=max(r,STATUS_RANK[meta[t][3]])
    return r
full=sum(1 for c in cards if worst(c["tags"])==0)
lenient=sum(1 for c in cards if worst(c["tags"])<=1)
print("cards",len(cards),"lines",lines_total,"unknown lines",lines_unknown)
print("fully ok",full,"ok/part",lenient)
json.dump({"cards":cards,"unknown":unk_lines,"lines":lines_total},open(sys.argv[2],"w"),ensure_ascii=False)
# blockers
rows=[]
for tid,label,rx,st,note in T:
    if st=="ok": continue
    n=len(tag_cards[tid])
    sole=sum(1 for c in cards if tid in c["tags"] and all(meta[t][3]=="ok" or t==tid for t in c["tags"]))
    rows.append((n,sole,tid,label,st))
for r in sorted(rows,reverse=True)[:25]: print(r)
print("--- unknown samples")
import random
random.seed(1)
for n,l in random.sample(unk_lines,25): print(n,"|",l[:110])
