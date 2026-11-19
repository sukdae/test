#!/usr/bin/env python3
"""학습 2단계 준비: 내보낸 학습용 데이터(JSON)로 기준값이 사람 판정과 얼마나 맞는지 계산한다.

현장 설문(촬영 없음, 참여자가 정한 기준선)과 회차별 판정(트레이너) 파일을 둘 다 읽는다.

사용법:
    python3 tools/fit_thresholds.py formcheck-dataset-*.json [더 많은 파일...]

하는 일 (표준 라이브러리만 사용, 설치 필요 없음):
  1. 회차별 판정(사람)과 앱 지표(각도·시간)를 회차 단위로 묶는다.
  2. 판정 항목마다: 지금 기준값의 일치율·정밀도·재현율, 데이터로 찾은 최적 기준값,
     '영상 하나씩 빼고 맞춰 보기'(교차 검증) 일치율을 낸다. 같은 영상의 반복이 학습·시험에 섞이지 않게 영상 단위로 나눈다.
  3. 같은 회차를 평가자 둘 이상이 판정했으면 평가자 간 일치도(코헨 카파)를 낸다. 앱 정확도는 이 값을 넘기 어렵다.

판정 항목 이름은 앱의 '놓친 실수' 선택지(src/ui/judge.js MISSED)와 같아야 한다.
기준값은 src/core/feedback.js · front.js · upper.js 의 값을 옮겨 적은 것이다. 바꾸면 여기도 같이 바꾼다.
"""
import json
import sys
from collections import defaultdict

# (종목, 방향(측면/정면), 판정 항목) → (지표, 방향, 지금 기준값)
#   방향 '>' = 지표가 기준보다 크면 실수, '<' = 작으면 실수, 'abs>' = 절대값이 크면 실수
RULES = {
    ('squat', 'side', '깊이가 얕음'): ('thighAboveParallel', '>', 35),
    ('squat', 'side', '뒤꿈치 들림'): ('heelLift', '>', 0.03),
    ('squat', 'side', '엉덩이가 먼저 올라옴'): ('trunkEarly', '>', 3),
    ('squat', 'side', '상체가 너무 숙여짐'): ('maxTrunk', '>', None),  # 앱에 판정 없음: 데이터로 탐색만
    ('squat', 'side', '허리가 굽음'): ('backRound', '>', 4),
    ('squat', 'side', '무게중심이 앞/뒤로 쏠림'): ('comShift', 'abs>', 0.3),
    ('squat', 'front', '무릎이 안쪽으로 모임'): ('kneeIn', '>', 0.04),
    ('squat', 'front', '몸이 한쪽으로 쏠림'): ('shift', 'abs>', 0.15),
    ('deadlift', 'side', '마무리에서 덜 폄'): ('topHip', '<', 165),
    ('deadlift', 'side', '끝에서 뒤로 젖힘'): ('minTrunk', '<', -15),
    ('deadlift', 'side', '무릎을 너무 굽힘'): ('kneeAtBottom', '<', 100),
    ('deadlift', 'side', '바닥에서 튕김'): ('floorPause', '<', 0.15),
    ('deadlift', 'side', '허리가 굽음'): ('backRound', '>', 4),
    ('deadlift', 'front', '몸이 한쪽으로 쏠림'): ('shift', 'abs>', 0.15),
    ('chinup', 'side', '턱이 바 아래'): ('reach', '<', 0),
    ('chinup', 'side', '매달림에서 덜 폄'): ('topElbow', '<', 150),
    ('chinup', 'side', '몸 반동'): ('hipRange', '>', 40),
    ('chinup', 'side', '내려올 때 툭 떨어짐'): ('up', '<', 0.7),
    ('dip', 'side', '깊이가 얕음'): ('flex', '<', 95),
    ('dip', 'side', '너무 깊음(어깨 부담)'): ('shoulderExt', '>', 79),
    ('dip', 'side', '위에서 덜 폄'): ('topElbow', '<', 151),
    ('dip', 'side', '내려갈 때 너무 빠름'): ('down', '<', 0.7),
}
MIN_POS = 10  # 실수로 판정된 회차가 이보다 적으면 결과를 믿기 어렵다고 표시


