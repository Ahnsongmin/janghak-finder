# 한국장학재단 '학자금지원정보(대학생)' 공공데이터 CSV → 앱 Benefit 스키마(JSON) 정규화.
# 출처: data.go.kr 15028252 (지자체·민간재단·대학·공공기관 장학금 1,800여 건 종합).
# 원칙: 값은 CSV 원문 팩트만. 환산이 부정확한 항목(소득·성적 정밀구간)은 incomeNote/rawText로 보존하고
#       구조화 매칭은 명확한 것(지역·계열·대학생 여부)만. 누락 방지를 위해 애매하면 '전국/무관'.
import csv, json, io, re, sys
from datetime import date

SRC = "data/_raw_kosaf_univ.csv"
OUT = "data/kosaf-scholarships.json"

# 시도 표기(lib/options.ts SIDO와 일치)
SIDO_FULL = [
    "서울특별시","부산광역시","대구광역시","인천광역시","광주광역시","대전광역시",
    "울산광역시","세종특별자치시","경기도","강원특별자치도","충청북도","충청남도",
    "전북특별자치도","전라남도","경상북도","경상남도","제주특별자치도",
]
# 약칭 → 풀네임 (기관명에서 추출용). 풀네임을 먼저 검사하므로 광역/도 혼동 최소화.
# '광주'는 경기 광주시와 광역시가 모호 → 약칭에서 제외(풀네임/시군구로만 판별).
SIDO_ABBR = {
    "서울":"서울특별시","부산":"부산광역시","대구":"대구광역시","인천":"인천광역시",
    "대전":"대전광역시","울산":"울산광역시","세종":"세종특별자치시",
    "경기":"경기도","강원":"강원특별자치도","충북":"충청북도","충남":"충청남도",
    "전북":"전북특별자치도","전남":"전라남도","경북":"경상북도","경남":"경상남도","제주":"제주특별자치도",
}

# 시군구명 → 시도 (행정구역 사실). 기관명에 시군구만 있는 지역장학회 매칭용.
# 모호한 이름(고성=강원·경남, 광주=경기·광역시)은 의도적으로 제외.
SGG_TO_SIDO = {}
def _reg(sido, names):
    for n in names: SGG_TO_SIDO[n] = sido
_reg("경기도", ["수원","성남","고양","용인","부천","안산","안양","남양주","화성","평택","의정부","시흥","파주","김포","광명","군포","오산","이천","양주","안성","구리","포천","의왕","하남","여주","동두천","과천","가평","양평","연천"])
_reg("강원특별자치도", ["춘천","원주","강릉","동해","태백","속초","삼척","홍천","횡성","영월","평창","정선","철원","화천","양구","인제","양양"])
_reg("충청북도", ["청주","충주","제천","보은","옥천","영동","증평","진천","괴산","음성","단양"])
_reg("충청남도", ["천안","공주","보령","아산","서산","논산","계룡","당진","금산","부여","서천","청양","홍성","예산","태안"])
_reg("전북특별자치도", ["전주","군산","익산","정읍","남원","김제","완주","진안","무주","장수","임실","순창","고창","부안"])
_reg("전라남도", ["목포","여수","순천","나주","광양","담양","곡성","구례","고흥","보성","화순","장흥","강진","해남","영암","무안","함평","영광","장성","완도","진도","신안"])
_reg("경상북도", ["포항","경주","김천","안동","구미","영주","영천","상주","문경","경산","군위","의성","청송","영양","영덕","청도","고령","성주","칠곡","예천","봉화","울진","울릉"])
_reg("경상남도", ["창원","진주","통영","사천","김해","밀양","거제","양산","의령","함안","창녕","남해","하동","산청","함양","거창","합천"])
_reg("제주특별자치도", ["제주","서귀포"])

# CSV 학과구분 계열명 → 앱 FACULTIES 계열명
FAC_MAP = {
    "공학계열":"공학계열","교육계열":"교육계열","사회계열":"사회계열",
    "예체능계열":"예체능계열","의약계열":"의약·보건계열","인문계열":"인문계열",
    "자연계열":"자연계열",
}
ALL_CSV_FACS = list(FAC_MAP.keys())

