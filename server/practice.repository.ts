import { readFileSync } from 'node:fs'

type PracticeQuestion = {
  id: string
  prompt: string
  ui_widget: string
  max_chars: number | null
  exact_chars: number | null
  option_set_id: string | null
  blank_ids: string[]
}

type AcceptedAnswer = { label: string; value: string; accepted_values?: string[] }
type PracticeModelAnswer = {
  id: string
  display_answer: string
  answer_values: AcceptedAnswer[]
  all_required: boolean
  max_score?: number | null
}

type QuestionDocument = { questions: PracticeQuestion[] }
type AnswerDocument = { model_answers: PracticeModelAnswer[] }

const questionDocument = JSON.parse(readFileSync(new URL('../src/practice-exam-data.json', import.meta.url), 'utf8')) as QuestionDocument
const answerDocument = JSON.parse(readFileSync(new URL('../practice-model-answers.json', import.meta.url), 'utf8')) as AnswerDocument

const questionById = new Map(questionDocument.questions.map((question) => [question.id, question]))
const answerById = new Map(answerDocument.model_answers.map((answer) => [answer.id, answer]))

export type PracticeQuestionBundle = {
  question: PracticeQuestion
  modelAnswer: PracticeModelAnswer
}

export class QuestionNotFoundError extends Error {}

export function getPracticeQuestionBundle(questionId: string): PracticeQuestionBundle {
  const question = questionById.get(questionId)
  const modelAnswer = answerById.get(questionId)
  if (!question || !modelAnswer) throw new QuestionNotFoundError('Question not found')
  return { question, modelAnswer }
}