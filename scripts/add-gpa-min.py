# 각 장학금에 요구 최소평점(gpaMin, 4.5 만점 기준)을 출처 사실 기반으로 입력.
# - 출처에 평점 기준이 명시된 항목만 설정. 없으면 건드리지 않음(성적 무관 유지 → 누락 방지).
# - 100점/4.3만점 기준은 보수적으로 4.5 기준 환산(원문은 rawConditionText에 그대로 보존).
import json, io, re

def load(p): return json.load(open(p, encoding="utf-8"))
def save(p, d): json.dump(d, io.open(p,"w",encoding="utf-8"), ensure_ascii=False, indent=2)

UNIV = "data/university-scholarships.json"
NAT  = "data/national-scholarships.json"
FND  = "data/foundation-scholarships.json"

# 고려대: 출처에 명시된 평점(고려대 4.5 만점)
KOREA = {
    "univ:korea:essor-a": 3.75,        # 평점평균 3.75 이상
    "univ:korea:essor-b": 3.5,         # 평점평균 3.5 이상
    "univ:korea:pureundeungdae": 2.5,  # 푸른등대(면학) 평점평균 2.5 이상
    "univ:korea:daehak-bongsa": 2.0,   # 대학봉사 평균평점 2.0 이상
}

uni = load(UNIV); set_log=[]
for b in uni:
    if b["id"] in KOREA:
        b["gpaMin"] = KOREA[b["id"]]; set_log.append((b["id"], KOREA[b["id"]]))
    elif b.get("university") == "서강대학교" and re.search(r"평점(평균)?\s*2\.0", b.get("rawConditionText","")):
        # 서강대(4.3 만점) 가계곤란류 '평점 2.0 이상' → 낮은 기준이라 4.5 기준 2.0 유지(보수적)
        b["gpaMin"] = 2.0; set_log.append((b["id"], 2.0))
save(UNIV, uni)

# 한국장학재단 국가장학금: 100점 기준 → 4.5 보수 환산
NAT_GPA = {
    "nat:kosaf:type1": 3.0,  # 80점(B0) → 4.5기준 약 3.0
    "nat:kosaf:type2": 3.0,  # 통상 80점
    "nat:kosaf:work": 2.0,   # 70점(C0) → 약 2.0
    # 다자녀(완화 기준 존재)·푸른등대·이공계(최우수, 기준 상이)는 미설정 → 누락 방지
}
nat = load(NAT)
for b in nat:
    if b["id"] in NAT_GPA:
        b["gpaMin"] = NAT_GPA[b["id"]]; set_log.append((b["id"], NAT_GPA[b["id"]]))
save(NAT, nat)

# 민간재단: 관정 3.8/4.3 → 보수적으로 3.8 유지(4.5기준 3.8이면 통과시켜 누락 방지)
fnd = load(FND)
for b in fnd:
    if b["id"] == "fnd:ikef:undergrad":
        b["gpaMin"] = 3.8; set_log.append((b["id"], 3.8))
    # 현대차정몽구(백분위 90)는 환산 위험 커서 미설정 + 원문 안내 유지
save(FND, fnd)

print(f"gpaMin 설정 {len(set_log)}건:")
for i,g in set_log: print(f"  {i} = {g}")