# 운영기관구분 → 출처명 표기
def source_name(op_type: str) -> str:
    t = op_type.strip()
    if "지자체" in t:
        return "한국장학재단(지자체 장학)"
    if "공공기관" in t:
        return "한국장학재단(공공기관 장학)"
    return "한국장학재단(민간·대학 장학)"  # '기타' = 민간재단/대학 등

def extract_regions(org: str, region_detail: str, special: str, is_regional: bool) -> list:
    """시도 추출 우선순위: 풀네임 → 시군구(기관명) → 약칭(기관명).
    못 찾으면 지역연고형은 [](미상=확인필요), 그 외(민간·공공)는 ['전국']."""
    blob = " ".join([org, region_detail, special])
    found = []
    for full in SIDO_FULL:
        if full in blob and full not in found:
            found.append(full)
    if found:
        return found
    # 시군구명(주로 기관명에 등장)
    for sgg, sido in SGG_TO_SIDO.items():
        if sgg in org and sido not in found:
            found.append(sido)
    if found:
        return found
    # 약칭(기관명)
    for ab, full in SIDO_ABBR.items():
        if ab in org and full not in found:
            found.append(full)
    if found:
        return found
    # 추출 완전 실패: 지역연고형이면 미상(노이즈 방지), 아니면 전국 대상
    return [] if is_regional else ["전국"]

def extract_faculties(dept_field: str) -> list:
    """학과구분 셀에서 계열 추출. '제한없음' 또는 전 계열 나열이면 무관([])."""
    d = dept_field or ""
    if "제한없음" in d:
        return []
    hits = [FAC_MAP[c] for c in ALL_CSV_FACS if c in d]
    # 전 계열(7개) 다 들어있으면 사실상 무관
    if len(hits) >= len(ALL_CSV_FACS) or len(hits) == 0:
        return []
    return list(dict.fromkeys(hits))

# 소득 '심사형' 신호(가계곤란/저소득 등) — 있으면 lib/match.ts가 상위소득 제외
MEANS_RE = re.compile(r"저소득|기초|차상위|가계\s*곤란|생활\s*곤란|수급")

def clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("○", " ").strip()).strip()

# foundation-scholarships.json 수동 보강분과 겹치는 재단 — CSV판 제외(정밀 매칭본 우선)
DEDUP_KW = ["관정", "정몽구", "운해", "종근당"]

# 상품명이 일반적이라 단독으론 무의미 → 기관명을 제목에 붙인다
GENERIC_NAMES = {
    "대학생", "장학생", "학부장학생", "국내장학생", "신입생", "재학생", "대학원생",
    "신입생장학생", "재학생장학생", "일반장학생", "성적우수장학생", "대학생장학금",
    "장학금", "생활비장학생", "성적우수자", "우수장학생",
}

def display_name(org: str, product_name: str) -> str:
    nm = product_name.strip()
    if nm in GENERIC_NAMES or len(nm) <= 4:
        return f"{org} 장학금" if "장학" not in org else f"{org} ({nm})"
    return nm

