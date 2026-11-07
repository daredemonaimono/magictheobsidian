import json,time,urllib.request,urllib.parse,sys
H={"User-Agent":"MagicTheObsidian-analysis/0.1","Accept":"application/json"}
def get(url):
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url,headers=H),timeout=30))
        except Exception as e:
            time.sleep(1)
    raise SystemExit("fail "+url)
def top(q,pages):
    out=[]
    for p in range(1,pages+1):
        d=get("https://api.scryfall.com/cards/search?"+urllib.parse.urlencode({"q":q,"order":"edhrec","page":p}))
        out+=d["data"]
        if not d.get("has_more"): break
        time.sleep(0.12)
    return out
sets={"commander":("f:commander -t:basic",3),"modern":("f:modern -t:basic",2),"standard":("f:standard -t:basic",2),"legacy":("f:legacy -t:basic",2)}
cards={}
for fmt,(q,pg) in sets.items():
    for rank,c in enumerate(top(q,pg)):
        e=cards.setdefault(c["name"],{"name":c["name"],"type":c.get("type_line",""),"mana":c.get("mana_cost",""),"edhrec":c.get("edhrec_rank"),"keywords":c.get("keywords",[]),"layout":c.get("layout"),"text":"\n".join((f.get("oracle_text") or "") for f in (c.get("card_faces") or [c])) ,"formats":{}})
        e["formats"][fmt]=rank+1
json.dump(list(cards.values()),open(sys.argv[1],"w"),ensure_ascii=False)
print(len(cards))
