import { gradeDescriptiveAnswer, type DescriptiveGradingInput } from './ai-grading.service.js'
import { GRADING_PROMPT_VERSION } from './grading.prompt.js'
import { getPracticeQuestionBundle, QuestionNotFoundError } from './practice.repository.js'
import type { GradingResult } from './grading.schema.js'

type GradeMode = 'ai' | 'rule'
type GradeResponse = {
  result: GradingResult
  modelAnswer: string
  gradingMode: GradeMode
  promptVersion?: string
}
type DescriptiveGrader = (input: DescriptiveGradingInput) => Promise<GradingResult>

function parseAnswer(answer: string): unknown {
  try {
    return JSON.parse(answer) as unknown
  } catch {
    return answer
  }
}

function acceptedValues(value: { value: string; accepted_values?: string[] }) {
  return value.accepted_values ?? [value.value]
}

function isAccepted(value: unknown, expected: { value: string; accepted_values?: string[] }) {
  return typeof value === 'string' && acceptedValues(expected).includes(value)
}

function ruleResult(score: number, maxScore: number, missingPoints: string[], incorrectPoints: string[]): GradingResult {
  const isCorrect = score === maxScore && missingPoints.length === 0 && incorrectPoints.length === 0
  return {
    score,
    maxScore,
    isCorrect,
    summary: isCorrect ? '正解です。' : score > 0 ? '一部の解答が一致しています。' : '解答を確認してください。',
    goodPoints: score > 0 ? ['正しい選択内容を含んでいます。'] : [],
    missingPoints,
    incorrectPoints,
    feedback: isCorrect ? '選択内容が模範解答と一致しています。' : '選択内容と模範解答を照らし合わせて修正してください。',
    improvedAnswer: '',
  }
}

function gradeObjectiveAnswer(question: ReturnType<typeof getPracticeQuestionBundle>['question'], modelAnswer: ReturnType<typeof getPracticeQuestionBundle>['modelAnswer'], answer: string): GradingResult {
  const parsedAnswer = parseAnswer(answer)
  const expected = modelAnswer.answer_values
  const maxScore = modelAnswer.max_score ?? expected.length

  if (question.ui_widget === 'checkbox') {
    const selected = Array.isArray(parsedAnswer) ? parsedAnswer.filter((value): value is string => typeof value === 'string') : typeof parsedAnswer === 'string' ? [parsedAnswer] : []
    const expectedOptions = expected.map((item) => new Set(acceptedValues(item)))
    const expectedSet = new Set(expectedOptions.flatMap((values) => [...values]))
    const selectedSet = new Set(selected)
    const matched = expectedOptions.filter((values) => [...values].some((value) => selectedSet.has(value))).length
    const incorrect = selected.filter((value) => !expectedSet.has(value))
    const allRequiredMatched = expectedOptions.every((values) => [...values].some((value) => selectedSet.has(value))) && incorrect.length === 0 && matched === expected.length
    const score = modelAnswer.all_required ? allRequiredMatched ? maxScore : 0 : Math.round((matched / expected.length) * maxScore)
    return {
      ...ruleResult(score, maxScore, expectedOptions.filter((values) => ![...values].some((value) => selectedSet.has(value))).map((values) => [...values][0]), incorrect),
      improvedAnswer: modelAnswer.display_answer,
    }
  }

  if (question.ui_widget === 'multi_radio') {
    const selected = parsedAnswer && typeof parsedAnswer === 'object' && !Array.isArray(parsedAnswer) ? parsedAnswer as Record<string, unknown> : {}
    const missing: string[] = []
    const incorrect: string[] = []
    let score = 0
    for (const item of expected) {
      const field = item.label.replace(/[［］\[\]]/g, '')
      if (isAccepted(selected[field], item)) score += 1
      else if (typeof selected[field] === 'string' && selected[field]) incorrect.push(`${field}: ${selected[field]}`)
      else missing.push(field)
    }
    const finalScore = modelAnswer.all_required && missing.length + incorrect.length > 0 ? 0 : Math.round((score / expected.length) * maxScore)
    return { ...ruleResult(finalScore, maxScore, missing, incorrect), improvedAnswer: modelAnswer.display_answer }
  }

  const isCorrect = expected.some((item) => isAccepted(parsedAnswer, item))
  return {
    ...ruleResult(isCorrect ? maxScore : 0, maxScore, isCorrect ? [] : ['正しい選択肢を選んでください。'], isCorrect ? [] : [String(parsedAnswer ?? '')]),
    improvedAnswer: modelAnswer.display_answer,
  }
}

function emptyResult(maxScore: number): GradingResult {
  return {
    score: 0,
    maxScore,
    isCorrect: false,
    summary: '未回答です。',
    goodPoints: [],
    missingPoints: ['解答が入力されていません。'],
    incorrectPoints: [],
    feedback: '設問に回答してから採点してください。',
    improvedAnswer: '',
  }
}

export async function gradePracticeAnswer(
  questionId: string,
  answer: string,
  aiGrader: DescriptiveGrader = gradeDescriptiveAnswer,
): Promise<GradeResponse> {
  const { question, modelAnswer } = getPracticeQuestionBundle(questionId)
  const isObjective = ['radio', 'checkbox', 'multi_radio'].includes(question.ui_widget)
  const maxScore = isObjective ? modelAnswer.max_score ?? modelAnswer.answer_values.length : modelAnswer.max_score ?? 10

  if (!answer.trim()) {
    return {
      result: emptyResult(maxScore),
      modelAnswer: modelAnswer.display_answer,
      gradingMode: isObjective ? 'rule' : 'ai',
      ...(!isObjective ? { promptVersion: GRADING_PROMPT_VERSION } : {}),
    }
  }

  if (isObjective) {
    return {
      result: gradeObjectiveAnswer(question, modelAnswer, answer),
      modelAnswer: modelAnswer.display_answer,
      gradingMode: 'rule',
    }
  }

  const result = await aiGrader({
    questionText: question.prompt,
    modelAnswer: modelAnswer.display_answer,
    userAnswer: answer,
    maxScore: modelAnswer.max_score ?? null,
    characterLimit: question.max_chars,
    itemCharLimits: [],
  })
  return { result, modelAnswer: modelAnswer.display_answer, gradingMode: 'ai', promptVersion: GRADING_PROMPT_VERSION }
}

export { QuestionNotFoundError }