# ── 특정자격(특정자격 상세내용=[자격]) → 구조화 하드 제약 ──────────────
# 오탐(정당한 장학금 숨김) 방지를 위해 신뢰도 높은 신호만. lib/match.ts·options.ts와 호응.
# (scripts/structure-kosaf-eligibility.py 와 동일 규칙 — JSON 직접보정용 보조 스크립트와 일치)
_MIL = re.compile(r"현역\s*군인|직업\s*군인|군무원|부사관|장교|군인")
_FEMALE = re.compile(r"여학생|여성만|여자\s*대학생|여자\s*대학원생|여대생")
_CLAN = re.compile(r"문중|종친|종회")
_BOHUN = re.compile(r"독립유공자|국가유공자|참전유공자|참전용사|보훈|유공자")
# 이주배경(다문화·북한이탈) 전용. _GROUP_MAP에 동일 키워드가 있어 multi-OR 보존이 자동 적용된다.
_MIGRANT = re.compile(r"다문화|북한이탈|새터민|탈북")
# '다문화/탈북 우대·가점'은 비배타적 가점(일반 대상)이라 전용이 아니다 → 우대 절 제거 후 판단.
_MIG_PREF = re.compile(r"(?:다문화|북한이탈|새터민|탈북)[^\n]{0,8}(?:우대|가점|가산|우선)")
_GROUP_MAP = [
    ("국가보훈대상자", _BOHUN),
    ("기초생활수급자", re.compile(r"기초생활수급|기초수급|수급자|수급권자")),
    ("차상위계층", re.compile(r"차상위")),
    ("한부모가족", re.compile(r"한부모|조손|소년소녀")),
    ("장애인(본인/가족)", re.compile(r"장애인|장애")),
    ("다문화가족", re.compile(r"다문화")),
    ("북한이탈주민", re.compile(r"북한이탈|새터민|탈북")),
]
_UNIV_TOKEN = re.compile(
    r"([가-힣]{2,7}(?:여자대학교|여자대학|여대|대학교|대학))"
    r"(?=\s*(?:재학생|재학|학부|졸업생|졸업|소속|출신|동문|총동문회))"
)
_GENERIC_TOK = ("정규대학", "원격대학", "사이버대학", "방송통신대학", "일반대학", "야간대학",
                "외국대학", "국내대학", "해당대학", "소재대학", "전문대학", "정규대학교", "4년제",
                "우수대학", "명문대학", "관내대학", "지역대학", "도내대학", "지방대학", "거점대학")
_MULTI = re.compile(r"[/·]|및|,")


def extract_eligibility(special: str):
    """특정자격(=[자격]) 텍스트에서 university / genderOnly / requiredFlags / targetGroups 추론."""
    jg = special or ""
    out = {}
    if not jg.strip():
        return out
    if _MIL.search(jg) and "자녀" in jg:
        out["requiredFlags"] = ["군인 자녀(군자녀)"]
    if _FEMALE.search(jg):
        out["genderOnly"] = "여성"
    if not any(g in jg for g in _GENERIC_TOK):
        toks = [t for t in dict.fromkeys(_UNIV_TOKEN.findall(jg)) if not any(g in t for g in _GENERIC_TOK)]
        multi = bool(_MULTI.search(jg) and len(re.findall(r"대학교|대학|여대", jg)) >= 2)
        if len(toks) == 1 and not multi:
            out["university"] = toks[0]
    if _BOHUN.search(jg) or _MIGRANT.search(_MIG_PREF.sub("", jg)):
        # 보훈/이주배경 전용: 언급된 사회배려 그룹 전체를 OR로 태깅(누락 방지).
        out["targetGroups"] = [name for name, rx in _GROUP_MAP if rx.search(jg)]
    elif _CLAN.search(jg):
        out["targetGroups"] = ["특정 문중·종친회"]
    return out


