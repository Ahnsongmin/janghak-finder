# 고려대학교 교내장학금 추가 (공식 장학복지부 페이지에서 확인한 사실만).
# 출처: https://scholarship.korea.ac.kr  (성적/면학/특별/근로 분류 페이지)
# 서어서문학과 '전용' 장학금은 공식 공개정보에서 확인 불가 → 지어내지 않음.
# 아래 교내장학금은 학과 무관(서어서문학과 학생 포함 전체 재학생 대상).
import json, io

PATH = "data/university-scholarships.json"
SRC = "https://scholarship.korea.ac.kr/scholarship/guide/classfication.do"
UNIV = "고려대학교"
DATE = "2026-06-09"

def b(idx, name, desc, amount, applyUrl, raw, incomeNote=None, departments=None,
      eduStatus=None, requiredFlags=None):
    return {
        "id": f"univ:korea:{idx}",
        "name": name,
        "category": "장학금",
        "provider": UNIV,
        "sourceName": f"{UNIV}(교내)",
        "university": UNIV,
        "description": desc,
        "regions": ["전국"],
        "incomeMax": None,
        "incomeNote": incomeNote,
        "ageMin": None,
        "ageMax": None,
        "eduStatus": eduStatus or ["대학생(재학)"],
        "grades": [],
        "requiredFlags": requiredFlags or [],
        "targetGroups": [],
        "departments": departments or [],
        "amount": amount,
        "applyUrl": applyUrl,
        "rawConditionText": raw,
        "lastFetchedAt": DATE,
    }

S = "https://scholarship.korea.ac.kr/scholarship/item01_02.do"      # 성적
M = "https://scholarship.korea.ac.kr/scholarship/item02_03.do"      # 면학
SP = "https://scholarship.korea.ac.kr/scholarship/item04_01.do"     # 특별
W = "https://scholarship.korea.ac.kr/scholarship/item03_01.do"      # 근로

new = [
    b("seongjeok", "성적우수장학금",
      "직전학기 성적 우수자에게 소속 대학(부)장 추천으로 지급하는 교내 성적장학금.",
      "수업료 전액·50%·30%", S,
      "[자격] 선발학기의 직전학기 성적 기준, 소속 대학(부)장의 추천을 받은 자. (출처: 고려대 장학복지부 성적장학금 안내)"),
    b("essor-a", "Essor 장학금 A",
      "성적경고 해제 후 성적을 끌어올린 학생 대상 교내 성적장학금(상위 기준).",
      "수업료 100만원", S,
      "[자격] 성적경고 해제된 학기의 취득학점 12학점 이상, 평점평균 3.75 이상."),
    b("essor-b", "Essor 장학금 B",
      "성적경고 해제 후 성적을 끌어올린 학생 대상 교내 성적장학금.",
      "수업료 50만원", S,
      "[자격] 성적경고 해제된 학기의 취득학점 12학점 이상, 평점평균 3.5 이상."),
    b("gukga-usu", "국가우수장학금(교내 연계)",
      "입학성적 또는 직전학기 성적 우수자 대상, 수업료 전액(입학금 포함) 지급.",
      "수업료 전액(입학금 포함)", S,
      "[자격] 입학성적 또는 직전학기 성적 등(상세 내역은 장학복지부 공지 참조). 신입생 포함 가능.",
      eduStatus=["신입생/예비대학생", "대학생(재학)"]),
    b("pureundeungdae", "푸른등대 장학금(면학)",
      "가계곤란 학생의 학업보조비를 지원하는 면학장학금(기부 재단 연계).",
      "기부자별 상이", M,
      "[자격] 직전학기 평점평균 2.5(백분율 80점) 이상, 취득학점 12학점 이상 / 가계곤란·학업보조. 금액·기간은 재단별 상이.",
      incomeNote="가계곤란(소득 심사)"),
    b("geunro", "근로장학금",
      "교내 부서·기관에서 근로하고 장학금을 받는 교내 근로장학.",
      "근로시간별 소정금액", W,
      "[자격] 교내 근로장학 참여 학생. 모집·배정은 장학복지부 및 각 부서 공고 확인."),
    b("daehak-bongsa", "대학봉사장학금(특별)",
      "총학생회 등 학생자치활동조직에서 근로봉사를 제공하는 학생 대상 특별장학금.",
      "소정금액", SP,
      "[자격] 총학생회 등 학생자치활동조직에서 근로봉사 제공, 직전학기 평균평점 2.0 이상."),
    b("daehak-leader", "대학리더장학금(특별)",
      "단과대학 학생회 봉사자 등 학장(학부장) 추천 학생 대상 특별장학금.",
      "70만원", SP,
      "[자격] 학장(학부장)의 추천을 받은 단과대학 학생회 봉사자 또는 학생."),
    b("seonsu", "우수학생 선수장학금(특별)",
      "체육특기자전형 입학자 또는 학생선수 중 체육위원장 추천자 대상 특별장학금.",
      "신입생 수업료 전액(입학금 포함)·재학생 수업료 90% 또는 50%", SP,
      "[자격] 체육특기자전형 입학자 또는 학생선수 중 체육위원장이 추천하는 자."),
]

data = json.load(open(PATH, encoding="utf-8"))
existing = {x["id"] for x in data}
added = [x for x in new if x["id"] not in existing]
data.extend(added)
with io.open(PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print(f"추가 {len(added)}건, 총 {len(data)}건")
for x in added:
    print(" +", x["name"])
