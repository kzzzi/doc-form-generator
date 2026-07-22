const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

// ============================================================
// 문서 유형 감지 + 자유 텍스트에서 필드 추출
// (구조화된 입력폼 대신, 사용자가 편하게 적은 자유 텍스트 한 덩어리에서
//  문서 유형과 각 항목 값을 규칙 기반으로 뽑아낸다. LLM을 쓰지 않으므로
//  "라벨: 값" 형태의 명시적 표기나 흔한 키워드 단서에 의존하며, 단서를
//  못 찾은 내용은 지어내지 않고 빈 칸으로 남겨 사용자가 다음 단계에서
//  직접 채우도록 한다.)
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
  { type: 'leaveRequest', patterns: [/휴가|연차/] },
  { type: 'handover', patterns: [/인수인계/] },
  { type: 'plan', patterns: [/계획서|계획을|추진\s*계획/] },
  { type: 'meeting', patterns: [/회의록|착수\s*회의|킥오프|회의를/] },
  { type: 'memo', patterns: [/공문|협조\s*요청/] },
  { type: 'notice', patterns: [/안내문/] },
  { type: 'report', patterns: [/보고서|결과\s*보고/] },
];

function detectDocType(text) {
  for (const { type, patterns } of TYPE_DETECTORS) {
    if (patterns.some((re) => re.test(text))) return type;
  }
  return 'report';
}

// 유형별 필드 추출 스키마: label(라벨:값 매칭용) + cues(키워드 단서, 없으면 catch-all로 처리)
const FIELD_SCHEMAS = {
  tripReport: [
    { key: 'destination', label: '출장지', cues: [/출장지/] },
    { key: 'period', label: '기간', cues: [/기간/], isDateRange: true },
    { key: 'purpose', label: '목적', cues: [/목적/] },
    { key: 'outcome', label: '성과', cues: [/성과/] },
    { key: 'followup', label: '후속조치', cues: [/후속\s*조치/] },
  ],
  leaveRequest: [
    { key: 'period', label: '기간', cues: [/기간/], isDateRange: true },
    { key: 'reason', label: '사유', cues: [/사유|여행|개인\s*사정|가족/] },
    { key: 'handover', label: '인수인계', cues: [/인수인계/] },
    { key: 'emergencyContact', label: '비상연락', cues: [/비상\s*연락|긴급\s*연락/] },
  ],
  handover: [
    { key: 'currentDuties', label: '현재 담당 업무', cues: [/담당\s*업무/] },
    { key: 'ongoingProjects', label: '진행 중인 프로젝트', cues: [/진행\s*중인?\s*프로젝트|프로젝트/] },
    { key: 'notes', label: '주의사항', cues: [/주의\s*사항/] },
    { key: 'contact', label: '연락처', cues: [/연락처/] },
    { key: 'schedule', label: '향후 일정', cues: [/향후\s*일정/] },
  ],
  plan: [
    { key: 'purpose', label: '도입 목적', cues: [/목적/] },
    { key: 'target', label: '적용 대상', cues: [/대상/] },
    { key: 'expectedEffect', label: '예상 효과', cues: [/효과/] },
    { key: 'schedule', label: '추진 일정', cues: [/일정/] },
  ],
  meeting: [
    { key: 'attendees', label: '참석자', cues: [/참석자/] },
    { key: 'decisions', label: '결정사항', cues: [/하기로\s*(했|했어|했습니다)|일정은/] },
    { key: 'content', label: '논의 내용', cues: [] },
  ],
  memo: [
    { key: 'recipient', label: '수신', cues: [/수신/] },
    { key: 'purpose', label: '목적', cues: [/목적/] },
    { key: 'content', label: '내용', cues: [] },
  ],
  report: [
    { key: 'purpose', label: '목적', cues: [/목적|배경/] },
    { key: 'content', label: '내용', cues: [] },
  ],
  notice: [
    { key: 'target', label: '대상', cues: [/대상/] },
    { key: 'purpose', label: '목적', cues: [/목적/] },
    { key: 'content', label: '내용', cues: [] },
  ],
};

const DOC_TYPE_NAMES = '회의록|공문|보고서|안내문|계획서|인수인계서|휴가\\s*신청서|출장\\s*보고서';
const INSTRUCTION_VERBS = '만들어\\s*줘|만들어줘|만들고\\s*싶어|만들고자\\s*합니다|정리하고\\s*싶어|정리해야\\s*합니다|정리하려고\\s*합니다|작성해\\s*주세요|작성해주세요|부탁드립니다|하나\\s*만들어줘';
const LABEL_LINE_RE = /^([가-힣A-Za-z ]{1,12})\s*[:：]\s*(.+)$/;
const DATE_RANGE_RE = /(\d{1,2}\s*월\s*)?(\d{1,2}\s*일)\s*(?:부터|~|-|에서)\s*(\d{1,2}\s*월\s*)?(\d{1,2}\s*일)\s*(?:까지)?/;

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

