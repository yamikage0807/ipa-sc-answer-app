import { useEffect, useMemo, useState } from 'react'
import examData from './exam-data.json'
import practiceExamData from './practice-exam-data.json'
import { clearImages, loadImage, saveImage } from './storage'

type Option = { value: string; label: string }
type Question = {
  id: string
  label: string
  type: 'text' | 'choice' | 'checkbox' | 'multiRadio' | 'multiText' | 'trueFalse' | 'image'
  prompt: string
  maxChars?: number
  exactChars?: number
  options?: Option[]
  fields?: string[]
  itemCharLimits?: number[]
  figureTableRefs?: string[]
}
type Section = { id: string; title: string; topic: string; items: Question[] }
type AnswerValue = string | string[] | Record<string, string>
type Answer = { value?: AnswerValue; imageName?: string; reviewNeeded?: boolean }
type Session = {
  sessionId: string
  examId: string
  selectedSections: string[]
  currentQuestionId: string
  answers: Record<string, Answer>
  questionSlotCounts?: Record<string, number>
  updatedAt: string
  schemaVersion: number
}
type Exam = {
  examId: string
  examName: string
  year: string
  season: string
  sourcePageUrl: string
  questionPdfUrl: string
  questionPdfs: { label: string; url: string }[]
  questionNumbers: number[]
  answerSlotsPerQuestion: number
  sections: Section[]
}
type PracticeQuestion = {
  id: string
  set_id: string
  question_no: number
  subquestion_no: number
  topic: string
  prompt: string
  ui_widget: string
  max_chars: number | null
  exact_chars: number | null
  answer_field_count: number
  item_char_limits: number[]
  option_set_id: string | null
  figure_table_refs: string[]
  blank_ids: string[]
  requires_figure_or_table: boolean
}
type PracticeExamData = {
  document: string
  questions: PracticeQuestion[]
  option_sets: Record<string, { code: string; label: string }[]>
}
type Status = 'unanswered' | 'answered' | 'overLimit' | 'lengthMismatch' | 'imagePending' | 'review'

const ipaExamCatalog = (examData as Omit<Exam, 'sections'>[]).map((entry): Exam => ({
  ...entry,
  sections: entry.questionNumbers.map((number) => ({
    id: `q${number}`,
    title: `問${number}`,
    topic: '公式PDFを参照',
    items: Array.from({ length: entry.answerSlotsPerQuestion }, (_, index) => ({
      id: `q${number}-s${index + 1}`,
      label: `設問${index + 1}`,
      type: 'text' as const,
      prompt: '上の問題冊子で設問文を確認し、解答を入力してください。',
    })),
  })),
}))
const practiceData = practiceExamData as PracticeExamData
const widgetTypes: Record<string, Question['type']> = {
  text: 'text',
  textarea: 'text',
  multi_text: 'multiText',
  radio: 'choice',
  checkbox: 'checkbox',
  multi_radio: 'multiRadio',
}
const practiceSections: Section[] = ['A', 'B', 'C', 'D'].map((setId) => {
  const rows = practiceData.questions.filter((question) => question.set_id === setId)
  return {
    id: `practice-${setId}`,
    title: `問題セット ${setId}`,
    topic: rows[0]?.topic ?? '',
    items: rows.map((row) => ({
      id: row.id,
      label: `問${row.question_no} 設問${row.subquestion_no}`,
      type: widgetTypes[row.ui_widget] ?? 'text',
      prompt: row.prompt,
      maxChars: row.max_chars ?? undefined,
      exactChars: row.exact_chars ?? undefined,
      options: row.option_set_id ? practiceData.option_sets[row.option_set_id]?.map((option) => ({ value: option.code, label: option.label })) : undefined,
      fields: row.blank_ids.length ? row.blank_ids.map((blank) => `［${blank}］`) : row.answer_field_count > 1 ? Array.from({ length: row.answer_field_count }, (_, index) => `解答${index + 1}`) : undefined,
      itemCharLimits: row.item_char_limits,
      figureTableRefs: row.figure_table_refs,
    })),
  }
})
const practiceExam: Exam = {
  examId: 'sc-practice-test',
  examName: practiceData.document,
  year: '実力試験',
  season: '午後問題',
  sourcePageUrl: '',
  questionPdfUrl: '',
  questionPdfs: [],
  questionNumbers: [],
  answerSlotsPerQuestion: 0,
  sections: practiceSections,
}
const examCatalog = [...ipaExamCatalog, practiceExam]
const SESSION_KEY = 'ipa-sc-answer-session-v1'
const sectionNames = (sections: Section[], selected: string[]) => sections.filter((section) => selected.includes(section.id)).map((section) => section.title)
const allItems = (sections: Section[], selected: string[]) => sections.filter((section) => selected.includes(section.id)).flatMap((section) => section.items.map((item) => ({ ...item, section })))
const answerText = (answer: Answer | undefined) => typeof answer?.value === 'string' ? answer.value : Array.isArray(answer?.value) ? answer.value.join(', ') : ''
const charCount = (answer: Answer | undefined) => typeof answer?.value === 'string' ? answer.value.length : answer?.value && typeof answer.value === 'object' ? Object.values(answer.value).join('').length : 0
const isEmpty = (answer: Answer | undefined) => !answer || (typeof answer.value === 'string' ? !answer.value.trim() : !answer.value || Object.values(answer.value).every((value) => !value.trim()))
const formatTime = (date: string) => new Date(date).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })

