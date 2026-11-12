import { useEffect, useMemo, useState } from 'react'
import examData from './exam-data.json'
import { clearImages, loadImage, saveImage } from './storage'

type Option = { value: string; label: string }
type Question = {
  id: string
  label: string
  type: 'text' | 'choice' | 'multiText' | 'trueFalse' | 'image'
  prompt: string
  maxChars?: number
  options?: Option[]
  fields?: string[]
}
type Section = { id: string; title: string; topic: string; items: Question[] }
type AnswerValue = string | Record<string, string>
type Answer = { value?: AnswerValue; imageName?: string; reviewNeeded?: boolean }
type Session = {
  sessionId: string
  examId: string
  selectedSections: string[]
  currentQuestionId: string
  answers: Record<string, Answer>
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
  sections: Section[]
}
type Status = 'unanswered' | 'answered' | 'overLimit' | 'imagePending' | 'review'

const exam = examData as Exam
const SESSION_KEY = 'ipa-sc-answer-session-v1'
const sectionNames = (sections: Section[], selected: string[]) => sections.filter((section) => selected.includes(section.id)).map((section) => section.title)
const allItems = (sections: Section[], selected: string[]) => sections.filter((section) => selected.includes(section.id)).flatMap((section) => section.items.map((item) => ({ ...item, section })))
const answerText = (answer: Answer | undefined) => typeof answer?.value === 'string' ? answer.value : ''
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
  if (question.type === 'image' && answer?.reviewNeeded) return 'imagePending'
  if (answer?.reviewNeeded) return 'review'
  if (question.maxChars && charCount(answer) > question.maxChars) return 'overLimit'
  if (question.type === 'image') return answer?.imageName ? 'answered' : 'unanswered'
  return isEmpty(answer) ? 'unanswered' : 'answered'
}

function statusLabel(status: Status) {
  return ({ unanswered: '未回答', answered: '回答済み', overLimit: '字数超過', imagePending: '画像提出待ち', review: '要確認' })[status]
}

