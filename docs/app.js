const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

// ============================================================
// 문서 유형 감지 + 자유 텍스트에서 필드 추출
// (구조화된 입력폼 대신, 사용자가 편하게 적은 자유 텍스트 한 덩어리에서
//  문서 유형과 각 항목 값을 규칙 기반으로 뽑아낸다. LLM을 쓰지 않으므로
//  "라벨: 값" 형태의 명시적 표기나 흔한 키워드 단서에 의존하며, 핵심 항목의
//  단서를 못 찾으면 바로 검토·수정할 수 있도록 예시 성격의 더미 값을 채워
//  넣는다.)
// ============================================================

const TYPE_META = {
  tripReport: { label: '출장보고서' },
  leaveRequest: { label: '휴가신청서' },
  handover: { label: '업무인수인계서' },
  plan: { label: '계획서' },
  meeting: { label: '회의록' },
  memo: { label: '공문' },
  report: { label: '보고서' },
  notice: { label: '안내문' },
};

// 우선순위 순서대로 검사한다 (더 구체적인 유형을 일반적인 유형보다 먼저 확인).
const TYPE_DETECTORS = [
  { type: 'tripReport', patterns: [/출장/] },
  { type: 'leaveRequest', patterns: [/휴가\s*(신청|사용)|연차|반차|병가/] },
  { type: 'handover', patterns: [/인수인계/] },
  { type: 'plan', patterns: [/계획서|계획을|추진\s*계획/] },
  { type: 'meeting', patterns: [/회의록|착수\s*회의|킥오프|회의를/] },
  { type: 'memo', patterns: [/공문|협조\s*요청/] },
  { type: 'notice', patterns: [/안내문|안내드립니다|공지사항|공지드립니다/] },
  { type: 'report', patterns: [/보고서|결과\s*보고/] },
];

// 위 키워드 단서로 못 정한 경우, 제목 줄의 끝맺음(공공/사내 문서에서 흔한 관용구)으로
// 한 번 더 판별한다 -- 본문 어디에나 나올 수 있는 낱말(예: "휴가", "계획")은 오탐 위험이
// 있어 본문 전체가 아니라 "제목으로 쓰일 법한 첫 줄"에만 적용한다.
const TITLE_SUFFIX_DETECTORS = [
  { type: 'notice', pattern: /안내$/ },
  { type: 'plan', pattern: /계획$/ },
  { type: 'leaveRequest', pattern: /휴가$/ },
];

function detectDocType(text) {
  for (const { type, patterns } of TYPE_DETECTORS) {
    if (patterns.some((re) => re.test(text))) return type;
  }
  const firstLine = (text.split('\n').find((l) => l.trim()) || '').trim();
  const bySuffix = TITLE_SUFFIX_DETECTORS.find(({ pattern }) => pattern.test(firstLine));
  return bySuffix ? bySuffix.type : 'report';
}

// 유형별 필드 추출 스키마: label(라벨:값 매칭용) + cues(키워드 단서, 없으면 catch-all로 처리)
const FIELD_SCHEMAS = {
  tripReport: [
    { key: 'traveler', label: '출장자', cues: [/출장자/] },
    { key: 'period', label: '출장기간', cues: [/출장\s*기간|기간/], isDateRange: true },
    { key: 'destination', label: '출장지', cues: [/출장지/] },
    { key: 'visitOrg', label: '방문기관', cues: [/방문\s*기관|방문처|거래처/] },
    { key: 'purpose', label: '출장목적', cues: [/목적/] },
    { key: 'schedule', label: '주요일정', cues: [/일정/] },
    { key: 'activities', label: '수행내용', cues: [/수행\s*내용|한\s*일|업무\s*내용/] },
    { key: 'negotiations', label: '주요협의사항', cues: [/협의|협상|미팅/] },
    { key: 'outcome', label: '출장결과', cues: [/결과|성과/] },
    { key: 'followup', label: '향후조치', cues: [/후속\s*조치|향후\s*조치/] },
    { key: 'notes', label: '특이사항', cues: [/특이\s*사항/] },
  ],
  leaveRequest: [
    { key: 'applicant', label: '신청자', cues: [/신청자/] },
    { key: 'department', label: '소속', cues: [/소속/] },
    { key: 'position', label: '직급', cues: [/직급|직책/] },
    { key: 'applyDate', label: '신청일', cues: [/신청일/] },
    { key: 'period', label: '휴가기간', cues: [/휴가\s*기간|기간/], isDateRange: true },
    { key: 'days', label: '휴가일수', cues: [/일수/] },
    { key: 'leaveType', label: '휴가종류', cues: [/종류|연차|반차|병가|경조사/] },
    { key: 'reason', label: '휴가사유', cues: [/사유|여행|개인\s*사정|가족/] },
    { key: 'handover', label: '업무 인수인계 내용', cues: [/인수인계/] },
    { key: 'emergencyContact', label: '비상연락', cues: [/비상\s*연락|긴급\s*연락/] },
  ],
  handover: [
    { key: 'handoverFrom', label: '인계자', cues: [/인계자/] },
    { key: 'handoverTo', label: '인수자', cues: [/인수자/] },
    { key: 'handoverDate', label: '인수인계일', cues: [/인수인계일/] },
    { key: 'targetDuties', label: '인수인계 대상 업무', cues: [/대상\s*업무|담당\s*업무/] },
    { key: 'progress', label: '업무별 진행 현황', cues: [/진행\s*현황|진행\s*중인?\s*프로젝트|프로젝트/] },
    { key: 'remainingWork', label: '남은 작업', cues: [/남은\s*작업/] },
    { key: 'materialsLocation', label: '관련 자료 위치', cues: [/자료\s*위치|자료는|폴더|드라이브/] },
    { key: 'contact', label: '주요 연락처', cues: [/연락처/] },
    { key: 'notes', label: '주의사항', cues: [/주의\s*사항/] },
    { key: 'schedule', label: '향후 일정', cues: [/향후\s*일정/] },
  ],
  plan: [
    { key: 'background', label: '추진배경', cues: [/배경/] },
    { key: 'purpose', label: '추진목적', cues: [/목적/] },
    { key: 'target', label: '적용대상', cues: [/대상/] },
    { key: 'content', label: '주요추진내용', cues: [/추진\s*내용/] },
    { key: 'schedule', label: '추진일정', cues: [/일정/] },
    { key: 'expectedEffect', label: '기대효과', cues: [/효과/] },
    { key: 'notes', label: '유의사항', cues: [/유의\s*사항|리스크|위험/] },
    { key: 'futurePlan', label: '향후계획', cues: [/향후\s*계획/] },
  ],
  meeting: [
    { key: 'date', label: '회의일시', cues: [/일시/] },
    { key: 'place', label: '회의장소', cues: [/장소/] },
    { key: 'attendees', label: '참석자', cues: [/참석자/] },
    { key: 'purpose', label: '회의목적', cues: [/회의\s*목적/] },
    { key: 'agenda', label: '안건', cues: [/안건/] },
    { key: 'decisions', label: '결정사항', cues: [/결정|하기로\s*(했|했어|했습니다)/] },
    { key: 'followup', label: '후속조치', cues: [/후속\s*조치/] },
    { key: 'nextMeeting', label: '다음회의일정', cues: [/다음\s*회의/] },
    { key: 'content', label: '주요논의내용', cues: [/내용/] },
  ],
  memo: [
    { key: 'recipient', label: '수신', cues: [/수신/] },
    { key: 'reference', label: '관련근거', cues: [/관련\s*근거|근거/] },
    { key: 'requestContent', label: '요청사항', cues: [/요청\s*사항|안내\s*사항/] },
    { key: 'deadline', label: '제출기한', cues: [/제출\s*기한|기한/] },
    { key: 'submitMethod', label: '제출방법', cues: [/제출\s*방법/] },
    { key: 'contact', label: '문의처', cues: [/담당자|연락처|문의처/] },
    { key: 'attachment', label: '붙임', cues: [/붙임|첨부/] },
    { key: 'content', label: '본문', cues: [/내용|본문/] },
  ],
  report: [
    { key: 'reportTarget', label: '보고대상', cues: [/보고\s*대상/] },
    { key: 'author', label: '보고자', cues: [/보고자|작성자/] },
    { key: 'date', label: '보고일자', cues: [/보고일자|일자/] },
    { key: 'purpose', label: '보고목적', cues: [/목적|배경/] },
    { key: 'progress', label: '추진현황', cues: [/추진\s*현황|진행\s*현황/] },
    { key: 'reviewResult', label: '검토결과', cues: [/검토\s*결과/] },
    { key: 'problems', label: '문제점', cues: [/문제점|이슈/] },
    { key: 'improvement', label: '개선방안', cues: [/개선\s*방안|개선안/] },
    { key: 'futurePlan', label: '향후계획', cues: [/향후\s*계획/] },
    { key: 'notes', label: '특이사항', cues: [/특이\s*사항/] },
    { key: 'content', label: '주요내용', cues: [/내용/] },
  ],
  notice: [
    { key: 'target', label: '안내대상', cues: [/대상/] },
    { key: 'purpose', label: '안내목적', cues: [/목적/] },
    { key: 'period', label: '기간', cues: [/기간/], isDateRange: true },
    { key: 'place', label: '장소', cues: [/장소/] },
    { key: 'method', label: '신청방법', cues: [/신청\s*방법|참여\s*방법|제출\s*방법/] },
    { key: 'notes', label: '유의사항', cues: [/유의\s*사항/] },
    { key: 'inquiry', label: '문의처', cues: [/문의처|문의/] },
    { key: 'content', label: '주요내용', cues: [/내용/] },
  ],
};