function deriveTitle(firstLine, typeLabel) {
  const cleaned = stripInstructionTail(firstLine || '').replace(/[,，]?\s*(이|가|은|는|을|를)\s*$/, '').trim();
  return cleaned.length >= 2 ? cleaned : typeLabel;
}

function extractDateRange(line) {
  const m = line.match(DATE_RANGE_RE);
  return m ? m[0].replace(/\s+/g, '') : null;
}

// 자유 텍스트 한 덩어리를 { type, fields(제목 포함) } 로 변환한다.
function parseFreeText(rawText, forcedType) {
  const type = forcedType || detectDocType(rawText);
  const schema = FIELD_SCHEMAS[type];
  const rawLines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = deriveTitle(rawLines[0], TYPE_META[type].label);

  const fieldValues = {};
  schema.forEach((f) => { fieldValues[f.key] = []; });
  const catchAllKey = schema.some((f) => f.key === 'content') ? 'content' : schema[schema.length - 1].key;

  // 첫 줄은 제목으로 이미 소비했으므로 내용 추출 대상에서 제외한다.
  rawLines.slice(1).forEach((line) => {
    const labelMatch = line.match(LABEL_LINE_RE);
    if (labelMatch) {
      const [, label, value] = labelMatch;
      const field = schema.find((f) => label.includes(f.label) || f.label.includes(label));
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

    fieldValues[(matched || schema.find((f) => f.key === catchAllKey)).key].push(cleanedLine);
  });

  const fields = { title };
  Object.keys(fieldValues).forEach((key) => {
    fields[key] = fieldValues[key].join('\n');
  });

  return { type, fields };
}

// ============================================================
// 문체(어투) 변환 -- 실제 문법 엔진이 아니라, 문장 끝맺음과 항목화 방식을
// 규칙 기반으로 바꾸는 근사치 변환이다 (ppt-draft-app의 applyTone과 동일한 접근).
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

const ORDINALS = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째'];

function applyTone(text, tone) {
  const items = (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return '';

  if (tone === 'concise') {
    return items
      .map((line) => {
        let t = line.split(',')[0].trim();
        NOMINALIZE_MAP.forEach(([re, rep]) => {
          t = t.replace(re, rep);
        });
        if (t.length > 60) t = `${t.slice(0, 57).trim()}…`;
        return `• ${t}`;
      })
      .join('\n');
  }

  if (tone === 'detailed') {
    return items
      .map((line, i) => {
        let t = line;
        if (t && !/[.!?…]$/.test(t)) t += '.';
        const prefix = items.length > 1 ? `${ORDINALS[i] || `${i + 1}번째`}, ` : '';
        return prefix + t;
      })
      .join(' ');
  }

  // formal (기본값)
  return items
    .map((line) => {
      let t = line;
      if (t && !/[.!?…]$/.test(t)) t += '.';
      return t;
    })
    .join(' ');
}

// ============================================================
// 문서 유형별 생성 로직 (템플릿 기반, 외부 AI 없이 규칙으로 조립)
// ============================================================

function buildMeetingMinutes(f, tone) {
  const sections = [
    { id: uuid(), heading: '안건', body: applyTone(f.purpose, tone) },
    { id: uuid(), heading: '논의 내용', body: applyTone(f.content, tone) },
  ];
  if ((f.decisions || '').trim()) {
    sections.push({ id: uuid(), heading: '결정사항 및 향후계획', body: applyTone(f.decisions, tone) });
  }
  return {
    title: f.title || '회의록',
    meta: [
      { label: '일시', value: f.date || '' },
      { label: '장소', value: f.place || '' },
      { label: '참석자', value: f.attendees || '' },
    ],
    sections,
    closing: null,
    footer: '',
  };
}

function buildMemo(f, tone) {
  const sections = [
    { id: uuid(), heading: '목적', body: applyTone(f.purpose, tone) },
    { id: uuid(), heading: '내용', body: applyTone(f.content, tone) },
  ];
  const closingMap = {
    formal: '위 사항에 대해 협조하여 주시기 바랍니다.',
    concise: '협조 요청드립니다.',
    detailed: '위와 같은 사항을 안내드리오니, 업무에 참고하시어 원활한 협조가 이루어질 수 있도록 부탁드립니다.',
  };
  return {
    title: f.title || '공문',
    meta: [
      { label: '수신', value: f.recipient || '' },
      { label: '날짜', value: f.date || '' },
    ],
    sections,
    closing: closingMap[tone] || closingMap.formal,
    footer: f.contact || '',
  };
}

function buildReport(f, tone) {
  const sections = [
    { id: uuid(), heading: '목적 및 배경', body: applyTone(f.purpose, tone) },
    { id: uuid(), heading: '주요 내용', body: applyTone(f.content, tone) },
  ];
  if ((f.conclusion || '').trim()) {
    sections.push({ id: uuid(), heading: '결론 및 제언', body: applyTone(f.conclusion, tone) });
  }
  return {
    title: f.title || '보고서',
    meta: [
      { label: '작성자', value: f.author || '' },
      { label: '날짜', value: f.date || '' },
    ],
    sections,
    closing: null,
    footer: '',
  };
}

function buildNotice(f, tone) {
  const sections = [
    { id: uuid(), heading: '목적', body: applyTone(f.purpose, tone) },
    { id: uuid(), heading: '주요 내용', body: applyTone(f.content, tone) },
  ];
  return {
    title: f.title || '안내문',
    meta: [
      { label: '대상', value: f.target || '' },
      { label: '날짜', value: f.date || '' },
    ],
    sections,
    closing: f.inquiry ? `문의처: ${f.inquiry}` : null,
    footer: '',
  };
}

function buildTripReport(f, tone) {
  const sections = [
    { id: uuid(), heading: '목적', body: applyTone(f.purpose, tone) },
    { id: uuid(), heading: '성과', body: applyTone(f.outcome, tone) },
  ];
  if ((f.followup || '').trim()) {
    sections.push({ id: uuid(), heading: '후속조치', body: applyTone(f.followup, tone) });
  }
  return {
    title: f.title || TYPE_META.tripReport.label,
    meta: [
      { label: '출장지', value: f.destination || '' },
      { label: '기간', value: f.period || '' },
    ],
    sections,
    closing: null,
    footer: '',
  };
}

function buildLeaveRequest(f, tone) {
  const sections = [
    { id: uuid(), heading: '사유', body: applyTone(f.reason, tone) },
  ];
  if ((f.handover || '').trim()) {
    sections.push({ id: uuid(), heading: '인수인계', body: applyTone(f.handover, tone) });
  }
  if ((f.emergencyContact || '').trim()) {
    sections.push({ id: uuid(), heading: '비상연락', body: applyTone(f.emergencyContact, tone) });
  }
  return {
    title: f.title || TYPE_META.leaveRequest.label,
    meta: [{ label: '기간', value: f.period || '' }],
    sections,
    closing: null,
    footer: '',
  };
}

function buildHandover(f, tone) {
  const sectionDefs = [
    ['currentDuties', '현재 담당 업무'],
    ['ongoingProjects', '진행 중인 프로젝트'],
    ['notes', '주의사항'],
    ['contact', '연락처'],
    ['schedule', '향후 일정'],
  ];
  return {
    title: f.title || TYPE_META.handover.label,
    meta: [],
    sections: sectionDefs.map(([key, heading]) => ({ id: uuid(), heading, body: applyTone(f[key], tone) })),
    closing: null,
    footer: '',
  };
}

function buildPlan(f, tone) {
  const sectionDefs = [
    ['purpose', '목적'],
    ['target', '적용 대상'],
    ['expectedEffect', '예상 효과'],
    ['schedule', '추진 일정'],
  ];
  return {
    title: f.title || TYPE_META.plan.label,
    meta: [],
    sections: sectionDefs.map(([key, heading]) => ({ id: uuid(), heading, body: applyTone(f[key], tone) })),
    closing: null,
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

function renderPreview() {
  const doc = state.document;
  docPreview.innerHTML = '';

  const title = document.createElement('h2');
  title.className = 'doc-title';
  title.textContent = doc.title;
  docPreview.appendChild(title);

  const underline = document.createElement('div');
  underline.className = 'doc-underline';
  docPreview.appendChild(underline);

  if (state.docType === 'memo') {
    const header = document.createElement('div');
    header.className = 'doc-memo-header';
    const left = document.createElement('span');
    left.textContent = `수신: ${findMeta(doc, '수신')}`;
    const right = document.createElement('span');
    right.textContent = findMeta(doc, '날짜');
    header.appendChild(left);
    header.appendChild(right);
    docPreview.appendChild(header);
  } else {
    const table = document.createElement('table');
    table.className = 'doc-meta-table';
    const tbody = document.createElement('tbody');
    doc.meta.filter((m) => m.value).forEach((m) => {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.className = 'doc-meta-label';
      td1.textContent = m.label;
      const td2 = document.createElement('td');
      td2.textContent = m.value;
      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    docPreview.appendChild(table);
  }

  doc.sections.forEach((section) => {
    const wrap = document.createElement('div');
    wrap.className = 'doc-section';
    const h = document.createElement('h3');
    h.className = 'doc-section-heading';
    h.textContent = section.heading;
    const body = document.createElement('p');
    body.className = 'doc-section-body';
    body.textContent = section.body;
    wrap.appendChild(h);
    wrap.appendChild(body);
    docPreview.appendChild(wrap);
  });

  if (doc.closing) {
    const closing = document.createElement('p');
    closing.className = 'doc-closing';
    closing.textContent = doc.closing;
    docPreview.appendChild(closing);
  }
  if (doc.footer) {
    const footer = document.createElement('p');
    footer.className = 'doc-section-body';
    footer.style.textAlign = 'right';
    footer.style.marginTop = '20px';
    footer.textContent = doc.footer;
    docPreview.appendChild(footer);
  }
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
