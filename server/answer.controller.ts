import type { Request, Response } from 'express'
import { FoundryConfigurationError } from './ai-grading.service.js'
import { gradeAnswerRequestSchema } from './grading.schema.js'
import { gradePracticeAnswer } from './grading.service.js'
import { QuestionNotFoundError } from './practice.repository.js'

export async function postGradeAnswer(request: Request, response: Response) {
  const input = gradeAnswerRequestSchema.safeParse(request.body)
  if (!input.success) {
    response.status(400).json({ error: 'questionIdとanswerを確認してください。' })
    return
  }

  try {
    response.json(await gradePracticeAnswer(input.data.questionId, input.data.answer))
  } catch (error) {
    if (error instanceof QuestionNotFoundError) {
      response.status(404).json({ error: '対象の設問が見つかりません。' })
      return
    }
    if (error instanceof FoundryConfigurationError) {
      response.status(503).json({ error: 'AI採点APIが設定されていません。' })
      return
    }
    console.error('Answer grading failed', error instanceof Error ? error.name : 'UnknownError')
    response.status(502).json({ error: 'AI採点を取得できませんでした。' })
  }
}