def load(paths):
    sessions, surveys = [], []
    for p in paths:
        with open(p, encoding='utf-8') as f:
            d = json.load(f)
        if d.get('format') == 'formcheck-threshold-survey':
            surveys.append(d)
            continue
        if d.get('format') != 'formcheck-dataset':
            print(f'건너뜀(형식 아님): {p}', file=sys.stderr)
            continue
        for s in d.get('sessions', []):
            if s.get('synthetic'):
                continue  # 예시(합성) 데이터는 제외
            sessions.append(s)
    return sessions, surveys


def rep_rows(sessions):
    """회차 단위 행: (영상 id, 평가자, 종목, 방향, 회차, 지표 dict, 판정 실수 set)"""
    rows = []
    for s in sessions:
        metrics = {r['index']: r.get('metrics', {}) for r in s.get('reps', [])}
        partial = {r['index'] for r in s.get('reps', []) if r.get('partial')}
        for l in s.get('labels', []):
            if l.get('kind') != 'rep' or l.get('rep') not in metrics or l['rep'] in partial:
                continue
            rows.append((s['id'], l.get('raterId') or '?', s['exercise'], s['view'], l['rep'], metrics[l['rep']], set(l.get('issues') or [])))
    return rows


def predict(v, op, th):
    if v is None or th is None:
        return None
    if op == '>':
        return v > th
    if op == '<':
        return v < th
    return abs(v) > th


def scores(pairs):
    tp = sum(1 for p, y in pairs if p and y)
    fp = sum(1 for p, y in pairs if p and not y)
    fn = sum(1 for p, y in pairs if not p and y)
    tn = sum(1 for p, y in pairs if not p and not y)
    n = tp + fp + fn + tn
    sens = tp / (tp + fn) if tp + fn else float('nan')
    spec = tn / (tn + fp) if tn + fp else float('nan')
    return {
        'n': n, 'acc': (tp + tn) / n if n else float('nan'),
        'precision': tp / (tp + fp) if tp + fp else float('nan'),
        'recall': sens, 'balanced': (sens + spec) / 2 if tp + fn and tn + fp else float('nan'),
    }


def best_threshold(data, op):
    """균형 정확도(민감도·특이도 평균)가 가장 큰 기준값. 후보 = 관측값 사이 중간점"""
    vals = sorted({abs(v) if op == 'abs>' else v for v, _ in data})
    if len(vals) < 2:
        return None
    best, best_score = None, -1
    for a, b in zip(vals, vals[1:]):
        th = (a + b) / 2
        sc = scores([(predict(v, op, th), y) for v, y in data])['balanced']
        if sc == sc and sc > best_score:
            best, best_score = th, sc
    return best


def cross_validated(data_by_video, op):
    """영상 하나씩 빼고 나머지로 기준값을 찾아, 뺀 영상에서 맞춰 본다"""
    pairs = []
    vids = list(data_by_video)
    for v in vids:
        train = [x for k in vids if k != v for x in data_by_video[k]]
        th = best_threshold(train, op)
        if th is None:
            continue
        pairs += [(predict(val, op, th), y) for val, y in data_by_video[v]]
    return scores(pairs) if pairs else None


def median_q(vals):
    v = sorted(vals)
    if not v:
        return None, None, None
    at = lambda p: v[min(len(v) - 1, int(p * (len(v) - 1) + 0.5))]
    return at(0.25), at(0.5), at(0.75)


def threshold_survey_report(files):
    """촬영 없는 기준선 설문: 참여자가 '여기부터 문제'로 정한 값의 분포를 앱 기준값과 비교"""
    qs, resp = {}, []
    for d in files:
        for q in d.get('questions', []):
            qs[q['id']] = q
        resp += d.get('responses', [])
    print(f'\n## 현장 설문: 참여자가 정한 기준선 ({len(resp)}명)\n')
    if not resp:
        print('응답이 없어요.')
        return
    print('| 종목 | 문항 | 응답 | 모름 | 1사분위 | 중앙값 | 3사분위 | 앱 기준 | 앱보다 엄격하게 본 사람 |')
    print('|---|---|---|---|---|---|---|---|---|')
    for qid, q in qs.items():
        vals = [r['answers'][qid] for r in resp if isinstance(r.get('answers', {}).get(qid), (int, float))]
        unk = sum(1 for r in resp if qid in r.get('answers', {}) and r['answers'][qid] is None)
        q1, med, q3 = median_q(vals)
        app = q.get('app')
        if app is None or not vals:
            stricter = '–'
        else:
            k = sum(1 for v in vals if (v < app if q['dir'] == '>' else v > app))
            stricter = f'{k}명 ({k / len(vals) * 100:.0f}%)'
        print(f"| {q.get('exercise')} | {q.get('title')} | {len(vals)} | {unk} | {fmt(q1, 1)} | {fmt(med, 1)} | {fmt(q3, 1)} | {app if app is not None else '판정 없음'} | {stricter} |")
    print('\n### 운동 경력별 중앙값\n')
    groups = sorted({(r.get('profile') or {}).get('career') or '응답 없음' for r in resp})
    print('| 문항 | ' + ' | '.join(groups) + ' |')
    print('|---|' + '---|' * len(groups))
    for qid, q in qs.items():
        cells = []
        for g in groups:
            vals = [r['answers'][qid] for r in resp if ((r.get('profile') or {}).get('career') or '응답 없음') == g and isinstance(r.get('answers', {}).get(qid), (int, float))]
            cells.append(f"{fmt(median_q(vals)[1], 1)} ({len(vals)})")
        print(f"| {q.get('title')} | " + ' | '.join(cells) + ' |')
    print('\n※ 중앙값이 앱 기준과 많이 다르면(사분위 범위 밖) 기준값 조정을 검토하세요. 참여자 판단은 트레이너 판단과 다를 수 있어 경력별로도 보세요.')


