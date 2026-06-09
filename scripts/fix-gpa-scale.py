# gpaMin을 '원문 그대로의 값 + 만점기준(gpaScale)'으로 정정.
# - 평점(GPA) 기준 항목만 설정 → 만점 달라도 비율로 정확 비교.
# - 백분위(100점) 기준(국가장학금 80/70점)은 평점 환산이 부정확 → gpaMin 제거, 원문 안내만 유지(누락 방지).
import json, io

def load(p): return json.load(open(p, encoding="utf-8"))
def save(p, d): json.dump(d, io.open(p,"w",encoding="utf-8"), ensure_ascii=False, indent=2)

UNIV, NAT, FND = "data/university-scholarships.json", "data/national-scholarships.json", "data/foundation-scholarships.json"

# (gpaMin, gpaScale) — 출처 원문 그대로
UNIV_GPA = {
    "univ:korea:essor-a": (3.75, 4.5),       # 고려대 4.5 만점
    "univ:korea:essor-b": (3.5, 4.5),
    "univ:korea:pureundeungdae": (2.5, 4.5),
    "univ:korea:daehak-bongsa": (2.0, 4.5),
}
SOGANG_SCALE = 4.3  # 서강대는 4.3 만점

uni = load(UNIV); log=[]
for b in uni:
    if b["id"] in UNIV_GPA:
        g,s = UNIV_GPA[b["id"]]; b["gpaMin"], b["gpaScale"] = g, s; log.append((b["id"],g,s))
    elif b.get("university")=="서강대학교" and b.get("gpaMin")==2.0:
        b["gpaScale"]=SOGANG_SCALE; log.append((b["id"],2.0,SOGANG_SCALE))
save(UNIV, uni)

# 국가장학금: 백분위 기준 → gpaMin 제거(있으면)
nat = load(NAT)
for b in nat:
    if "gpaMin" in b: del b["gpaMin"]; log.append((b["id"],"제거(백분위)","-"))
    if "gpaScale" in b: del b["gpaScale"]
save(NAT, nat)

# 관정: 3.8 / 4.3 만점 (원문 그대로)
fnd = load(FND)
for b in fnd:
    if b["id"]=="fnd:ikef:undergrad":
        b["gpaMin"], b["gpaScale"] = 3.8, 4.3; log.append((b["id"],3.8,4.3))
    elif "gpaMin" in b:
        del b["gpaMin"]
        if "gpaScale" in b: del b["gpaScale"]
save(FND, fnd)

print("정정 결과:")
for r in log: print("  ", r)
