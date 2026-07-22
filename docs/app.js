const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

// ============================================================
// 문서 유형별 필드 스키마
// ============================================================

const DOC_TYPES = {
  meeting: {
    label: '회의록',
    fields: [
      { key: 'title', label: '제목', type: 'text', required: true, placeholder: '예: 2026년 3분기 AX 솔루션 로드맵 회의' },
      { key: 'date', label: '일시', type: 'text', required: true, placeholder: '예: 2026. 7. 22.(수) 14:00' },
      { key: 'place', label: '장소', type: 'text', required: true, placeholder: '예: 본관 3층 대회의실' },
      { key: 'attendees', label: '참석자', type: 'text', required: true, placeholder: '예: 기획팀 김OO, 운영팀 이OO 등 5명' },
      { key: 'purpose', label: '목적/안건', type: 'textarea', required: true, placeholder: '이 회의에서 다루는 안건을 적어주세요.' },
      { key: 'content', label: '주요 논의내용', type: 'textarea', required: true, placeholder: '논의된 내용을 적어주세요. 줄바꿈으로 항목을 구분할 수 있습니다.' },
      { key: 'decisions', label: '결정사항/향후계획', type: 'textarea', required: false, placeholder: '결정된 사항이나 다음 계획을 적어주세요.' },
    ],
  },
  memo: {
    label: '공문',
    fields: [
      { key: 'title', label: '제목', type: 'text', required: true, placeholder: '예: 2026년 AX 솔루션 설명회 개최 안내' },
      { key: 'date', label: '날짜', type: 'text', required: true, placeholder: '예: 2026. 7. 22.' },
      { key: 'recipient', label: '수신', type: 'text', required: true, placeholder: '예: OO팀장' },
      { key: 'purpose', label: '목적', type: 'textarea', required: true },
      { key: 'content', label: '주요 내용', type: 'textarea', required: true, placeholder: '줄바꿈으로 항목을 구분할 수 있습니다.' },
      { key: 'contact', label: '담당자/연락처', type: 'text', required: false, placeholder: '예: 기획팀 김OO (02-000-0000)' },
    ],
  },
  report: {
    label: '보고서',
    fields: [
      { key: 'title', label: '제목', type: 'text', required: true },
      { key: 'author', label: '작성자', type: 'text', required: true, placeholder: '예: 기획팀 김OO' },
      { key: 'date', label: '날짜', type: 'text', required: true },
      { key: 'purpose', label: '목적/배경', type: 'textarea', required: true },
      { key: 'content', label: '주요 내용', type: 'textarea', required: true, placeholder: '줄바꿈으로 항목을 구분할 수 있습니다.' },
      { key: 'conclusion', label: '결론 및 제언', type: 'textarea', required: false },
    ],
  },
  notice: {
    label: '안내문',
    fields: [
      { key: 'title', label: '제목', type: 'text', required: true },
      { key: 'target', label: '대상', type: 'text', required: true, placeholder: '예: 전 직원' },
      { key: 'date', label: '날짜', type: 'text', required: true },
      { key: 'purpose', label: '목적', type: 'textarea', required: true },
      { key: 'content', label: '주요 내용', type: 'textarea', required: true, placeholder: '줄바꿈으로 항목을 구분할 수 있습니다.' },
      { key: 'inquiry', label: '문의처', type: 'text', required: false, placeholder: '예: 총무팀 (02-000-0000)' },
    ],
  },
};

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

function buildDocument(type, fields, tone) {
  if (type === 'memo') return buildMemo(fields, tone);
  if (type === 'report') return buildReport(fields, tone);
  if (type === 'notice') return buildNotice(fields, tone);
  return buildMeetingMinutes(fields, tone);
}

// ============================================================
// 상태 / 단계 이동
// ============================================================

const state = {
  docType: 'meeting',
  fields: {},
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
// Step 1: 정보입력
// ============================================================

const fieldForm = document.getElementById('fieldForm');
const formError = document.getElementById('formError');
const toStep2 = document.getElementById('toStep2');

function renderFieldForm(type) {
  const schema = DOC_TYPES[type];
  fieldForm.innerHTML = '';
  schema.fields.forEach((field) => {
    const row = document.createElement('div');
    row.className = 'field-row';

    const label = document.createElement('label');
    label.htmlFor = `field-${field.key}`;
    label.textContent = field.label;
    if (!field.required) {
      const tag = document.createElement('span');
      tag.className = 'optional-tag';
      tag.textContent = '(선택)';
      label.appendChild(tag);
    }
    row.appendChild(label);

    const input = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
    if (field.type !== 'textarea') input.type = 'text';
    input.id = `field-${field.key}`;
    input.placeholder = field.placeholder || '';
    input.value = state.fields[field.key] || '';
    input.addEventListener('input', () => {
      state.fields[field.key] = input.value;
    });
    row.appendChild(input);

    fieldForm.appendChild(row);
  });
}

document.querySelectorAll('input[name="docType"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    state.docType = radio.value;
    formError.textContent = '';
    renderFieldForm(state.docType);
  });
});

toStep2.addEventListener('click', () => {
  const schema = DOC_TYPES[state.docType];
  const missing = schema.fields.filter((f) => f.required && !(state.fields[f.key] || '').trim());
  if (missing.length > 0) {
    formError.textContent = `다음 항목을 입력해주세요: ${missing.map((f) => f.label).join(', ')}`;
    return;
  }
  formError.textContent = '';
  state.tone = document.querySelector('input[name="tone"]:checked').value;
  state.document = buildDocument(state.docType, state.fields, state.tone);
  renderSectionCards();
  goToStep(2);
});

renderFieldForm(state.docType);

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
  state.docType = 'meeting';
  state.fields = {};
  state.tone = 'formal';
  state.document = null;
  document.querySelector('input[name="docType"][value="meeting"]').checked = true;
  document.querySelector('input[name="tone"][value="formal"]').checked = true;
  formError.textContent = '';
  renderFieldForm(state.docType);
  sectionList.innerHTML = '';
  docPreview.innerHTML = '';
  goToStep(1);
});