function App() {
  const [session, setSession] = useState<Session | null>(() => readSession())
  const [phase, setPhase] = useState<'setup' | 'solve' | 'review'>('setup')
  const [selectedSections, setSelectedSections] = useState<string[]>(['q2', 'q3'])
  const [saveLabel, setSaveLabel] = useState('端末内に自動保存')
  const [notice, setNotice] = useState('')
  const sections = useMemo(() => exam.sections.filter((section) => selectedSections.includes(section.id)), [selectedSections])
  const questions = useMemo(() => allItems(exam.sections, session?.selectedSections ?? selectedSections), [session?.selectedSections, selectedSections])
  const currentQuestion = questions.find(({ id }) => id === session?.currentQuestionId) ?? questions[0]
  const currentAnswer = currentQuestion ? session?.answers[currentQuestion.id] : undefined
  const summary = useMemo(() => {
    const statuses = questions.map((question) => getStatus(question, session?.answers[question.id]))
    return {
      total: statuses.length,
      answered: statuses.filter((status) => status === 'answered').length,
      unanswered: statuses.filter((status) => status === 'unanswered').length,
      overLimit: statuses.filter((status) => status === 'overLimit').length,
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
  }, [session?.answers, session?.currentQuestionId, session?.selectedSections])

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
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    })
    setPhase('solve')
  }

  function updateAnswer(questionId: string, answer: Answer) {
    setSession((current) => current ? { ...current, answers: { ...current.answers, [questionId]: answer } } : current)
  }

  function goToQuestion(questionId: string) {
    setSession((current) => current ? { ...current, currentQuestionId: questionId } : current)
    setPhase('solve')
  }

  function moveQuestion(offset: number) {
    if (!currentQuestion) return
    const index = questions.findIndex(({ id }) => id === currentQuestion.id)
    const next = questions[index + offset]
    if (next) goToQuestion(next.id)
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
    const items = allItems(exam.sections, selected)
    return {
      examId: exam.examId,
      examName: exam.examName,
      selectedSections: selected,
      sessionId: session?.sessionId,
      schemaVersion: 1,
      updatedAt: session?.updatedAt,
      answers: Object.fromEntries(items.map(({ section, ...question }) => {
        const answer = session?.answers[question.id]
        const value = answer?.value ?? (question.type === 'multiText' ? Object.fromEntries((question.fields ?? []).map((field) => [field, ''])) : '')
        const option = question.options?.find(({ value: optionValue }) => optionValue === answer?.value)
        return [question.id, {
          sectionId: section.id,
          sectionTitle: section.title,
          label: question.label,
          type: question.type,
          prompt: question.prompt,
          value,
          ...(option ? { choiceLabel: `${option.value}: ${option.label}` } : {}),
          charCount: charCount(answer),
          maxChars: question.maxChars ?? null,
          overLimit: Boolean(question.maxChars && charCount(answer) > question.maxChars),
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
      '※初期設問は操作確認用のオリジナル例題です。',
      '',
    ]
    for (const { section, ...question } of allItems(exam.sections, session?.selectedSections ?? selectedSections)) {
      const answer = session?.answers[question.id]
      lines.push(`[${section.title} ${question.label}]`)
      lines.push(`問題: ${question.prompt}`)
      if (question.type === 'image') {
        lines.push(`回答形式: 画像添付${answer?.reviewNeeded ? '（後で画像提出）' : ''}`)
        lines.push(`画像: ${answer?.imageName ?? (answer?.reviewNeeded ? '別途提出予定' : '未回答')}`)
      } else if (question.type === 'multiText') {
        const values = answer?.value && typeof answer.value === 'object' ? answer.value : {}
        lines.push(`解答: ${(question.fields ?? []).map((field) => `${field}: ${values[field] || '未回答'}`).join(' / ')}`)
        if (question.maxChars) lines.push(`文字数: ${charCount(answer)} / ${question.maxChars}`)
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
    anchor.download = `2024秋期_SC午後_${(session?.selectedSections ?? selectedSections).map((id) => id.replace('q', '問')).join('')}_答案.${extension}`
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
            <p className="lead">午後試験の解答を設問ごとに整理。入力内容はこの端末に保存され、採点に使える形式で書き出せます。</p>
            <div className="privacy-note"><span className="privacy-mark" />答案は外部へ送信されません</div>
          </div>
          <section className="setup-panel" aria-labelledby="exam-selection-title">
            <div className="panel-heading">
              <div><p className="eyebrow">SESSION SETUP</p><h2 id="exam-selection-title">試験を選ぶ</h2></div>
              <span className="year-tag">2024</span>
            </div>
            <label className="field-label" htmlFor="exam-year">年度</label>
            <select id="exam-year" value={exam.examId} disabled>
              <option value={exam.examId}>{exam.year}</option>
            </select>
            <span className="field-label">時期</span>
            <div className="season-switch" role="group" aria-label="試験時期">
              <button className="season-option" type="button" disabled>春期</button>
              <button className="season-option active" type="button" aria-pressed="true">秋期</button>
            </div>
            <span className="field-label">解く問題 <span className="muted">2問選択がおすすめ</span></span>
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
            {selectedSections.length !== 2 && <p className="selection-warning">現在{selectedSections.length}問を選択中です。続行できます。</p>}
            <p className="sample-warning">初期データは操作確認用のオリジナル例題です。実際の問題文は利用条件を確認して追加してください。</p>
            <button className="primary-button start-button" type="button" disabled={!selectedSections.length} onClick={startSession}>{savedMatches && session.selectedSections.join() === selectedSections.join() ? '続きから再開' : '答案をはじめる'}<span aria-hidden="true">→</span></button>
          </section>
        </section>
        <footer className="site-footer"><span>SC 答案ノート</span><a href={exam.sourcePageUrl} target="_blank" rel="noreferrer">IPA公式問題ページ <span aria-hidden="true">↗</span></a></footer>
      </main>
    )
  }

  if (!session || !currentQuestion) return null
  const itemIndex = questions.findIndex(({ id }) => id === currentQuestion.id)
  const progress = Math.round((summary.answered / Math.max(summary.total, 1)) * 100)

  return (
    <main className="app-shell workspace-shell">
      <TopBar saveLabel={saveLabel} onHome={() => setPhase('setup')} />
      <header className="exam-bar">
        <div className="exam-title-block"><span className="exam-kicker">{exam.year} · {exam.season}</span><strong>情報処理安全確保支援士 <span>午後</span></strong></div>
        <div className="exam-actions"><a className="quiet-button" href={exam.questionPdfUrl} target="_blank" rel="noreferrer">PDFを開く <span aria-hidden="true">↗</span></a><button className="quiet-button" type="button" onClick={() => setPhase('review')}>答案を確認 <span className="count-badge">{summary.unanswered}</span></button></div>
      </header>
      <div className="progress-track" aria-label={`回答済み ${summary.answered} / ${summary.total}`}><span style={{ width: `${progress}%` }} /></div>
      <div className="workspace-layout">
        <aside className="question-rail" aria-label="設問一覧">
          <div className="rail-heading"><span>問題一覧</span><span>{summary.answered}/{summary.total}</span></div>
          {sections.map((section) => <div className="rail-section" key={section.id}>
            <p>{section.title} <small>{section.topic}</small></p>
            {section.items.map((question) => {
              const status = getStatus(question, session.answers[question.id])
              return <button key={question.id} className={`rail-item ${currentQuestion.id === question.id ? 'current' : ''} status-${status}`} onClick={() => goToQuestion(question.id)} type="button">
                <span className="status-dot" aria-hidden="true">{status === 'answered' ? '✓' : status === 'overLimit' ? '!' : status === 'imagePending' ? '▧' : ''}</span>{question.label}<span className="rail-state">{statusLabel(status)}</span>
              </button>
            })}
          </div>)}
          <button type="button" className="rail-review" onClick={() => setPhase('review')}>最終確認へ <span aria-hidden="true">→</span></button>
        </aside>
        <section className="question-area">
          <div className="question-toolbar">
            <button type="button" className="back-link" onClick={() => setPhase('setup')}>← 試験選択</button>
            <span className="save-indicator"><span className="save-dot" />{saveLabel}</span>
          </div>
          <div className="question-heading">
            <div><p className="eyebrow">{currentQuestion.section.title} / {currentQuestion.section.topic}</p><h1>{currentQuestion.label}</h1></div>
            <span className="question-index">{String(itemIndex + 1).padStart(2, '0')} <i>/</i> {String(questions.length).padStart(2, '0')}</span>
          </div>
          <article className="question-card">
            <div className="question-copy"><span className="prompt-label">QUESTION</span><p>{currentQuestion.prompt}</p></div>
            {currentQuestion.maxChars && <p className="limit-note">字数制限 <strong>{currentQuestion.maxChars}字以内</strong></p>}
            <AnswerControl question={currentQuestion} answer={currentAnswer} onChange={(answer) => updateAnswer(currentQuestion.id, answer)} onNotice={setNotice} />
          </article>
          <div className="question-navigation">
            <button type="button" className="nav-button previous" onClick={() => moveQuestion(-1)} disabled={itemIndex === 0}><span aria-hidden="true">←</span> 前の設問</button>
            <span>{itemIndex + 1} / {questions.length}</span>
            {itemIndex === questions.length - 1 ? <button type="button" className="primary-button nav-next" onClick={() => setPhase('review')}>答案を確認 <span aria-hidden="true">→</span></button> : <button type="button" className="primary-button nav-next" onClick={() => moveQuestion(1)}>次の設問 <span aria-hidden="true">→</span></button>}
          </div>
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

  if (question.type === 'multiText') {
    const fields = value && typeof value === 'object' ? value : {}
    return <div className="multi-fields">{question.fields?.map((field) => <label className="field-label" key={field}>{field}<input className="short-input" value={fields[field] ?? ''} onChange={(event) => onChange({ ...answer, value: { ...fields, [field]: event.target.value } })} placeholder={`${field}の値を入力`} /></label>)}{question.maxChars && <CharacterCount count={charCount(answer)} max={question.maxChars} />}</div>
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
  return <div className="text-answer"><div className="answer-label-row"><label className="field-label" htmlFor={`answer-${question.id}`}>解答</label>{question.maxChars && <CharacterCount count={text.length} max={question.maxChars} />}</div><textarea id={`answer-${question.id}`} className={question.maxChars && text.length > question.maxChars ? 'over-limit' : ''} value={text} onChange={(event) => onChange({ ...answer, value: event.target.value })} placeholder="ここに解答を入力" rows={5} /></div>
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
  summary: { total: number; answered: number; unanswered: number; overLimit: number; imagePending: number }
}) {
  const hasIssues = summary.unanswered + summary.overLimit + summary.imagePending > 0
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="review-panel" role="dialog" aria-modal="true" aria-labelledby="review-title">
      <div className="review-header"><div><p className="eyebrow">FINAL CHECK</p><h2 id="review-title">答案の確認</h2></div><button className="icon-button" type="button" aria-label="閉じる" onClick={onClose}>×</button></div>
      <p className="review-intro">{exam.examName} · {session.selectedSections.map((id) => exam.sections.find((section) => section.id === id)?.title).join('、')}</p>
      <div className="summary-strip"><SummaryCell label="回答済み" value={summary.answered} tone="good" /><SummaryCell label="未回答" value={summary.unanswered} tone={summary.unanswered ? 'warn' : ''} /><SummaryCell label="字数超過" value={summary.overLimit} tone={summary.overLimit ? 'danger' : ''} /><SummaryCell label="画像待ち" value={summary.imagePending} tone={summary.imagePending ? 'image' : ''} /></div>
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