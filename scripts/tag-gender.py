# kosaf-scholarships.json에 성별 전용 태그(genderOnly) 부착.
# 명확한 '여성 전용' 표현만 태깅(누락/오탐 방지). 남성 전용은 실데이터에 사실상 없어 태깅 안 함.
# 주의: build-kosaf-scholarships.py 재실행 시에도 같은 로직을 타도록 그쪽에도 반영해 둔다.
import json, io, re, sys

PATH = "data/kosaf-scholarships.json"

# 여성 전용으로 볼 수 있는 명확한 신호만. '여성가족부/여성청소년/남녀' 등 일반 언급은 제외.
FEMALE = re.compile(
    r"여학생|여대생|여성\s*지도자|미혼\s*여성|여성\s*과학|여성\s*기술인|"
    r"여성에\s*한|여성으로\s*한정|여성\s*대상|여자\s*대학생|한국여학사"
)
# 오탐 방지용 — 이 표현이 있으면 여성 전용으로 보지 않음
EXCLUDE = re.compile(r"여성가족부|여성청소년|남녀\s*(무관|모두|구분\s*없)")

def tag():
    d = json.load(open(PATH, encoding="utf-8"))
    n = 0
    for b in d:
        blob = f"{b.get('name','')} {b.get('description','')} {b.get('rawConditionText','')}"
        if EXCLUDE.search(blob):
            continue
        if FEMALE.search(blob):
            b["genderOnly"] = "여성"
            n += 1
    json.dump(d, io.open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"여성 전용 태그: {n}건")
    for b in d:
        if b.get("genderOnly"):
            print("  ", b["name"][:40])

tag()