// 각 유형에서 "라벨:값"도 못 찾고 어떤 키워드 단서에도 안 걸린 줄이 최종적으로 담기는 항목.
const CATCH_ALL_KEY = {
  tripReport: 'activities',
  leaveRequest: 'reason',
  handover: 'notes',
  plan: 'content',
  meeting: 'content',
  memo: 'content',
  report: 'content',
  notice: 'content',
};

// 유형별로 "이게 없으면 문서 자체가 성립하지 않는" 핵심 항목 -- 비어 있으면
// 예시 더미 값(DUMMY_VALUES)으로 채운다 (날짜/이름/장소/담당자/기한 등).
const CRITICAL_FIELDS = {
  tripReport: ['traveler', 'period', 'destination', 'visitOrg'],
  leaveRequest: ['applicant', 'department', 'period'],
  handover: ['handoverFrom', 'handoverTo', 'handoverDate', 'materialsLocation'],
  plan: ['target', 'schedule', 'expectedEffect'],
  meeting: ['attendees', 'date', 'place'],
  memo: ['recipient', 'deadline', 'attachment'],
  report: ['reportTarget', 'author', 'reviewResult'],
  notice: ['target', 'period', 'method', 'inquiry'],
};

// 핵심 항목이 비어 있을 때 채워 넣는 예시(더미) 값 -- 실제 문서에 바로 쓰기보다는
// "이런 형식으로 채우면 된다"를 보여주는 자리표시자이므로 사용자가 다음 단계에서
// 쉽게 알아보고 고칠 수 있게 일반적인 예시 표현을 쓴다.
const DUMMY_VALUES = {
  traveler: '홍길동 과장',
  destination: '부산',
  visitOrg: '협력사 OOO',
  applicant: '홍길동',
  department: '기획팀',
  handoverFrom: '홍길동',
  handoverTo: '김철수',
  attendees: '관련 부서 담당자',
  recipient: '관련 부서장',
  reportTarget: '관련 부서장',
  author: '작성자 미상',
  date: '2026. 7. 23.',
  handoverDate: '2026. 7. 23.',
  period: '2026. 7. 24. ~ 2026. 7. 25.',
  deadline: '문서 시행일로부터 7일 이내',
  place: '본사 회의실',
  materialsLocation: '사내 공유 드라이브',
  attachment: '해당 없음',
  reviewResult: '세부 검토를 통해 개선 여지를 확인함.',
  method: '담당 부서를 통해 신청',
  inquiry: '담당 부서',
  target: '관련 부서 전체',
  schedule: '1개월간 단계적으로 추진',
  expectedEffect: '• 업무 효율성 향상\n• 비용 절감\n• 담당자 만족도 개선',
  outcome: '계획한 목표 수준의 성과를 달성함.',
  followup: '관련 부서와 협의하여 후속 조치를 진행함.',
  reason: '개인 사정으로 인한 휴가 사용.',
  title: '문서 제목(예시)',
  activities: '현장 방문 및 관계자 협의를 통해 관련 업무를 수행함.',
  decisions: '제시된 안건에 대해 참석자 간 협의를 거쳐 실행하기로 결정함.',
  content: '세부 내용은 관련 자료를 참고하여 정리함.',
  purpose: '부서 간 원활한 협조와 업무 효율성 제고를 위함.',
  targetDuties: '정기 보고 업무 및 진행 중인 프로젝트 전반.',
  progress: '각 업무는 정상적으로 진행 중이며 특이사항 없음.',
  remainingWork: '인수인계일 기준 진행 중인 업무는 순차적으로 마무리할 예정.',
  contact: '담당 부서 대표 연락처 및 사내 메신저',
  notes: '변경 사항 발생 시 관련 부서와 공유 예정.',
};

function dummyFor(key) {
  return DUMMY_VALUES[key] || '내용 미정(예시)';
}

// 문장형 서술어로 끝나는지 판단 -- "이름/직급"처럼 단답이어야 할 항목에
// 사용자가 쓴 문장을 그대로 옮겨 담지 않기 위한 용도.
const SENTENCE_ENDING_RE = /(다|요|죠|네|어|아|해|야|래|돼|음|함|됨|임|든|지|까|구요|드립니다|바랍니다|습니다|합니다|입니다|는데|한데|근데)\.?\s*$/;
function looksLikeSentence(text) {
  return SENTENCE_ENDING_RE.test((text || '').trim());
}

// 이름+직급처럼 단답이어야 하는 항목 -- 문장형으로 들어오면 그대로 쓰지 않고 더미로 대체한다.
const PERSON_LIKE_FIELDS = ['traveler', 'applicant', 'handoverFrom', 'handoverTo', 'attendees', 'author', 'reportTarget', 'recipient'];

// 핵심 항목이 비어 있으면 더미 값으로, 그 외 선택 항목은 빈 문자열 그대로 둔다.
// 이름/직급류 항목에 문장이 통째로 들어온 경우도 더미로 대체한다.
function checkField(type, fields, key) {
  const v = (fields[key] || '').trim();
  const rejectAsSentence = v && PERSON_LIKE_FIELDS.includes(key) && looksLikeSentence(v);
  if (v && !rejectAsSentence) return v;
  return (CRITICAL_FIELDS[type] || []).includes(key) ? dummyFor(key) : '';
}

const DOC_TYPE_NAMES = '회의록|공문|보고서|안내문|계획서|인수인계서|휴가\\s*신청서|출장\\s*보고서';
const INSTRUCTION_VERBS = '만들어\\s*줘|만들어줘|만들고\\s*싶어|만들고자\\s*합니다|정리하고\\s*싶어|정리해야\\s*합니다|정리하려고\\s*합니다|작성해\\s*주세요|작성해주세요|부탁드립니다|하나\\s*만들어줘';
const LABEL_LINE_RE = /^([가-힣A-Za-z ]{1,12})\s*[:：]\s*(.+)$/;
const WEEKDAY_RE = '(?:월|화|수|목|금|토|일)요일';
const DATE_RANGE_RE = new RegExp(
  `(\\d{1,2}\\s*월\\s*)?(\\d{1,2}\\s*일)\\s*(?:${WEEKDAY_RE}\\s*)?(?:부터|~|-|에서)\\s*(\\d{1,2}\\s*월\\s*)?(\\d{1,2}\\s*일)\\s*(?:${WEEKDAY_RE}\\s*)?(?:까지)?`
);

// 문장 끝의 "~해줘/~하고 싶어/~해주세요" 같은 요청 문구를 잘라내
// 제목 후보나 실제 내용만 남긴다 (도구에게 하는 말이지 문서 내용이 아니므로).
function stripInstructionTail(line) {
  let t = line.trim();
  const withType = new RegExp(`(${DOC_TYPE_NAMES})\\s*(으로|로)?\\s*(${INSTRUCTION_VERBS})\\.?\\s*$`);
  const bare = new RegExp(`(${INSTRUCTION_VERBS})\\.?\\s*$`);
  if (withType.test(t)) {
    t = t.replace(withType, '').trim();
  } else if (bare.test(t)) {
    t = t.replace(bare, '').trim();
  }
  return t;
}

// "~하는 내용으로", "~에 대해", "~신청하는" 처럼 문서 종류를 설명하는 도중에
// 나오는 어구 -- 이런 어구가 있으면 끝에 문서 종류 명사가 와도 실제 제목이
// 아니라 사용자가 도구에게 상황을 설명한 문장일 뿐이다.
const TITLE_DESCRIPTIVE_MARKER_RE = /(내용으로|하는\s*내용|관련하여|에\s*대해|에\s*대한|신청하는|작성하는|요청하는|보고하는|공유하는|정리하는)/;
const TITLE_MAX_LEN = 26;