function readSession(): Session | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY)
    return saved ? JSON.parse(saved) as Session : null
  } catch {
    return null
  }
}

function getStatus(question: Question, answer: Answer | undefined): Status {
  if (question.type === 'image') return answer?.reviewNeeded ? 'imagePending' : answer?.imageName ? 'answered' : 'unanswered'
  if (answer?.reviewNeeded) return 'review'
  if (isEmpty(answer)) return 'unanswered'
  if ((question.type === 'multiText' || question.type === 'multiRadio') && question.fields?.some((field) => {
    const values = answer?.value && typeof answer.value === 'object' && !Array.isArray(answer.value) ? answer.value : {}
    return !values[field]?.trim()
  })) return 'unanswered'
  if (question.exactChars && charCount(answer) !== question.exactChars) return 'lengthMismatch'
  if (question.maxChars && charCount(answer) > question.maxChars) return 'overLimit'
  if (question.itemCharLimits?.length && answer?.value && typeof answer.value === 'object' && !Array.isArray(answer.value)) {
    const values = Object.values(answer.value)
    if (question.itemCharLimits.some((limit, index) => String(values[index] ?? '').length > limit)) return 'overLimit'
  }
  return 'answered'
}

function statusLabel(status: Status) {
  return ({ unanswered: '未回答', answered: '回答済み', overLimit: '字数超過', lengthMismatch: '固定文字数不一致', imagePending: '画像提出待ち', review: '要確認' })[status]
}

function defaultSections(exam: Exam) {
  if (exam.examId === practiceExam.examId) return exam.sections.map((section) => section.id)
  const recommended = ['q2', 'q3'].filter((id) => exam.sections.some((section) => section.id === id))
  return recommended.length ? recommended : exam.sections.slice(0, 2).map((section) => section.id)
}