def build():
    with open(SRC, encoding="cp949") as f:
        rows = list(csv.DictReader(f))

    out = []
    for r in rows:
        raw_name = (r.get("상품명") or "").strip()
        org = (r.get("운영기관명") or "").strip()
        if not raw_name or not org:
            continue
        # 수동 정밀본과 중복되는 대형 재단은 CSV에서 제외
        if any(kw in org for kw in DEDUP_KW):
            continue
        name = display_name(org, raw_name)
        op_type = r.get("운영기관구분") or ""
        product = (r.get("상품구분") or "").strip()
        category = "대출" if product == "학자금" else "장학금"

        grade_text = clean(r.get("성적기준 상세내용", ""))
        income_text = clean(r.get("소득기준 상세내용", ""))
        support = clean(r.get("지원내역 상세내용", ""))
        special = clean(r.get("특정자격 상세내용", ""))
        region_detail = clean(r.get("지역거주여부 상세내용", ""))
        select_method = clean(r.get("선발방법 상세내용", ""))
        select_count = clean(r.get("선발인원 상세내용", ""))
        restrict = clean(r.get("자격제한 상세내용", ""))
        docs = clean(r.get("제출서류 상세내용", ""))
        homepage = (r.get("홈페이지 주소") or "").strip()
        start = (r.get("모집시작일") or "").strip()
        end = (r.get("모집종료일") or "").strip()

        is_regional = (r.get("학자금유형구분") or "").strip() == "지역연고"
        regions = extract_regions(org, region_detail, special, is_regional)
        faculties = extract_faculties(r.get("학과구분", ""))
        elig = extract_eligibility(special)  # 군자녀·여성·특정대학·보훈/문중 하드제약

        # 소득 note: 심사형이면 means-test 신호 포함 (match.ts MEANS_TESTED와 호응)
        income_note = None
        if income_text and "해당없음" not in income_text:
            income_note = income_text[:200]

        # rawConditionText: 핵심 조건 원문 보존(거짓 없음 보장)
        raw_parts = []
        if grade_text and "해당없음" not in grade_text: raw_parts.append(f"[성적] {grade_text}")
        if income_text and "해당없음" not in income_text: raw_parts.append(f"[소득] {income_text}")
        if special and "해당없음" not in special: raw_parts.append(f"[자격] {special}")
        if region_detail and "해당없음" not in region_detail: raw_parts.append(f"[지역거주] {region_detail}")
        if restrict and "해당없음" not in restrict: raw_parts.append(f"[자격제한] {restrict}")
        if select_count: raw_parts.append(f"[선발인원] {select_count}")
        if select_method: raw_parts.append(f"[선발방법] {select_method}")
        if docs: raw_parts.append(f"[제출서류] {docs}")
        period = f"{start} ~ {end}" if start or end else ""
        if period: raw_parts.append(f"[직전 모집기간] {period} — 최신 일정·요강은 운영기관 공고에서 확인하세요")
        raw = "\n".join(raw_parts) or None

        # applyPeriod: 직전 회차 종료일이 '아직 안 지난' 건만 노출(=지금도 유효한 모집).
        # 과거 회차 날짜를 그대로 쓰면 1,800여 건이 전부 '마감'으로 숨겨지므로 비운다(rawText엔 보존).
        # 형식은 lib/apply-status.ts가 기대하는 8자리(YYYYMMDD ~ YYYYMMDD)로 맞춘다.
        # 신규 회차는 공공데이터(15028252) 갱신·재빌드 시 자동으로 다시 채워진다.
        sd, ed = re.sub(r"\D", "", start), re.sub(r"\D", "", end)
        today8 = date.today().strftime("%Y%m%d")
        apply_period = f"{sd} ~ {ed}" if len(sd) == 8 and len(ed) == 8 and ed >= today8 else None

        # 설명: 기관 + 지원내역 요약
        desc_bits = [op_type.strip(), support[:80] if support else ""]
        description = " · ".join(b for b in desc_bits if b) or None

        benefit = {
            "id": f"kosaf-schol:{r.get('번호','').strip()}:{org[:8]}",
            "name": name,
            "category": category,
            "provider": org,
            "sourceName": source_name(op_type),
            "description": description,
            "regions": regions,
            "incomeMax": None,
            "ageMin": None,
            "ageMax": None,
            "eduStatus": ["대학생(재학)"],
            "grades": [],
            "requiredFlags": elig.get("requiredFlags", []),
            "targetGroups": elig.get("targetGroups", []),
            "departments": [],
            "faculties": faculties,
            "university": elig.get("university"),
            "genderOnly": elig.get("genderOnly"),
            "amount": support[:200] if support else None,
            "applyPeriod": apply_period,
            "applyUrl": homepage or "https://www.kosaf.go.kr",
            "rawConditionText": raw,
            "lastFetchedAt": date.today().isoformat(),
        }
        if income_note:
            benefit["incomeNote"] = income_note
        # None 값 제거(스키마 깔끔)
        benefit = {k: v for k, v in benefit.items() if v is not None}
        out.append(benefit)

    json.dump(out, io.open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # 요약 통계
    from collections import Counter
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"✅ {len(out)}건 → {OUT}")
    print("출처분포:", dict(Counter(b['sourceName'] for b in out)))
    region_dist = Counter(b['regions'][0] if len(b['regions'])==1 else '복수/전국' for b in out)
    print("지역(대표):", dict(region_dist.most_common(8)))
    fac = Counter(f for b in out for f in b.get('faculties', []))
    print("계열전용:", dict(fac))
    print("전국 처리:", sum(1 for b in out if b['regions']==['전국']), "건")

build()