function deriveTitle(firstLine, typeLabel) {
  const cleaned = stripInstructionTail(firstLine || '').replace(/[,，]?\s*(이|가|은|는|을|를)\s*$/, '').trim();
  // 제목은 문서 종류를 나타내는 짧은 명사구여야지, 사용자가 도구에게 상황을
  // 설명하며 캐주얼하게 적은 문장이나 긴 서술을 그대로 옮겨서는 안 된다
  // (예: "부산 갔다왔어" -> 출장보고서, "...신청하는 내용으로 휴가신청서" -> 휴가신청서).
  if (
    cleaned.length < 2 ||
    cleaned.length > TITLE_MAX_LEN ||
    looksLikeSentence(cleaned) ||
    TITLE_DESCRIPTIVE_MARKER_RE.test(cleaned)
  ) {
    return typeLabel;
  }
  return cleaned;
}

function extractDateRange(line) {
  const m = line.match(DATE_RANGE_RE);
  return m ? m[0].replace(/\s+/g, '') : null;
}

// 짧은 단답형(이름/장소/기관명 등) 항목은 "출장지는 부산이야" 같은 서술식 문장으로
// 와도 조사+서술어를 떼어내고 핵심 값만 남긴다. 서술형 문장을 그대로 옮기면 안 되는
// 항목에만 적용하며(narrative 항목은 문장 전체가 곧 내용이므로 제외), 패턴이
// 안 맞으면 원래 줄을 그대로 둔다.
const IDENTITY_FIELD_KEYS = [
  'destination', 'visitOrg', 'department', 'position', 'leaveType', 'days',
  'applyDate', 'handoverDate', 'materialsLocation', 'contact', 'place',
  'deadline', 'inquiry', 'method', 'nextMeeting', 'target',
];
const COPULA_VALUE_RE = /(?:이|가|은|는)\s*(.+?)\s*(?:이야|야|이다|이었다|였다|입니다|였습니다|이었습니다|임|예요|이에요)\.?$/;

function extractIdentityValue(line) {
  const m = line.match(COPULA_VALUE_RE);
  return m && m[1].trim().length >= 1 ? m[1].trim() : null;
}

// 자유 텍스트 한 덩어리를 { type, fields(제목 포함) } 로 변환한다.
function parseFreeText(rawText, forcedType) {
  const type = forcedType || detectDocType(rawText);
  const schema = FIELD_SCHEMAS[type];
  const rawLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = deriveTitle(rawLines[0], TYPE_META[type].label);

  const fieldValues = {};
  schema.forEach((f) => { fieldValues[f.key] = []; });
  const catchAllKey = CATCH_ALL_KEY[type] || schema[schema.length - 1].key;

  // 첫 줄은 제목으로 소비하고 내용 추출 대상에서는 제외하지만, "9월 7일 월요일부터
  // 9월 9일 수요일까지 총 3일간 연차휴가를 신청하는 내용으로..."처럼 날짜 구간이
  // 첫 줄에만 적혀 있는 경우가 흔하므로 날짜 구간만은 별도로 건져낸다.
  const dateFieldSchema = schema.find((f) => f.isDateRange);
  if (dateFieldSchema) {
    const firstLineRange = extractDateRange(rawLines[0] || '');
    if (firstLineRange) fieldValues[dateFieldSchema.key].push(firstLineRange);
  }

  // 나머지 줄에서 라벨/단서 기반으로 항목을 채운다.
  rawLines.slice(1).forEach((line) => {
    const labelMatch = line.match(LABEL_LINE_RE);
    if (labelMatch) {
      const [, rawLabel, value] = labelMatch;
      const label = rawLabel.trim();
      const field = schema.find((f) => label.includes(f.label) || f.label.includes(label) || f.cues.some((re) => re.test(label)));
      if (field) {
        fieldValues[field.key].push(value.trim());
        return;
      }
    }

    const dateField = schema.find((f) => f.isDateRange);
    if (dateField) {
      const range = extractDateRange(line);
      if (range) {
        fieldValues[dateField.key].push(range);
        return;
      }
    }

    const cleanedLine = stripInstructionTail(line);
    if (cleanedLine.length < 2) return;

    // 문서 형식 자체를 지칭하는 줄("~계획서 양식으로")은 내용이 아니라 요청 문구로 판단해 건너뜀
    if (new RegExp(DOC_TYPE_NAMES).test(cleanedLine)) return;

    let matched = null;
    for (const field of schema) {
      if (field.cues.some((re) => re.test(cleanedLine))) {
        matched = field;
        break;
      }
    }

    const normalized = cleanedLine.replace(/[,，]\s*$/, '').replace(/\s+/g, '');
    if (matched && normalized === matched.label.replace(/\s+/g, '')) {
      // 필드 이름만 그대로 반복한 줄(예: "연락처,") -- 실제 내용이 없으므로 비워둔다.
      return;
    }

    let valueToStore = cleanedLine;
    if (matched && IDENTITY_FIELD_KEYS.includes(matched.key)) {
      valueToStore = extractIdentityValue(cleanedLine) || cleanedLine;
    }
    fieldValues[(matched || schema.find((f) => f.key === catchAllKey)).key].push(valueToStore);
  });

  const fields = { title };
  Object.keys(fieldValues).forEach((key) => {
    fields[key] = fieldValues[key].join('\n');
  });

  return { type, fields };
}

// ============================================================
// 문체(어투) 변환 -- 실제 문법 엔진이 아니라, 문장 끝맺음·항목화 방식·분량을
// 규칙 기반으로 바꾸는 근사치 변환이다. 세 문체가 실제로 다른 결과물이
// 되도록 (1) 표기 방식(불릿/연결어/평서문), (2) 분량(축약/유지/서술 확장),
// (3) 문장 끝맺음을 모두 다르게 처리한다. 사용자가 적지 않은 내용을
// 지어내지는 않는다 -- "상세"의 확장은 실제 항목을 더 풀어 쓰는 것이지
// 없는 정보를 추가하는 것이 아니다.
// ============================================================

const NOMINALIZE_MAP = [
  [/했습니다\.?$/, '함'],
  [/합니다\.?$/, '함'],
  [/됩니다\.?$/, '됨'],
  [/입니다\.?$/, '임'],
  [/있습니다\.?$/, '있음'],
  [/했다\.?$/, '함'],
  [/한다\.?$/, '함'],
];

// 사용자가 반말/구어체로 적어도 업무 문서는 정중한 보고체로 나가야 한다.
// 문법 엔진이 아니라 자주 쓰는 어미 위주의 근사치 치환이며, 더 구체적인
// 패턴을 먼저 검사해 일반적인 "-어요/-아요" 치환이 앞서 소비하지 않게 한다.
const CASUAL_TO_FORMAL_MAP = [
  [/하고\s*싶어(요)?\.?$/, '하고자 합니다'],
  [/싶어(요)?\.?$/, '하고자 합니다'],
  [/할\s*거예요\.?$/, '할 예정입니다'],
  [/거예요\.?$/, '예정입니다'],
  [/거야\.?$/, '예정입니다'],
  [/할게(요)?\.?$/, '하겠습니다'],
  [/야\s*돼(요)?\.?$/, '야 합니다'],
  [/돼(요)?\.?$/, '됩니다'],
  [/했었어(요)?\.?$/, '했었습니다'],
  [/했었다\.?$/, '했었습니다'],
  [/갔다\s*왔어(요)?\.?$/, '다녀왔습니다'],
  [/갔어(요)?\.?$/, '다녀왔습니다'],
  [/왔어(요)?\.?$/, '왔습니다'],
  [/줬어(요)?\.?$/, '주었습니다'],
  [/봤어(요)?\.?$/, '보았습니다'],
  [/좋아(요)?\.?$/, '좋습니다'],
  [/괜찮아(요)?\.?$/, '무방합니다'],
  [/했어(요)?\.?$/, '했습니다'],
  [/이었다\.?$/, '이었습니다'],
  [/였다\.?$/, '였습니다'],
  [/였어(요)?\.?$/, '였습니다'],
  [/했다\.?$/, '했습니다'],
  [/한다\.?$/, '합니다'],
  [/거든(요)?\.?$/, '습니다'],
  [/네(요)?\.?$/, '습니다'],
  [/([가-힣])야\.?$/, '$1입니다'],
  [/이에요\.?$/, '입니다'],
  [/예요\.?$/, '입니다'],
  [/에요\.?$/, '습니다'],
  [/아요\.?$/, '습니다'],
  [/어요\.?$/, '습니다'],
];