def kappa(a, b):
    n = len(a)
    if not n:
        return float('nan')
    po = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = sum(a) / n, sum(b) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return (po - pe) / (1 - pe) if pe < 1 else float('nan')


def fmt(x, d=2):
    return '–' if x is None or x != x else f'{x:.{d}f}'


def main(paths):
    sessions, surveys = load(paths)
    print('# 기준값 점검 보고서')
    if surveys:
        threshold_survey_report(surveys)
    rows = rep_rows(sessions)
    print(f'\n## 회차별 판정 (트레이너용) — 영상 {len(sessions)}개 · 판정된 회차 {len(rows)}개\n')
    if not rows:
        print('회차별 판정이 없어요(현장 설문만 있으면 위 표를 보면 돼요).')
        return
    print('| 종목 | 방향 | 항목 | 회차 | 실수 | 지금 기준 | 일치율 | 정밀도 | 재현율 | 데이터 최적값 | 교차검증 균형정확도 | 메모 |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (ex, view, item), (metric, op, th) in RULES.items():
        sel = [(vid, m.get(metric), item in issues) for vid, _, e, vw, _, m, issues in rows if e == ex and vw == view]
        sel = [(vid, v, y) for vid, v, y in sel if v is not None]
        if not sel:
            continue
        data = [(v, y) for _, v, y in sel]
        pos = sum(y for _, y in data)
        cur = scores([(predict(v, op, th), y) for v, y in data]) if th is not None else None
        best = best_threshold(data, op)
        by_vid = defaultdict(list)
        for vid, v, y in sel:
            by_vid[vid].append((v, y))
        cv = cross_validated(by_vid, op) if len(by_vid) >= 3 else None
        note = '실수 회차가 적어 참고만' if pos < MIN_POS else ''
        sign = {'>': '>', '<': '<', 'abs>': '|x|>'}[op]
        print(f"| {ex} | {view} | {item} | {len(data)} | {pos} | {sign} {th if th is not None else '없음'} | "
              f"{fmt(cur and cur['acc'])} | {fmt(cur and cur['precision'])} | {fmt(cur and cur['recall'])} | "
              f"{sign} {fmt(best, 3)} | {fmt(cv and cv['balanced'])} | {note} |")

    # 평가자 간 일치도: 같은 영상·회차를 두 평가자 이상이 판정한 경우
    by_rep = defaultdict(dict)
    for vid, rater, ex, view, rep, _, issues in rows:
        by_rep[(vid, rep)][rater] = (ex, view, issues)
    multi = {k: v for k, v in by_rep.items() if len(v) >= 2}
    print(f'\n## 평가자 간 일치도 (같은 회차를 2명 이상 판정: {len(multi)}회)\n')
    if not multi:
        print('아직 없어요. 같은 영상을 두 사람이 각자 판정하면 계산돼요.')
        return
    items = sorted({i for v in multi.values() for _, _, iss in v.values() for i in iss})
    for item in items:
        a, b = [], []
        for v in multi.values():
            r1, r2 = list(v.values())[:2]
            a.append(item in r1[2])
            b.append(item in r2[2])
        print(f'- {item}: 코헨 카파 {fmt(kappa(a, b))} ({len(a)}회)')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])