function App() {
  const [session, setSession] = useState<Session | null>(() => readSession())
  const [selectedExamId, setSelectedExamId] = useState(() => readSession()?.examId ?? examCatalog[0].examId)
  const [phase, setPhase] = useState<'setup' | 'solve' | 'review'>('setup')
  const [selectedSections, setSelectedSections] = useState<string[]>(() => readSession()?.selectedSections ?? defaultSections(examCatalog[0]))
  const [selectedPdfIndex, setSelectedPdfIndex] = useState(0)
  const [saveLabel, setSaveLabel] = useState('端末内に自動保存')
  const [notice, setNotice] = useState('')
  const exam = examCatalog.find((entry) => entry.examId === selectedExamId) ?? examCatalog[0]
  const activePdf = exam.questionPdfs.length ? exam.questionPdfs[selectedPdfIndex] ?? exam.questionPdfs[0] : undefined
  const activeSectionIds = session?.examId === exam.examId ? session.selectedSections : selectedSections
  const sectionDefinitions = useMemo(() => exam.sections.map((section) => {
    const count = exam.examId !== practiceExam.examId && session?.examId === exam.examId ? session.questionSlotCounts?.[section.id] ?? section.items.length : section.items.length
    return {
      ...section,
      items: Array.from({ length: count }, (_, index) => section.items[index] ?? ({
        id: `${section.id}-s${index + 1}`,
        label: `設問${index + 1}`,
        type: 'text' as const,
        prompt: '上の問題冊子で設問文を確認し、解答を入力してください。',
      })),
    }
  }), [exam, session?.examId, session?.questionSlotCounts])
  const sections = useMemo(() => sectionDefinitions.filter((section) => activeSectionIds.includes(section.id)), [sectionDefinitions, activeSectionIds])
  const questions = useMemo(() => allItems(sectionDefinitions, activeSectionIds), [sectionDefinitions, activeSectionIds])
  const summary = useMemo(() => {
    const statuses = questions.map((question) => getStatus(question, session?.answers[question.id]))
    return {
      total: statuses.length,
      answered: statuses.filter((status) => status === 'answered').length,
      unanswered: statuses.filter((status) => status === 'unanswered').length,
      overLimit: statuses.filter((status) => status === 'overLimit').length,
      lengthMismatch: statuses.filter((status) => status === 'lengthMismatch').length,
      imagePending: statuses.filter((status) => status === 'imagePending').length,
    }
  }, [questions, session?.answers])

  useEffect(() => {
    if (!session) return
    setSaveLabel('保存中…')
    const timer = window.setTimeout(() => {
      const updated = { ...session, updatedAt: new Date().toISOString() }
      localStorage.setItem(SESSION_KEY, JSON.stringify(updated))
      setSession(updated)
      setSaveLabel(`保存済み ${formatTime(updated.updatedAt)}`)
    }, 650)
    return () => window.clearTimeout(timer)
  }, [session?.answers, session?.currentQuestionId, session?.questionSlotCounts, session?.selectedSections])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timer)
  }, [notice])

  function startSession() {
    if (!selectedSections.length) return
    const firstItem = allItems(exam.sections, selectedSections)[0]
    const resumed = session?.examId === exam.examId && session.selectedSections.join() === selectedSections.join() ? session : null
    setSession(resumed ?? {
      sessionId: crypto.randomUUID(),
      examId: exam.examId,
      selectedSections,
      currentQuestionId: firstItem.id,
      answers: {},
      questionSlotCounts: Object.fromEntries(exam.sections.map((section) => [section.id, section.items.length])),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    })
    setPhase('solve')
  }

  function updateAnswer(questionId: string, answer: Answer) {
    setSession((current) => current ? { ...current, answers: { ...current.answers, [questionId]: answer } } : current)
  }

  function updateQuestionCount(sectionId: string, value: string) {
    const count = Math.min(12, Math.max(1, Number(value) || 1))
    setSession((current) => current ? {
      ...current,
      questionSlotCounts: { ...current.questionSlotCounts, [sectionId]: count },
    } : current)
  }

  function goToQuestion(questionId: string) {
    setSession((current) => current ? { ...current, currentQuestionId: questionId } : current)
    setPhase('solve')
    window.requestAnimationFrame(() => document.getElementById(questionId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  function goToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function resetSession() {
    if (!window.confirm('この試験の答案と添付画像を端末から削除します。よろしいですか？')) return
    localStorage.removeItem(SESSION_KEY)
    await clearImages().catch(() => undefined)
    setSession(null)
    setPhase('setup')
    setNotice('答案を削除しました')
  }

  function buildExport() {
    const selected = session?.selectedSections ?? selectedSections
    const items = allItems(sectionDefinitions, selected)
    return {
      examId: exam.examId,
      examName: exam.examName,
      selectedSections: selected,
      sessionId: session?.sessionId,
      schemaVersion: 1,
      updatedAt: session?.updatedAt,
      answers: Object.fromEntries(items.map(({ section, ...question }) => {
        const answer = session?.answers[question.id]
        const value = answer?.value ?? (question.type === 'multiText' || question.type === 'multiRadio' ? Object.fromEntries((question.fields ?? []).map((field) => [field, ''])) : question.type === 'checkbox' ? [] : '')
        const selectedOptions = question.options?.filter(({ value: optionValue }) => Array.isArray(answer?.value) ? answer.value.includes(optionValue) : answer?.value && typeof answer.value === 'object' ? Object.values(answer.value).includes(optionValue) : optionValue === answer?.value) ?? []
        return [question.id, {
          sectionId: section.id,
          sectionTitle: section.title,
          label: question.label,
          type: question.type,
          prompt: question.prompt,
          value,
          ...(selectedOptions.length ? { choiceLabels: selectedOptions.map((option) => `${option.value}: ${option.label}`) } : {}),
          charCount: charCount(answer),
          maxChars: question.maxChars ?? null,
          overLimit: Boolean(question.maxChars && charCount(answer) > question.maxChars),
          lengthMismatch: Boolean(question.exactChars && charCount(answer) !== question.exactChars),
          imageName: answer?.imageName ?? null,
          imageRef: answer?.imageName ? question.id : null,
          reviewNeeded: Boolean(answer?.reviewNeeded),
        }]
      })),
    }
  }

  function buildTextExport() {
    const lines = [
      `試験: ${exam.examName}`,
      `選択: ${sectionNames(exam.sections, session?.selectedSections ?? selectedSections).join(', ')}`,
      `出力日時: ${new Date().toLocaleString('ja-JP')}`,
      '※設問文は選択した試験データに基づきます。',
      '',
    ]
    for (const { section, ...question } of allItems(sectionDefinitions, session?.selectedSections ?? selectedSections)) {
      const answer = session?.answers[question.id]
      lines.push(`[${section.title} ${question.label}]`)
      lines.push(`問題: ${question.prompt}`)
      if (question.type === 'image') {
        lines.push(`回答形式: 画像添付${answer?.reviewNeeded ? '（後で画像提出）' : ''}`)
        lines.push(`画像: ${answer?.imageName ?? (answer?.reviewNeeded ? '別途提出予定' : '未回答')}`)
      } else if (question.type === 'multiText' || question.type === 'multiRadio') {
        const values = answer?.value && typeof answer.value === 'object' && !Array.isArray(answer.value) ? answer.value : {}
        lines.push(`解答: ${(question.fields ?? []).map((field) => {
          const option = question.options?.find(({ value }) => value === values[field])
          return `${field}: ${option ? `${option.value} ${option.label}` : values[field] || '未回答'}`
        }).join(' / ')}`)
        if (question.maxChars) lines.push(`文字数: ${charCount(answer)} / ${question.maxChars}`)
      } else if (question.type === 'checkbox') {
        const values = Array.isArray(answer?.value) ? answer.value : []
        lines.push(`解答: ${question.options?.filter(({ value }) => values.includes(value)).map(({ value, label }) => `${value} ${label}`).join(' / ') || '未回答'}`)
      } else {
        const selected = question.options?.find(({ value }) => value === answer?.value)
        lines.push(`解答: ${selected ? `${selected.value}: ${selected.label}` : answerText(answer) || '未回答'}`)
        if (question.maxChars) lines.push(`文字数: ${charCount(answer)} / ${question.maxChars}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  function downloadFile(extension: 'txt' | 'json') {
    const content = extension === 'json' ? JSON.stringify(buildExport(), null, 2) : buildTextExport()
    const blob = new Blob([content], { type: extension === 'json' ? 'application/json' : 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${exam.year}${exam.season}_SC午後_${(session?.selectedSections ?? selectedSections).map((id) => id.replace('q', '問')).join('')}_答案.${extension}`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice(`${extension.toUpperCase()}を出力しました`)
  }

  async function copyText() {
    await navigator.clipboard.writeText(buildTextExport())
    setNotice('答案をクリップボードへコピーしました')
  }

  if (phase === 'setup') {
    const savedMatches = session?.examId === exam.examId
    return (
      <main className="app-shell setup-shell">
        <TopBar saveLabel={session ? `前回の保存 ${formatTime(session.updatedAt)}` : '端末内保存'} />
        <section className="welcome-grid">
          <div className="welcome-copy">
            <p className="eyebrow">INFORMATION SECURITY SPECIALIST / AFTERNOON</p>
            <h1>考えを、<br /><span>答案のかたちに。</span></h1>
            <p className="lead">大問ごとに設問を並べて、流れを止めずに解答。入力内容はこの端末に保存され、採点に使える形式で書き出せます。</p>
            <div className="privacy-note"><span className="privacy-mark" />答案は外部へ送信されません</div>
          </div>
          <section className="setup-panel" aria-labelledby="exam-selection-title">
            <div className="panel-heading">
              <div><p className="eyebrow">SESSION SETUP</p><h2 id="exam-selection-title">試験を選ぶ</h2></div>
              <span className="year-tag">SC / 午後</span>
            </div>
              <label className="field-label" htmlFor="exam-select">試験回</label>
              <select id="exam-select" value={selectedExamId} onChange={(event) => {
                setSelectedExamId(event.target.value)
                setSelectedPdfIndex(0)
                setSelectedSections(defaultSections(examCatalog.find((entry) => entry.examId === event.target.value) ?? examCatalog[0]))
              }}>
                {examCatalog.map((entry) => <option value={entry.examId} key={entry.examId}>{entry.year} {entry.season}</option>)}
            </select>
            <span className="field-label">{exam.examId === practiceExam.examId ? '解く問題セット' : '解く問題'} <span className="muted">{exam.examId === practiceExam.examId ? 'セットを選択' : '2問選択がおすすめ'}</span></span>
            <div className="section-picker">
              {exam.sections.map((section) => {
                const checked = selectedSections.includes(section.id)
                return <label className={`section-option ${checked ? 'selected' : ''}`} key={section.id}>
                  <input type="checkbox" checked={checked} onChange={(event) => setSelectedSections((value) => event.target.checked ? [...value, section.id].sort() : value.filter((id) => id !== section.id))} />
                  <span className="check-indicator" aria-hidden="true">{checked ? '✓' : ''}</span>
                  <span><strong>{section.title}</strong><small>{section.topic}</small></span>
                </label>
              })}
            </div>
            {selectedSections.length !== (exam.examId === practiceExam.examId ? exam.sections.length : 2) && <p className="selection-warning">現在{selectedSections.length}{exam.examId === practiceExam.examId ? 'セット' : '問'}を選択中です。続行できます。</p>}
            <p className="sample-warning">{exam.examId === practiceExam.examId ? `${practiceData.questions.length}問を含む添付の実力試験データです。` : '設問欄は入力用です。本文・設問数は公式PDFで確認してください。'}</p>
            <button className="primary-button start-button" type="button" disabled={!selectedSections.length} onClick={startSession}>{savedMatches && session.selectedSections.join() === selectedSections.join() ? '続きから再開' : '答案をはじめる'}<span aria-hidden="true">→</span></button>
          </section>
        </section>
        <footer className="site-footer"><span>SC 答案ノート</span>{exam.sourcePageUrl && <a href={exam.sourcePageUrl} target="_blank" rel="noreferrer">IPA公式問題ページ <span aria-hidden="true">↗</span></a>}</footer>
      </main>
    )
  }

  if (!session) return null
  const progress = Math.round((summary.answered / Math.max(summary.total, 1)) * 100)

  return (
    <main className="app-shell workspace-shell">
      <TopBar saveLabel={saveLabel} onHome={() => setPhase('setup')} />
      <header className="exam-bar">
        <div className="exam-title-block"><span className="exam-kicker">{exam.year} · {exam.season}</span><strong>情報処理安全確保支援士 <span>午後</span></strong></div>
        <div className="exam-actions">{exam.questionPdfUrl && <a className="quiet-button" href={exam.questionPdfUrl} target="_blank" rel="noreferrer">IPA公式ページ <span aria-hidden="true">↗</span></a>}<button className="quiet-button" type="button" onClick={() => setPhase('review')}>答案を確認 <span className="count-badge">{summary.unanswered}</span></button></div>
      </header>
      <div className="progress-track" aria-label={`回答済み ${summary.answered} / ${summary.total}`}><span style={{ width: `${progress}%` }} /></div>
      <div className="workspace-layout">
        <aside className="question-rail" aria-label="設問一覧">
          <div className="rail-heading"><span>問題一覧</span><span>{summary.answered}/{summary.total}</span></div>
          {sections.map((section) => {
            const sectionItems = section.items
            const answered = sectionItems.filter((question) => getStatus(question, session.answers[question.id]) === 'answered').length
            return <div className="rail-section" key={section.id}>
              <button className="rail-item" type="button" onClick={() => goToSection(section.id)}>
                <span className="rail-major-title">{section.title}</span><span className="rail-state">{answered}/{sectionItems.length}</span>
              </button>
            </div>
          })}
          <button type="button" className="rail-review" onClick={() => setPhase('review')}>最終確認へ <span aria-hidden="true">→</span></button>
        </aside>
        <section className="question-area">
          <div className="question-toolbar">
            <button type="button" className="back-link" onClick={() => setPhase('setup')}>← 試験選択</button>
            <span className="save-indicator"><span className="save-dot" />{saveLabel}</span>
          </div>
          <div className="question-heading">
            <div><p className="eyebrow">午後試験 / 大問ごとに入力</p><h1>答案をまとめて書く</h1></div>
            <span className="question-index">{summary.answered} <i>/</i> {summary.total}</span>
          </div>
          {activePdf && <details className="pdf-viewer" open>
            <summary><span>公式問題冊子</span><span className="pdf-summary-note">ページ内で表示・折りたたみ</span></summary>
            <div className="pdf-toolbar">
              {exam.questionPdfs.length > 1 && <div className="pdf-tabs" role="group" aria-label="問題冊子の選択">
                {exam.questionPdfs.map((pdf, index) => <button className={selectedPdfIndex === index ? 'active' : ''} type="button" aria-pressed={selectedPdfIndex === index} key={pdf.url} onClick={() => setSelectedPdfIndex(index)}>{pdf.label}</button>)}
              </div>}
              <a href={activePdf.url} target="_blank" rel="noreferrer">別タブで開く ↗</a>
            </div>
            <iframe className="pdf-frame" title={`${exam.examName} ${activePdf.label}`} src={activePdf.url} loading="lazy" />
          </details>}
          <div className="grouped-questions">
            {sections.map((section) => <section className="major-question" id={section.id} key={section.id}>
              <header className="major-heading"><div><p className="eyebrow">{exam.year} {exam.season} / SC 午後</p><h2>{section.title}</h2></div><div className="major-tools">{exam.examId !== practiceExam.examId && <label>設問欄数<select aria-label={`${section.title}の設問欄数`} value={section.items.length} onChange={(event) => updateQuestionCount(section.id, event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}</select></label>}{activePdf && <a href={activePdf.url} target="_blank" rel="noreferrer">問題PDF ↗</a>}</div></header>
              {section.items.map((question) => {
                const answer = session.answers[question.id]
                const status = getStatus(question, answer)
                return <article className="question-card subquestion-card" id={question.id} key={question.id}>
                  <div className="subquestion-heading"><h3>{question.label}</h3><span className={`subquestion-status status-${status}`}>{statusLabel(status)}</span></div>
                  <div className="question-copy"><span className="prompt-label">{exam.examId === practiceExam.examId ? question.label : 'PDFを参照'}</span><p>{question.prompt}</p></div>
                  {question.maxChars && <p className="limit-note">字数制限 <strong>{question.maxChars}字以内</strong></p>}
                  {question.exactChars && <p className="limit-note">固定文字数 <strong>{question.exactChars}字</strong></p>}
                  {question.figureTableRefs?.length ? <p className="figure-note">関連図表：{question.figureTableRefs.join('・')}（問題冊子を参照）</p> : null}
                  <AnswerControl question={question} answer={answer} onChange={(next) => updateAnswer(question.id, next)} onNotice={setNotice} />
                </article>
              })}
            </section>)}
          </div>
          <div className="question-navigation"><span>{summary.answered} / {summary.total} 回答済み</span><button type="button" className="primary-button nav-next" onClick={() => setPhase('review')}>答案を確認 <span aria-hidden="true">→</span></button></div>
        </section>
      </div>
      {phase === 'review' && <ReviewPanel exam={exam} questions={questions} session={session} onClose={() => setPhase('solve')} onJump={goToQuestion} onExport={downloadFile} onCopy={copyText} onReset={resetSession} summary={summary} />}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  )
}

function TopBar({ saveLabel, onHome }: { saveLabel: string; onHome?: () => void }) {
  return <div className="topbar">
    <button className="brand" type="button" onClick={onHome} aria-label="SC答案ノート ホーム"><span className="brand-mark">SC</span><span className="brand-name">答案ノート</span></button>
    <div className="topbar-right"><span className="save-indicator"><span className="save-dot" />{saveLabel}</span><span className="topbar-divider" /><span className="exam-type">情報処理安全確保支援士</span></div>
  </div>
}

function AnswerControl({ question, answer, onChange, onNotice }: { question: Question; answer?: Answer; onChange: (answer: Answer) => void; onNotice: (notice: string) => void }) {
  const value = answer?.value
  const [previewUrl, setPreviewUrl] = useState('')
  useEffect(() => {
    if (question.type !== 'image' || !answer?.imageName) return
    let url = ''
    loadImage(question.id).then((image) => {
      if (image) {
        url = URL.createObjectURL(image)
        setPreviewUrl(url)
      }
    }).catch(() => undefined)
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [question.id, question.type, answer?.imageName])

  if (question.type === 'choice' || question.type === 'trueFalse') return <fieldset className="choice-list"><legend className="field-label">選択してください</legend>{question.options?.map((option) => <label className={`choice-option ${value === option.value ? 'chosen' : ''}`} key={option.value}><input type="radio" name={question.id} value={option.value} checked={value === option.value} onChange={() => onChange({ ...answer, value: option.value })} /><span className="choice-letter">{option.value}</span><span>{option.label}</span></label>)}</fieldset>

  if (question.type === 'checkbox') {
    const selected = Array.isArray(value) ? value : []
    return <fieldset className="choice-list"><legend className="field-label">該当するものを全て選択</legend>{question.options?.map((option) => {
      const checked = selected.includes(option.value)
      return <label className={`choice-option ${checked ? 'chosen' : ''}`} key={option.value}><input type="checkbox" value={option.value} checked={checked} onChange={() => onChange({ ...answer, value: checked ? selected.filter((item) => item !== option.value) : [...selected, option.value] })} /><span className="choice-letter">{option.value}</span><span>{option.label}</span></label>
    })}</fieldset>
  }

  if (question.type === 'multiRadio') {
    const selected = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return <div className="multi-radio-fields">{question.fields?.map((field) => <fieldset className="choice-list" key={field}><legend className="field-label">{field}を選択</legend>{question.options?.map((option) => <label className={`choice-option ${selected[field] === option.value ? 'chosen' : ''}`} key={option.value}><input type="radio" name={`${question.id}-${field}`} value={option.value} checked={selected[field] === option.value} onChange={() => onChange({ ...answer, value: { ...selected, [field]: option.value } })} /><span className="choice-letter">{option.value}</span><span>{option.label}</span></label>)}</fieldset>)}</div>
  }

  if (question.type === 'multiText') {
    const fieldValues = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    return <div className="multi-fields">{question.fields?.map((field, index) => {
      const max = question.itemCharLimits?.[index]
      return <label className="field-label" key={field}>{field}<input className="short-input" maxLength={max} value={fieldValues[field] ?? ''} onChange={(event) => onChange({ ...answer, value: { ...fieldValues, [field]: event.target.value } })} placeholder={`${field}の値を入力`} />{max && <CharacterCount count={(fieldValues[field] ?? '').length} max={max} />}</label>
    })}{question.maxChars && <CharacterCount count={charCount(answer)} max={question.maxChars} />}</div>
  }

  if (question.type === 'image') return <div className="image-answer">
    <label className="upload-zone"><input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      try {
        await saveImage(question.id, file)
        onChange({ ...answer, imageName: file.name, reviewNeeded: false })
        onNotice('画像をこの端末に保存しました')
      } catch { onNotice('画像を保存できませんでした。端末の空き容量をご確認ください') }
    }} /><span className="upload-icon" aria-hidden="true">＋</span><span><strong>画像を選択</strong><small>PNG / JPEG / WEBP · カメラ撮影可</small></span></label>
    {answer?.imageName && <div className="image-file">{previewUrl ? <img src={previewUrl} alt="添付画像のプレビュー" /> : <span className="file-mark">IMG</span>}<span>{answer.imageName}<small>端末内に保存済み · 出力時は画像ファイルも別途添付してください</small></span><button type="button" aria-label="画像を取り外す" title="画像を取り外す" onClick={() => { void saveImage(question.id, new File([], '')).catch(() => undefined); onChange({ ...answer, imageName: undefined }) }}>×</button></div>}
    <label className="later-check"><input type="checkbox" checked={Boolean(answer?.reviewNeeded)} onChange={(event) => onChange({ ...answer, reviewNeeded: event.target.checked, ...(event.target.checked ? { imageName: undefined } : {}) })} />後で別途画像を提出する</label>
  </div>

  const text = answerText(answer)
  const maxChars = question.exactChars ?? question.maxChars
  return <div className="text-answer"><div className="answer-label-row"><label className="field-label" htmlFor={`answer-${question.id}`}>解答</label>{maxChars && <CharacterCount count={text.length} max={maxChars} />}</div><textarea id={`answer-${question.id}`} maxLength={maxChars} className={question.maxChars && text.length > question.maxChars ? 'over-limit' : ''} value={text} onChange={(event) => onChange({ ...answer, value: event.target.value })} placeholder="ここに解答を入力" rows={5} /></div>
}

function CharacterCount({ count, max }: { count: number; max: number }) {
  const exceeded = count > max
  return <span className={`character-count ${exceeded ? 'exceeded' : ''}`} aria-live="polite">{count} <i>/</i> {max}<small>字</small>{exceeded && <b>超過</b>}</span>
}

function ReviewPanel({ exam, questions, session, onClose, onJump, onExport, onCopy, onReset, summary }: {
  exam: Exam
  questions: ReturnType<typeof allItems>
  session: Session
  onClose: () => void
  onJump: (id: string) => void
  onExport: (extension: 'txt' | 'json') => void
  onCopy: () => Promise<void>
  onReset: () => Promise<void>
  summary: { total: number; answered: number; unanswered: number; overLimit: number; lengthMismatch: number; imagePending: number }
}) {
  const hasIssues = summary.unanswered + summary.overLimit + summary.lengthMismatch + summary.imagePending > 0
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="review-panel" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <div className="review-header"><div><p className="eyebrow">FINAL CHECK</p><h2 id="review-title">答案の確認</h2></div><button className="icon-button" type="button" aria-label="閉じる" onClick={onClose}>×</button></div>
      <p className="review-intro">{exam.examName} · {session.selectedSections.map((id) => exam.sections.find((section) => section.id === id)?.title).join('、')}</p>
      <div className="summary-strip"><SummaryCell label="回答済み" value={summary.answered} tone="good" /><SummaryCell label="未回答" value={summary.unanswered} tone={summary.unanswered ? 'warn' : ''} /><SummaryCell label="字数超過" value={summary.overLimit} tone={summary.overLimit ? 'danger' : ''} /><SummaryCell label="固定文字数" value={summary.lengthMismatch} tone={summary.lengthMismatch ? 'danger' : ''} /><SummaryCell label="画像待ち" value={summary.imagePending} tone={summary.imagePending ? 'image' : ''} /></div>
      {hasIssues && <div className="issue-list"><h3>確認が必要な設問</h3>{questions.filter((question) => getStatus(question, session.answers[question.id]) !== 'answered').map((question) => {
        const status = getStatus(question, session.answers[question.id])
        return <button className="issue-row" key={question.id} type="button" onClick={() => onJump(question.id)}><span className={`issue-mark status-${status}`}>{status === 'overLimit' ? '!' : status === 'imagePending' ? '▧' : '·'}</span><span><strong>{question.section.title} · {question.label}</strong><small>{statusLabel(status)}</small></span><span className="row-arrow">→</span></button>
      })}</div>}
      {!hasIssues && <p className="all-clear"><span aria-hidden="true">✓</span>すべての設問に回答しています</p>}
      <div className="export-section"><div><h3>答案を書き出す</h3><p>出力後も端末内の答案は保持されます。</p></div><div className="export-actions"><button className="export-button" type="button" onClick={() => onExport('txt')}><span className="export-icon">TXT</span>TXTを出力</button><button className="export-button" type="button" onClick={() => onExport('json')}><span className="export-icon braces">{ }</span>JSONを出力</button><button className="export-button" type="button" onClick={() => void onCopy()}><span className="export-icon copy-icon">▢</span>コピー</button></div></div>
      <div className="review-footer"><a href={exam.sourcePageUrl} target="_blank" rel="noreferrer">IPA公式問題ページ ↗</a><button className="delete-button" type="button" onClick={() => void onReset()}>答案を削除</button></div>
    </section>
  </div>
}

function SummaryCell({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`summary-cell ${tone}`}><span>{label}</span><strong>{String(value).padStart(2, '0')}</strong></div>
}

export default App