// "쉴래/보낼래/올릴래"처럼 "-ㄹ래" 어미는 동사 어간에 따라 받침이 다르게 붙으므로
// 단순 정규식 치환으로는 안 되고, 어미 앞 음절의 ㄹ 받침을 떼어낸 뒤 "겠습니다"를
// 붙여야 한다("할래" -> "하겠습니다"뿐 아니라 "쉴래" -> "쉬겠습니다"도 되게 하기 위함).
const RIEUL_LAE_RE = /래(요)?\.?$/;
function stripTrailingRieul(ch) {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return ch;
  const jong = code % 28;
  if (jong !== 8) return ch; // 순수 ㄹ 받침(8)이 아니면(겹받침 포함) 손대지 않는다.
  return String.fromCharCode(code - jong + 0xac00);
}
function formalizeRieulVolitional(line) {
  const m = RIEUL_LAE_RE.exec(line);
  if (!m || m.index < 1) return null;
  const idx = m.index - 1;
  const stemChar = stripTrailingRieul(line[idx]);
  if (stemChar === line[idx]) return null;
  return `${line.slice(0, idx)}${stemChar}겠습니다`;
}

function formalizeRegister(line) {
  const rieulLae = formalizeRieulVolitional(line);
  if (rieulLae) return rieulLae;
  let t = line;
  for (const [re, rep] of CASUAL_TO_FORMAL_MAP) {
    if (re.test(t)) {
      t = t.replace(re, rep);
      break;
    }
  }
  return t;
}

// 상세 문체에서 항목이 여럿일 때 문장 사이를 자연스럽게 잇는 연결어(위치 기반)
function detailedConnector(i, total) {
  if (total <= 1) return '';
  if (i === 0) return '먼저, ';
  if (i === total - 1) return '마지막으로, ';
  return '이어서, ';
}

// register: 'record'이면 회의록처럼 "논의함/결정함" 식 명사형 기록체 어미를 쓴다
// (문체 옵션과 별개로 문서 유형 자체의 정해진 어투이므로 formal/detailed에도 적용).
function applyTone(text, tone, register) {
  const items = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return '';

  const finish = (line) => {
    let t = formalizeRegister(line);
    if (register === 'record') {
      NOMINALIZE_MAP.forEach(([re, rep]) => {
        t = t.replace(re, rep);
      });
    }
    if (t && !/[.!?…]$/.test(t)) t += '.';
    return t;
  };

  if (tone === 'concise') {
    // 간결: 콤마 이전까지만, 명사형으로 축약, 짧게 자르고 불릿으로 -- 가장 분량이 짧다.
    return items
      .map((line) => {
        let t = formalizeRegister(line.split(/[,，]/)[0].trim());
        NOMINALIZE_MAP.forEach(([re, rep]) => {
          t = t.replace(re, rep);
        });
        if (t.length > 36) t = `${t.slice(0, 33).trim()}…`;
        return `• ${t}`;
      })
      .join('\n');
  }

  if (tone === 'detailed') {
    // 상세: 항목을 자르지 않고 완전한 문장으로, 연결어로 풀어써서 -- 가장 분량이 길다.
    return items
      .map((line, i) => detailedConnector(i, items.length) + finish(line))
      .join(' ');
  }

  // 공식적 (기본값): 평서문 마침표, 불릿/연결어 없이 표준 문어체
  return items.map((line) => finish(line)).join(' ');
}

// 문체와 무관하게 항상 짧은 불릿 목록으로 정리한다 (예: 계획서의 "기대효과").
function alwaysItemize(text, max) {
  const items = (text || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, max || 4);
  if (items.length === 0) return '';
  return items.map((t) => `• ${formalizeRegister(t).replace(/[.!?…]+$/, '')}`).join('\n');
}

// 문체와 무관하게 항상 짧게 유지한다 (예: 휴가신청서의 "사유"는 상세 문체를 골라도 장황해지면 안 됨).
function briefSentences(text, maxSentences) {
  const items = (text || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, maxSentences || 2);
  if (items.length === 0) return '';
  return items.map((line) => {
    const t = formalizeRegister(line);
    return /[.!?…]$/.test(t) ? t : `${t}.`;
  }).join(' ');
}

// 공문 본문 전용: 항목이 여럿이면 줄바꿈을 유지해 렌더러가 "가./나./다."로
// 나눠 그릴 수 있게 한다 (일반 문체 변환은 여러 줄을 한 문장으로 이어붙인다).
function buildOfficialBody(text, tone) {
  const items = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return '';
  if (tone === 'concise') {
    return items
      .map((line) => {
        let t = formalizeRegister(line.split(/[,，]/)[0].trim());
        NOMINALIZE_MAP.forEach(([re, rep]) => {
          t = t.replace(re, rep);
        });
        if (t.length > 36) t = `${t.slice(0, 33).trim()}…`;
        return t;
      })
      .join('\n');
  }
  return items
    .map((line) => {
      let t = formalizeRegister(line);
      if (t && !/[.!?…]$/.test(t)) t += '.';
      return t;
    })
    .join('\n');
}

// 상세 문체일 때만 항목 앞에 소제목에 맞는 도입 문장을 붙여 서술을 확장한다
// (분량 차이가 문장 다듬기 수준이 아니라 실제로 체감되도록).
const SECTION_LEAD_IN_RULES = [
  [/목적|배경/, '목적은 다음과 같습니다.'],
  [/안건/, '이번 안건은 다음과 같습니다.'],
  [/성과/, '주요 성과는 다음과 같습니다.'],
  [/결론|제언/, '이상의 내용을 종합하면 다음과 같습니다.'],
  [/결정사항/, '결정된 사항은 다음과 같습니다.'],
  [/사유/, '사유는 다음과 같습니다.'],
  [/효과/, '기대되는 효과는 다음과 같습니다.'],
  [/일정/, '일정은 다음과 같습니다.'],
];

function sectionLeadIn(heading) {
  const rule = SECTION_LEAD_IN_RULES.find(([re]) => re.test(heading));
  return rule ? rule[1] : '세부 내용은 다음과 같습니다.';
}

function buildSectionBody(heading, rawText, tone, register) {
  const toned = applyTone(rawText, tone, register);
  if (!toned) return '';
  return tone === 'detailed' ? `${sectionLeadIn(heading)}\n${toned}` : toned;
}

// ============================================================
// 문서 유형별 생성 로직 (템플릿 기반, 외부 AI 없이 규칙으로 조립)
// ============================================================

// 문서 유형별로 톤에 따라 달라지는 맺음말 (실제 업무 문서에서 흔히 쓰는 정형구).
const CLOSING_MAP = {
  memo: {
    formal: '위 사항에 대해 협조하여 주시기 바랍니다.',
    concise: '협조 요청드립니다.',
    detailed: '위와 같은 사항을 안내드리오니, 업무에 참고하시어 원활한 협조가 이루어질 수 있도록 부탁드립니다.',
  },
  meeting: {
    formal: '이상으로 회의를 마칩니다.',
    concise: '이상.',
    detailed: '이상 논의된 사항을 바탕으로 각 팀은 향후 일정에 따라 후속 조치를 진행하며, 필요 시 추가 회의를 통해 진행 상황을 점검하기로 하였습니다.',
  },
  report: {
    formal: '이상으로 보고를 마칩니다.',
    concise: '이상.',
    detailed: '이상의 내용을 종합적으로 검토한 결과를 바탕으로 향후 후속 조치 계획을 수립하여 순차적으로 추진할 예정입니다.',
  },
  tripReport: {
    formal: '이상으로 출장 결과를 보고합니다.',
    concise: '이상 보고합니다.',
    detailed: '이상의 출장 결과를 바탕으로 후속 조치를 차질 없이 진행하고, 필요한 사항은 관련 부서와 협의하여 추진하겠습니다.',
  },
  leaveRequest: {
    formal: '위와 같이 휴가를 신청합니다.',
    concise: '위와 같이 신청합니다.',
    detailed: '위 사유로 인해 휴가를 신청하오니 승인하여 주시기 바라며, 부재 기간 중 업무에 차질이 없도록 사전에 충분히 조치하겠습니다.',
  },
  plan: {
    formal: '위와 같이 계획을 수립하여 시행하고자 합니다.',
    concise: '이상 계획을 보고합니다.',
    detailed: '이상의 계획을 바탕으로 단계별 추진 상황을 지속적으로 점검하고, 필요 시 세부 일정을 조정하며 계획을 완수하고자 합니다.',
  },
};

function closingFor(type, tone) {
  const byTone = CLOSING_MAP[type];
  return byTone ? (byTone[tone] || byTone.formal) : null;
}

