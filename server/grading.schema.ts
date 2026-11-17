import { z } from 'zod'

export const gradeAnswerRequestSchema = z.object({
  questionId: z.string().min(1).max(100),
  answer: z.string().max(5000),
}).strict()

export const gradingResultSchema = z.object({
  score: z.number().min(0),
  maxScore: z.number().positive().nullable(),
  isCorrect: z.boolean(),
  summary: z.string().min(1),
  goodPoints: z.array(z.string()),
  missingPoints: z.array(z.string()),
  incorrectPoints: z.array(z.string()),
  feedback: z.string().min(1),
  improvedAnswer: z.string().min(1),
}).strict()

export type GradeAnswerRequest = z.infer<typeof gradeAnswerRequestSchema>
export type GradingResult = z.infer<typeof gradingResultSchema>

export function isValidGradingResult(result: GradingResult): boolean {
  return result.maxScore === null || result.score <= result.maxScore
}