# KOSAF 항목의 [자격] 원문에서 '하드 제약'을 구조화 필드로 승격한다.
# 목적: 이화여대 전용·군자녀 전용·보훈(유공자 후손) 전용·문중 전용 같은 게 누구에게나 뜨는 문제 해결.
# 원칙: 오탐(정당한 장학금을 잘못 숨김) 방지를 위해 '신뢰도 높은' 신호만, [자격] 구간(=대상요건)에서만 잡는다.
#   ([자격제한]은 제외/노이즈가 많아 보지 않는다)
#   - 군자녀            → requiredFlags = ["군인 자녀(군자녀)"]
#   - 여성 전용(명시)   → genderOnly = "여성"
#   - 단일 특정대학     → university = 추출 토큰 (학교 1곳 + 소속어, 일반어/다중나열 제외)
#   - 보훈/유공자 후손  → targetGroups += ["국가보훈대상자"] (저소득 OR 동반 시 수급/차상위도 함께 = 누락 방지)
#   - 문중/종친         → targetGroups += ["특정 문중·종친회"] (일반 사용자 해당 없음 → 노이즈 제거)
# 이미 생성된 JSON을 직접 보정한다(원본 CSV는 빌드 입력이라 로컬에 없음). --apply 없으면 드라이런.
import json, re, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
PATH = "data/kosaf-scholarships.json"
DRY = "--apply" not in sys.argv

MIL = re.compile(r"현역\s*군인|직업\s*군인|군무원|부사관|장교|군인")
FEMALE = re.compile(r"여학생|여성만|여자\s*대학생|여자\s*대학원생|여대생")
CLAN = re.compile(r"문중|종친|종회")
BOHUN = re.compile(r"독립유공자|국가유공자|참전유공자|참전용사|보훈|유공자")
# 사회배려 대상 키워드 → 입력폼 특수자격(lib/options.ts SPECIAL_FLAGS)과 동일 라벨.
# 보훈류 자격에 여러 대상이 OR로 나열될 때, 언급된 그룹 전체를 함께 태깅해 누락을 막는다.
GROUP_MAP = [
    ("국가보훈대상자", BOHUN),
    ("기초생활수급자", re.compile(r"기초생활수급|기초수급|수급자|수급권자")),
    ("차상위계층", re.compile(r"차상위")),
    ("한부모가족", re.compile(r"한부모|조손|소년소녀")),
    ("장애인(본인/가족)", re.compile(r"장애인|장애")),
    ("다문화가족", re.compile(r"다문화")),
    ("북한이탈주민", re.compile(r"북한이탈|새터민|탈북")),
]
UNIV_TOKEN = re.compile(
    r"([가-힣]{2,7}(?:여자대학교|여자대학|여대|대학교|대학))"
    r"(?=\s*(?:재학생|재학|학부|졸업생|졸업|소속|출신|동문|총동문회))"
)
# 학교명처럼 보이지만 특정 학교가 아닌 일반어(이게 추출되면 무시)
GENERIC_TOK = ("정규대학", "원격대학", "사이버대학", "방송통신대학", "일반대학", "야간대학",
               "외국대학", "국내대학", "해당대학", "소재대학", "전문대학", "정규대학교", "4년제",
               "우수대학", "명문대학", "관내대학", "지역대학", "도내대학", "지방대학", "거점대학")
MULTI = re.compile(r"[/·]|및|,")


def seg(raw, tag):
    m = re.search(rf"\[{tag}\]\s*([^\n]+)", raw or "")
    return m.group(1) if m else ""


def main():
    d = json.load(open(PATH, encoding="utf-8"))
    stats = {"군자녀": 0, "여성": 0, "단일대학": 0, "보훈": 0, "문중": 0}
    samples = {k: [] for k in stats}

    def note(k, *vals):
        stats[k] += 1
        if len(samples[k]) < 5:
            samples[k].append(vals)

    for b in d:
        jg = seg(b.get("rawConditionText", ""), "자격")
        if not jg.strip():
            continue

        if not b.get("requiredFlags") and MIL.search(jg) and "자녀" in jg:
            note("군자녀", b["name"][:24], jg[:48])
            if not DRY:
                b["requiredFlags"] = ["군인 자녀(군자녀)"]

        if not b.get("genderOnly") and FEMALE.search(jg):
            note("여성", b["name"][:24], jg[:48])
            if not DRY:
                b["genderOnly"] = "여성"

        if not b.get("university") and not any(g in jg for g in GENERIC_TOK):
            toks = [t for t in dict.fromkeys(UNIV_TOKEN.findall(jg)) if not any(g in t for g in GENERIC_TOK)]
            multi = bool(MULTI.search(jg) and len(re.findall(r"대학교|대학|여대", jg)) >= 2)
            if len(toks) == 1 and not multi:
                note("단일대학", b["name"][:24], toks[0], jg[:42])
                if not DRY:
                    b["university"] = toks[0]

        if not b.get("targetGroups") and BOHUN.search(jg):
            # 보훈류 자격: 언급된 사회배려 그룹 전체를 OR로 태깅(누락 방지).
            groups = [name for name, rx in GROUP_MAP if rx.search(jg)]
            note("보훈", b["name"][:24], "+".join(groups), jg[:42])
            if not DRY:
                b["targetGroups"] = groups

        if not b.get("targetGroups") and CLAN.search(jg):
            note("문중", b["name"][:24], jg[:48])
            if not DRY:
                b["targetGroups"] = ["특정 문중·종친회"]

    print(f"{'[DRY-RUN] 미적용' if DRY else '[APPLIED] 적용'} — 변경 대상:")
    for k, v in stats.items():
        print(f"  {k}: {v}건")
        for s in samples[k]:
            print(f"      {s}")
    if not DRY:
        json.dump(d, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"\n저장 완료 → {PATH}")


main()