// 회의록: 기록형 문체("논의함/결정함")를 문체 옵션과 무관하게 사용하고,
// 결정사항·후속조치는 "반드시" 별도 항목으로 남긴다(비어 있어도 항목 자체는 유지).
function buildMeetingMinutes(f, tone) {
  const sections = [];
  if ((f.purpose || '').trim()) {
    sections.push({ id: uuid(), heading: '회의 목적', body: buildSectionBody('회의 목적', f.purpose, tone, 'record') });
  }
  if ((f.agenda || '').trim()) {
    sections.push({ id: uuid(), heading: '안건', body: buildSectionBody('안건', f.agenda, tone, 'record') });
  }
  sections.push({ id: uuid(), heading: '주요 논의 내용', body: buildSectionBody('주요 논의 내용', f.content, tone, 'record') || dummyFor('content') });
  sections.push({ id: uuid(), heading: '결정사항', body: buildSectionBody('결정사항', f.decisions, tone, 'record') || dummyFor('decisions') });
  sections.push({ id: uuid(), heading: '후속조치', body: buildSectionBody('후속조치', f.followup, tone, 'record') || dummyFor('followup') });

  const closingParts = [closingFor('meeting', tone)];
  if ((f.nextMeeting || '').trim()) closingParts.push(`다음 회의 일정: ${f.nextMeeting}`);

  return {
    title: f.title || TYPE_META.meeting.label,
    meta: [
      { label: '회의일시', value: checkField('meeting', f, 'date') },
      { label: '회의장소', value: checkField('meeting', f, 'place') },
      { label: '참석자', value: checkField('meeting', f, 'attendees') },
    ],
    sections,
    closing: closingParts.filter(Boolean).join(' '),
    footer: '',
  };
}

// 공문: 수신/제목 정보표 + 관련근거·본문·요청사항·제출기한·제출방법 번호매김 본문 +
// 붙임 + "끝." (붙임은 렌더러가 "끝." 바로 앞에 별도로 그린다).
function buildMemo(f, tone) {
  const sections = [];
  if ((f.reference || '').trim()) {
    sections.push({ id: uuid(), heading: '관련', body: applyTone(f.reference, 'formal') });
  }
  sections.push({ id: uuid(), heading: '내용', body: buildOfficialBody(f.content, tone) || dummyFor('content') });
  if ((f.requestContent || '').trim()) {
    sections.push({ id: uuid(), heading: '요청사항', body: buildOfficialBody(f.requestContent, tone) });
  }
  sections.push({ id: uuid(), heading: '제출기한', body: checkField('memo', f, 'deadline') });
  if ((f.submitMethod || '').trim()) {
    sections.push({ id: uuid(), heading: '제출방법', body: f.submitMethod });
  }

  return {
    title: f.title && f.title !== TYPE_META.memo.label ? f.title : dummyFor('title'),
    meta: [{ label: '수신', value: checkField('memo', f, 'recipient') }],
    sections,
    closing: closingFor('memo', tone),
    footer: f.contact || '',
    attachment: checkField('memo', f, 'attachment'),
  };
}

// 보고서: 두괄식 -- 목적 다음 핵심 결론(검토결과)을 먼저 배치하고, 이어서
// 현황/문제점/개선방안/향후계획 순으로 분석형으로 전개한다.
function buildReport(f, tone) {
  const sections = [];
  if ((f.purpose || '').trim()) {
    sections.push({ id: uuid(), heading: '보고 목적', body: buildSectionBody('보고 목적', f.purpose, tone) });
  }
  sections.push({
    id: uuid(),
    heading: '검토 결과',
    body: (f.reviewResult || '').trim() ? buildSectionBody('검토 결과', f.reviewResult, tone) : dummyFor('reviewResult'),
  });
  sections.push({ id: uuid(), heading: '주요 내용', body: buildSectionBody('주요 내용', f.content, tone) || dummyFor('content') });
  if ((f.progress || '').trim()) sections.push({ id: uuid(), heading: '추진 현황', body: buildSectionBody('추진 현황', f.progress, tone) });
  if ((f.problems || '').trim()) sections.push({ id: uuid(), heading: '문제점', body: buildSectionBody('문제점', f.problems, tone) });
  if ((f.improvement || '').trim()) sections.push({ id: uuid(), heading: '개선방안', body: buildSectionBody('개선방안', f.improvement, tone) });
  if ((f.futurePlan || '').trim()) sections.push({ id: uuid(), heading: '향후 계획', body: buildSectionBody('향후 계획', f.futurePlan, tone) });
  if ((f.notes || '').trim()) sections.push({ id: uuid(), heading: '특이사항', body: buildSectionBody('특이사항', f.notes, tone) });

  return {
    title: f.title || TYPE_META.report.label,
    meta: [
      { label: '보고대상', value: checkField('report', f, 'reportTarget') },
      { label: '보고자', value: checkField('report', f, 'author') },
      { label: '보고일자', value: f.date || '' },
    ],
    sections,
    closing: closingFor('report', tone),
    footer: '',
  };
}

// 안내문: 공문보다 친절한 어투. 신청/참여 방법과 문의처는 비어 있으면 더미 값 대상.
function buildNotice(f, tone) {
  const sections = [
    { id: uuid(), heading: '안내 목적', body: buildSectionBody('안내 목적', f.purpose, tone) || dummyFor('purpose') },
    { id: uuid(), heading: '주요 내용', body: buildSectionBody('주요 내용', f.content, tone) || dummyFor('content') },
    {
      id: uuid(),
      heading: '신청/참여 방법',
      body: (f.method || '').trim() ? buildSectionBody('신청 방법', f.method, tone) : dummyFor('method'),
    },
  ];
  if ((f.notes || '').trim()) {
    sections.push({ id: uuid(), heading: '유의사항', body: buildSectionBody('유의사항', f.notes, tone) });
  }

  const closingPhraseMap = {
    formal: '아래 내용을 확인해 주시기 바랍니다.',
    concise: '확인 부탁드립니다.',
    detailed: '자세한 사항은 아래 내용을 꼼꼼히 확인해 주시기 바라며, 궁금한 점이 있으면 문의처로 편하게 연락해 주세요.',
  };

  return {
    title: f.title || TYPE_META.notice.label,
    meta: [
      { label: '안내대상', value: checkField('notice', f, 'target') },
      { label: '기간', value: checkField('notice', f, 'period') },
      { label: '장소', value: f.place || '' },
    ],
    sections,
    closing: `${closingPhraseMap[tone] || closingPhraseMap.formal} (문의처: ${checkField('notice', f, 'inquiry')})`,
    footer: '',
  };
}

// 출장보고서: 사실/결과 중심. 출장 결과와 향후 조치는 "반드시" 포함(비어 있으면 더미 값).
function buildTripReport(f, tone) {
  const sections = [];
  if ((f.purpose || '').trim()) sections.push({ id: uuid(), heading: '출장 목적', body: buildSectionBody('출장 목적', f.purpose, tone) });
  if ((f.schedule || '').trim()) sections.push({ id: uuid(), heading: '주요 일정', body: buildSectionBody('주요 일정', f.schedule, tone) });
  sections.push({ id: uuid(), heading: '수행 내용', body: buildSectionBody('수행 내용', f.activities, tone) || dummyFor('activities') });
  if ((f.negotiations || '').trim()) {
    sections.push({ id: uuid(), heading: '주요 협의사항', body: buildSectionBody('주요 협의사항', f.negotiations, tone) });
  }
  sections.push({
    id: uuid(),
    heading: '출장 결과',
    body: (f.outcome || '').trim() ? buildSectionBody('출장 결과', f.outcome, tone) : dummyFor('outcome'),
  });
  sections.push({
    id: uuid(),
    heading: '향후 조치',
    body: (f.followup || '').trim() ? buildSectionBody('향후 조치', f.followup, tone) : dummyFor('followup'),
  });
  if ((f.notes || '').trim()) sections.push({ id: uuid(), heading: '특이사항', body: buildSectionBody('특이사항', f.notes, tone) });

  return {
    title: f.title || TYPE_META.tripReport.label,
    meta: [
      { label: '출장자', value: checkField('tripReport', f, 'traveler') },
      { label: '출장기간', value: checkField('tripReport', f, 'period') },
      { label: '출장지', value: checkField('tripReport', f, 'destination') },
      { label: '방문기관', value: checkField('tripReport', f, 'visitOrg') },
    ],
    sections,
    closing: closingFor('tripReport', tone),
    footer: '',
  };
}

// 휴가신청서: 사유는 문체와 무관하게 항상 1~2문장으로 짧게 유지한다.
function buildLeaveRequest(f, tone) {
  const sections = [
    { id: uuid(), heading: '휴가 사유', body: briefSentences(f.reason, 2) || dummyFor('reason') },
  ];
  if ((f.handover || '').trim()) {
    sections.push({ id: uuid(), heading: '업무 인수인계 내용', body: buildSectionBody('업무 인수인계 내용', f.handover, tone) });
  }
  if ((f.emergencyContact || '').trim()) {
    sections.push({ id: uuid(), heading: '비상연락', body: buildSectionBody('비상연락', f.emergencyContact, tone) });
  }
  return {
    title: f.title || TYPE_META.leaveRequest.label,
    meta: [
      { label: '신청자', value: checkField('leaveRequest', f, 'applicant') },
      { label: '소속', value: checkField('leaveRequest', f, 'department') },
      { label: '직급', value: f.position || '' },
      { label: '신청일', value: f.applyDate || '' },
      { label: '휴가기간', value: checkField('leaveRequest', f, 'period') },
      { label: '휴가일수', value: f.days || '' },
      { label: '휴가종류', value: f.leaveType || '' },
    ],
    sections,
    closing: closingFor('leaveRequest', tone),
    footer: '',
  };
}

// 업무인수인계서: 실무 중심 표 형태. 모든 항목(인계자/인수자/일자 및 각 섹션)은
// 입력에 없으면 더미 값으로 채워 빈 칸 없이 나온다.
function buildHandover(f, tone) {
  const sectionDefs = [
    ['targetDuties', '인수인계 대상 업무'],
    ['progress', '업무별 진행 현황'],
    ['remainingWork', '남은 작업'],
    ['materialsLocation', '관련 자료 위치'],
    ['contact', '주요 연락처'],
    ['notes', '주의사항'],
    ['schedule', '향후 일정'],
  ];
  return {
    title: f.title || TYPE_META.handover.label,
    meta: [
      { label: '인계자', value: checkField('handover', f, 'handoverFrom') },
      { label: '인수자', value: checkField('handover', f, 'handoverTo') },
      { label: '인수인계일', value: checkField('handover', f, 'handoverDate') },
    ],
    sections: sectionDefs.map(([key, heading]) => ({
      id: uuid(),
      heading,
      body: buildSectionBody(heading, f[key], tone) || dummyFor(key),
    })),
    closing: null,
    footer: '',
  };
}

// 계획서: 배경→목적→대상→내용→일정→기대효과→유의사항→향후계획 순. 기대효과는
// 문체와 무관하게 항상 2~4개 항목으로 정리하고, 실행계획처럼 보이도록 일정/대상/
// 기대효과가 비어 있으면 더미 값으로 채운다.
function buildPlan(f, tone) {
  const sections = [];
  if ((f.background || '').trim()) sections.push({ id: uuid(), heading: '추진 배경', body: buildSectionBody('추진 배경', f.background, tone) });
  if ((f.purpose || '').trim()) sections.push({ id: uuid(), heading: '추진 목적', body: buildSectionBody('추진 목적', f.purpose, tone) });
  sections.push({
    id: uuid(),
    heading: '적용 대상',
    body: (f.target || '').trim() ? buildSectionBody('적용 대상', f.target, tone) : dummyFor('target'),
  });
  if ((f.content || '').trim()) sections.push({ id: uuid(), heading: '주요 추진 내용', body: buildSectionBody('주요 추진 내용', f.content, tone) });
  sections.push({
    id: uuid(),
    heading: '추진 일정',
    body: (f.schedule || '').trim() ? buildSectionBody('추진 일정', f.schedule, tone) : dummyFor('schedule'),
  });
  sections.push({
    id: uuid(),
    heading: '기대효과',
    body: (f.expectedEffect || '').trim() ? alwaysItemize(f.expectedEffect, 4) : dummyFor('expectedEffect'),
  });
  if ((f.notes || '').trim()) sections.push({ id: uuid(), heading: '유의사항', body: buildSectionBody('유의사항', f.notes, tone) });
  if ((f.futurePlan || '').trim()) sections.push({ id: uuid(), heading: '향후 계획', body: buildSectionBody('향후 계획', f.futurePlan, tone) });

  return {
    title: f.title || TYPE_META.plan.label,
    meta: [],
    sections,
    closing: closingFor('plan', tone),
    footer: '',
  };
}

const DOC_BUILDERS = {
  tripReport: buildTripReport,
  leaveRequest: buildLeaveRequest,
  handover: buildHandover,
  plan: buildPlan,
  meeting: buildMeetingMinutes,
  memo: buildMemo,
  report: buildReport,
  notice: buildNotice,
};

function buildDocument(type, fields, tone) {
  return (DOC_BUILDERS[type] || buildReport)(fields, tone);
}

// ============================================================
// 상태 / 단계 이동
// ============================================================

const state = {
  docType: 'report',
  tone: 'formal',
  document: null,
};

const steps = document.querySelectorAll('.step');
const panels = document.querySelectorAll('.panel');

function goToStep(n) {
  steps.forEach((el) => el.classList.toggle('active', Number(el.dataset.step) === n));
  panels.forEach((el) => el.classList.toggle('active', el.id === `panel-${n}`));
}

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => goToStep(Number(btn.dataset.back)));
});

// --- 문체 도움말 팝업 ---
const HELP_CONTENT = {
  tone: {
    title: '문체',
    items: [
      { label: '공식적', desc: '문장을 정중한 서술형으로 정리하고, 문서 유형에 맞는 맺음말을 추가합니다.' },
      { label: '간결', desc: '핵심만 짧게 항목(bullet)으로 정리합니다.' },
      { label: '상세', desc: '항목에 순서를 매겨 이어지는 문장으로 풀어씁니다.' },
    ],
  },
};

const helpModalOverlay = document.getElementById('helpModalOverlay');
const helpModalTitle = document.getElementById('helpModalTitle');
const helpModalList = document.getElementById('helpModalList');

function openHelpModal(key) {
  const content = HELP_CONTENT[key];
  if (!content) return;
  helpModalTitle.textContent = content.title;
  helpModalList.innerHTML = '';
  content.items.forEach((item) => {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = item.label;
    const span = document.createElement('span');
    span.textContent = item.desc;
    li.appendChild(strong);
    li.appendChild(span);
    helpModalList.appendChild(li);
  });
  helpModalOverlay.hidden = false;
}
function closeHelpModal() {
  helpModalOverlay.hidden = true;
}
document.querySelectorAll('.help-icon[data-help]').forEach((btn) => {
  btn.addEventListener('click', () => openHelpModal(btn.dataset.help));
});
document.getElementById('helpModalClose').addEventListener('click', closeHelpModal);
helpModalOverlay.addEventListener('click', (e) => {
  if (e.target === helpModalOverlay) closeHelpModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !helpModalOverlay.hidden) closeHelpModal();
});

// ============================================================
// Step 1: 정보입력 (자유 텍스트 + 자동 감지된 문서 유형)
// ============================================================

const freeTextInput = document.getElementById('freeTextInput');
const freeTextCounter = document.getElementById('freeTextCounter');
const detectedTag = document.getElementById('detectedTag');
const formError = document.getElementById('formError');
const toStep2 = document.getElementById('toStep2');

const MIN_FREETEXT_CHARS = 15;
let userOverrodeType = false;

function setDocTypeRadio(type) {
  const radio = document.querySelector(`input[name="docType"][value="${type}"]`);
  if (radio) radio.checked = true;
}

function updateStep1Button() {
  toStep2.disabled = freeTextInput.value.trim().length < MIN_FREETEXT_CHARS;
}

freeTextInput.addEventListener('input', () => {
  const len = freeTextInput.value.trim().length;
  freeTextCounter.textContent = `${len}자 / 최소 ${MIN_FREETEXT_CHARS}자`;
  freeTextCounter.classList.toggle('ok', len >= MIN_FREETEXT_CHARS);
  updateStep1Button();
  formError.textContent = '';

  if (!userOverrodeType && len > 0) {
    const detected = detectDocType(freeTextInput.value);
    setDocTypeRadio(detected);
    detectedTag.textContent = `감지됨: ${TYPE_META[detected].label}`;
  } else if (len === 0) {
    detectedTag.textContent = '입력하면 자동 감지';
  }
});

document.querySelectorAll('input[name="docType"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    userOverrodeType = true;
    detectedTag.textContent = '직접 선택함';
  });
});

toStep2.addEventListener('click', () => {
  const rawText = freeTextInput.value.trim();
  if (rawText.length < MIN_FREETEXT_CHARS) {
    formError.textContent = `최소 ${MIN_FREETEXT_CHARS}자 이상 입력해주세요.`;
    return;
  }
  formError.textContent = '';

  const selectedType = document.querySelector('input[name="docType"]:checked').value;
  const { fields } = parseFreeText(rawText, selectedType);
  state.docType = selectedType;
  state.tone = document.querySelector('input[name="tone"]:checked').value;
  state.document = buildDocument(state.docType, fields, state.tone);
  renderSectionCards();
  goToStep(2);
});

updateStep1Button();

// ============================================================
// Step 2: 초안생성 (편집 가능한 플레인 섹션 카드)
// ============================================================

const sectionList = document.getElementById('sectionList');
const regenerateBtn = document.getElementById('regenerateBtn');
const toStep3 = document.getElementById('toStep3');

function renderSectionCards() {
  sectionList.innerHTML = '';
  state.document.sections.forEach((section) => {
    const li = document.createElement('li');
    li.className = 'section-card';

    const header = document.createElement('div');
    header.className = 'section-card-header';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'section-title-input';
    titleInput.value = section.heading;
    titleInput.setAttribute('aria-label', '섹션 제목');
    titleInput.addEventListener('input', () => {
      section.heading = titleInput.value;
    });
    header.appendChild(titleInput);

    const bodyTextarea = document.createElement('textarea');
    bodyTextarea.className = 'section-body-textarea';
    bodyTextarea.value = section.body;
    bodyTextarea.setAttribute('aria-label', '섹션 본문');
    bodyTextarea.addEventListener('input', () => {
      section.body = bodyTextarea.value;
    });

    li.appendChild(header);
    li.appendChild(bodyTextarea);
    sectionList.appendChild(li);
  });
}

regenerateBtn.addEventListener('click', () => {
  const ok = window.confirm('정보를 다시 입력하면 지금까지 수정한 초안 내용이 사라집니다. 계속하시겠습니까?');
  if (!ok) return;
  goToStep(1);
});

toStep3.addEventListener('click', () => {
  renderPreview();
  goToStep(3);
});

// ============================================================
// Step 3: 미리보기 (문서 서식 적용, 읽기전용)
// ============================================================

const docPreview = document.getElementById('docPreview');
const toStep4 = document.getElementById('toStep4');

function findMeta(doc, label) {
  const m = doc.meta.find((x) => x.label === label);
  return m ? m.value : '';
}

// 유형별로 실제 사용되는 문서 서식이 다르므로 서식 계열로 나눠 렌더링한다:
// official(공문 - 수신·제목 정보표 + 번호매김 본문 + 가/나/다 + "끝." 표기, 발신명의로 결재 대체),
// minutes(회의록·출장보고서 - 개요 정보표 + 안건/항목별 서술),
// leave(휴가신청서 - 신청 정보표 + 사유),
// report(보고서·계획서 - 로마자 번호 소제목),
// notice(안내문 - 테두리 박스 + 중앙정렬),
// table(업무인수인계서 - 실제 사내 양식처럼 표 형태).
// 공문·안내문을 제외한 모든 유형은 제목 영역 우측 상단에 담당/팀장/부서장 결재란을 공통으로 표시한다.
const FORMAT_FAMILY = {
  memo: 'official',
  meeting: 'minutes',
  tripReport: 'minutes',
  report: 'report',
  plan: 'report',
  notice: 'notice',
  leaveRequest: 'leave',
  handover: 'table',
};

const ROMAN_NUMERALS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ'];

function appendTitleBlock(doc) {
  const header = document.createElement('div');
  header.className = 'doc-header doc-header--with-approval';
  header.appendChild(buildApprovalBox());
  const title = document.createElement('h2');
  title.className = 'doc-title';
  title.textContent = doc.title;
  header.appendChild(title);
  const underline = document.createElement('div');
  underline.className = 'doc-underline';
  header.appendChild(underline);
  docPreview.appendChild(header);
}

function formTableRow(label, value) {
  const tr = document.createElement('tr');
  const td1 = document.createElement('td');
  td1.className = 'form-table-label';
  td1.textContent = label;
  const td2 = document.createElement('td');
  td2.className = 'form-table-value';
  td2.textContent = value;
  tr.appendChild(td1);
  tr.appendChild(td2);
  return tr;
}

function appendMetaTable(doc) {
  const filled = doc.meta.filter((m) => m.value);
  if (filled.length === 0) return;
  const table = document.createElement('table');
  table.className = 'doc-meta-table';
  const tbody = document.createElement('tbody');
  filled.forEach((m) => tbody.appendChild(formTableRow(m.label, m.value)));
  table.appendChild(tbody);
  docPreview.appendChild(table);
}

function appendClosing(doc) {
  if (!doc.closing) return;
  const closing = document.createElement('p');
  closing.className = 'doc-closing';
  closing.textContent = doc.closing;
  docPreview.appendChild(closing);
}

function appendPlainSection(container, section, headingPrefixEl) {
  const wrap = document.createElement('div');
  wrap.className = 'doc-section';
  const h = document.createElement('h3');
  h.className = 'doc-section-heading';
  if (headingPrefixEl) h.appendChild(headingPrefixEl);
  h.appendChild(document.createTextNode(section.heading));
  const body = document.createElement('p');
  body.className = 'doc-section-body';
  body.textContent = section.body;
  wrap.appendChild(h);
  wrap.appendChild(body);
  container.appendChild(wrap);
}

// --- official: 공문 서식 (수신/제목 정보표 + 번호매김 본문 + 가/나/다 하위항목 +
// 붙임 + "끝." 표기) ---
const SUB_LETTERS = ['가', '나', '다', '라', '마', '바', '사', '아'];

function renderOfficialFormat(doc) {
  const title = document.createElement('h2');
  title.className = 'doc-title';
  title.textContent = doc.title;
  docPreview.appendChild(title);

  const infoTable = document.createElement('table');
  infoTable.className = 'official-info-table';
  const infoBody = document.createElement('tbody');
  infoBody.appendChild(formTableRow('수신', findMeta(doc, '수신') || dummyFor('recipient')));
  infoBody.appendChild(formTableRow('제목', doc.title));
  infoTable.appendChild(infoBody);
  docPreview.appendChild(infoTable);

  const body = document.createElement('div');
  body.className = 'official-body';
  doc.sections.forEach((section, i) => {
    const lines = (section.body || '').split('\n').filter(Boolean);
    const p = document.createElement('p');
    p.className = 'official-numbered-para';
    const marker = document.createElement('span');
    marker.className = 'official-number';
    marker.textContent = `${i + 1}. `;
    p.appendChild(marker);
    const label = document.createElement('strong');
    label.textContent = section.heading;
    p.appendChild(label);
    if (lines.length <= 1) {
      p.appendChild(document.createTextNode(`: ${lines[0] || ''}`));
      body.appendChild(p);
    } else {
      body.appendChild(p);
      const subList = document.createElement('div');
      subList.className = 'official-sub-list';
      lines.forEach((line, li) => {
        const subP = document.createElement('p');
        subP.className = 'official-sub-item';
        const subMarker = document.createElement('span');
        subMarker.className = 'official-number';
        subMarker.textContent = `${SUB_LETTERS[li] || li + 1}. `;
        subP.appendChild(subMarker);
        subP.appendChild(document.createTextNode(line));
        subList.appendChild(subP);
      });
      body.appendChild(subList);
    }
  });
  if (doc.closing) {
    const closingP = document.createElement('p');
    closingP.className = 'official-numbered-para';
    closingP.textContent = doc.closing;
    body.appendChild(closingP);
  }
  docPreview.appendChild(body);

  if (doc.attachment) {
    const attach = document.createElement('p');
    attach.className = 'official-attachment';
    attach.textContent = `붙임  ${doc.attachment}`;
    docPreview.appendChild(attach);
  }

  const endMark = document.createElement('p');
  endMark.className = 'official-end-mark';
  endMark.textContent = '끝.';
  docPreview.appendChild(endMark);

  if (doc.footer) {
    const footer = document.createElement('div');
    footer.className = 'official-signature';
    footer.textContent = `담당자  ${doc.footer}`;
    docPreview.appendChild(footer);
  }
}

// --- minutes: 회의록/출장보고서 서식 (개요 정보표 + 항목별 서술) ---
function renderMinutesFormat(doc) {
  appendTitleBlock(doc);
  appendMetaTable(doc);
  doc.sections.forEach((section) => appendPlainSection(docPreview, section));
  appendClosing(doc);
}

// --- 결재란: 담당/팀장/부서장 (제목 영역 우측 상단에 배치, official·notice 제외 전 유형 공통) ---
function buildApprovalBox() {
  const slot = document.createElement('div');
  slot.className = 'approval-slot';
  const table = document.createElement('table');
  table.className = 'approval-box';
  const tbody = document.createElement('tbody');
  const roleRow = document.createElement('tr');
  const signRow = document.createElement('tr');
  const corner = document.createElement('td');
  corner.className = 'approval-corner';
  corner.rowSpan = 2;
  corner.textContent = '결재';
  roleRow.appendChild(corner);
  ['담당', '팀장', '부서장'].forEach((role) => {
    const th = document.createElement('td');
    th.className = 'approval-role';
    th.textContent = role;
    roleRow.appendChild(th);
    const td = document.createElement('td');
    td.className = 'approval-sign';
    signRow.appendChild(td);
  });
  tbody.appendChild(roleRow);
  tbody.appendChild(signRow);
  table.appendChild(tbody);
  slot.appendChild(table);
  return slot;
}

// --- leave: 휴가신청서 서식 (신청 정보표 + 사유) ---
function renderLeaveFormat(doc) {
  appendTitleBlock(doc);
  appendMetaTable(doc);
  doc.sections.forEach((section) => appendPlainSection(docPreview, section));
  appendClosing(doc);
}

// --- report: 보고서/계획서 서식 (로마자 번호 소제목) ---
function renderReportFormat(doc) {
  appendTitleBlock(doc);
  appendMetaTable(doc);
  doc.sections.forEach((section, i) => {
    const marker = document.createElement('span');
    marker.className = 'roman-marker';
    marker.textContent = `${ROMAN_NUMERALS[i] || i + 1}. `;
    appendPlainSection(docPreview, section, marker);
  });
  appendClosing(doc);
}

// --- notice: 안내문 서식 (테두리 박스 + 중앙정렬) ---
function renderNoticeFormat(doc) {
  const box = document.createElement('div');
  box.className = 'notice-box';

  const title = document.createElement('h2');
  title.className = 'doc-title';
  title.textContent = doc.title;
  box.appendChild(title);
  const underline = document.createElement('div');
  underline.className = 'doc-underline';
  box.appendChild(underline);

  const filled = doc.meta.filter((m) => m.value);
  if (filled.length > 0) {
    const metaLine = document.createElement('p');
    metaLine.className = 'notice-meta-line';
    metaLine.textContent = filled.map((m) => `${m.label}: ${m.value}`).join('   |   ');
    box.appendChild(metaLine);
  }

  doc.sections.forEach((section) => appendPlainSection(box, section));
  docPreview.appendChild(box);

  if (doc.closing) {
    const closing = document.createElement('p');
    closing.className = 'notice-inquiry-box';
    closing.textContent = doc.closing;
    docPreview.appendChild(closing);
  }
}

// --- table: 출장보고서/휴가신청서/업무인수인계서 서식 (사내 양식처럼 표 형태) ---
function renderTableFormat(doc) {
  appendTitleBlock(doc);

  const table = document.createElement('table');
  table.className = 'doc-form-table';
  const tbody = document.createElement('tbody');
  doc.meta.filter((m) => m.value).forEach((m) => tbody.appendChild(formTableRow(m.label, m.value)));
  doc.sections.forEach((section) => tbody.appendChild(formTableRow(section.heading, section.body || '-')));
  table.appendChild(tbody);
  docPreview.appendChild(table);

  appendClosing(doc);
}

const FORMAT_RENDERERS = {
  official: renderOfficialFormat,
  minutes: renderMinutesFormat,
  leave: renderLeaveFormat,
  report: renderReportFormat,
  notice: renderNoticeFormat,
  table: renderTableFormat,
};

function renderPreview() {
  const doc = state.document;
  docPreview.innerHTML = '';
  const family = FORMAT_FAMILY[state.docType] || 'report';
  docPreview.className = `doc-preview-wrap format-${family}`;
  (FORMAT_RENDERERS[family] || renderReportFormat)(doc);
}

toStep4.addEventListener('click', () => {
  goToStep(4);
});

// ============================================================
// Step 4: 다운로드 (DOCX / PDF)
// ============================================================

const downloadDocxBtn = document.getElementById('downloadDocxBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const restartBtn = document.getElementById('restartBtn');

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function buildDocxBlob() {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  } = window.docx;
  const doc = state.document;
  const FONT = '맑은 고딕';
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: doc.title, font: FONT })],
    }),
  ];

  if (doc.meta && doc.meta.some((m) => m.value)) {
    doc.meta.filter((m) => m.value).forEach((m) => {
      children.push(new Paragraph({ children: [new TextRun({ text: `${m.label}: ${m.value}`, font: FONT })] }));
    });
    children.push(new Paragraph({ children: [new TextRun({ text: '', font: FONT })] }));
  }

  doc.sections.forEach((section) => {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: section.heading, font: FONT })],
    }));
    (section.body || '').split('\n').filter(Boolean).forEach((line) => {
      children.push(new Paragraph({ children: [new TextRun({ text: line, font: FONT })] }));
    });
  });

  if (doc.attachment) {
    children.push(new Paragraph({ children: [new TextRun({ text: `붙임  ${doc.attachment}`, font: FONT })] }));
  }
  if (doc.closing) {
    children.push(new Paragraph({ children: [new TextRun({ text: doc.closing, font: FONT })] }));
  }
  if (doc.footer) {
    children.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: doc.footer, font: FONT })],
    }));
  }

  const wordDoc = new Document({ sections: [{ properties: {}, children }] });
  return Packer.toBlob(wordDoc);
}

let fontBufCache = null;
async function loadPdfFonts() {
  if (fontBufCache) return fontBufCache;
  const [regular, bold] = await Promise.all([
    fetch('vendor/Pretendard-Regular.woff2').then((r) => r.arrayBuffer()),
    fetch('vendor/Pretendard-Bold.woff2').then((r) => r.arrayBuffer()),
  ]);
  fontBufCache = { regular, bold };
  return fontBufCache;
}

async function buildPdfBlob() {
  const fonts = await loadPdfFonts();
  const doc = state.document;

  return new Promise((resolve, reject) => {
    const pdf = new window.PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
    pdf.on('error', reject);

    pdf.registerFont('Pretendard', fonts.regular);
    pdf.registerFont('Pretendard-Bold', fonts.bold);

    pdf.font('Pretendard-Bold').fontSize(20).text(doc.title, { align: 'center' });
    pdf.moveDown();

    if (doc.meta && doc.meta.some((m) => m.value)) {
      pdf.font('Pretendard').fontSize(11).fillColor('#6b7280');
      doc.meta.filter((m) => m.value).forEach((m) => {
        pdf.text(`${m.label}: ${m.value}`);
      });
      pdf.fillColor('#1f2430');
      pdf.moveDown();
    }

    doc.sections.forEach((section) => {
      pdf.font('Pretendard-Bold').fontSize(13).text(section.heading);
      pdf.moveDown(0.3);
      pdf.font('Pretendard').fontSize(11.5).text(section.body, { lineGap: 4 });
      pdf.moveDown();
    });

    if (doc.attachment) {
      pdf.font('Pretendard').fontSize(11).text(`붙임  ${doc.attachment}`);
      pdf.moveDown(0.5);
    }
    if (doc.closing) {
      pdf.font('Pretendard').fontSize(12).text(doc.closing, { align: 'center' });
    }
    if (doc.footer) {
      pdf.moveDown();
      pdf.font('Pretendard').fontSize(11).text(doc.footer, { align: 'right' });
    }

    pdf.end();
  });
}

downloadDocxBtn.addEventListener('click', async () => {
  downloadDocxBtn.disabled = true;
  try {
    const blob = await buildDocxBlob();
    triggerDownload(blob, `${state.document.title || '문서'}.docx`);
  } catch (err) {
    alert(`DOCX 생성 실패: ${err.message}`);
  } finally {
    downloadDocxBtn.disabled = false;
  }
});

downloadPdfBtn.addEventListener('click', async () => {
  downloadPdfBtn.disabled = true;
  try {
    const blob = await buildPdfBlob();
    triggerDownload(blob, `${state.document.title || '문서'}.pdf`);
  } catch (err) {
    alert(`PDF 생성 실패: ${err.message}`);
  } finally {
    downloadPdfBtn.disabled = false;
  }
});

restartBtn.addEventListener('click', () => {
  state.docType = 'report';
  state.tone = 'formal';
  state.document = null;
  userOverrodeType = false;
  freeTextInput.value = '';
  freeTextCounter.textContent = `0자 / 최소 ${MIN_FREETEXT_CHARS}자`;
  freeTextCounter.classList.remove('ok');
  detectedTag.textContent = '입력하면 자동 감지';
  setDocTypeRadio('report');
  document.querySelector('input[name="tone"][value="formal"]').checked = true;
  formError.textContent = '';
  updateStep1Button();
  sectionList.innerHTML = '';
  docPreview.innerHTML = '';
  goToStep(1);
});
