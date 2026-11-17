import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity'
import { AzureOpenAI } from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { createGradingUserPrompt, gradingSystemPrompt } from './grading.prompt.js'
import { gradingResultSchema, isValidGradingResult, type GradingResult } from './grading.schema.js'

export type DescriptiveGradingInput = {
  questionText: string
  modelAnswer: string
  userAnswer: string
  maxScore: number | null
  characterLimit: number | null
  itemCharLimits: number[]
}

export class FoundryConfigurationError extends Error {}

function createFoundryClient(deployment: string) {
  const endpoint = process.env.FOUNDRY_ENDPOINT
  if (!endpoint) {
    throw new FoundryConfigurationError('FOUNDRY_ENDPOINT and FOUNDRY_DEPLOYMENT are required')
  }

  const commonOptions = {
    endpoint,
    deployment,
    apiVersion: process.env.FOUNDRY_API_VERSION ?? '2025-01-01-preview',
    timeout: 30_000,
    maxRetries: 0,
  }
  const apiKey = process.env.FOUNDRY_API_KEY
  if (apiKey) return new AzureOpenAI({ ...commonOptions, apiKey })

  const credential = new DefaultAzureCredential()
  const azureADTokenProvider = getBearerTokenProvider(credential, 'https://cognitiveservices.azure.com/.default')
  return new AzureOpenAI({ ...commonOptions, azureADTokenProvider })
}

export async function gradeDescriptiveAnswer(input: DescriptiveGradingInput): Promise<GradingResult> {
  const deployment = process.env.FOUNDRY_DEPLOYMENT
  if (!deployment) throw new FoundryConfigurationError('FOUNDRY_ENDPOINT and FOUNDRY_DEPLOYMENT are required')
  const client = createFoundryClient(deployment)
  const messages = [
    { role: 'system' as const, content: gradingSystemPrompt },
    {
      role: 'user' as const,
      content: createGradingUserPrompt(input),
    },
  ]

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await client.chat.completions.create({
      model: deployment,
      messages: attempt === 0 ? messages : [
        ...messages,
        { role: 'assistant', content: '前回の応答が指定スキーマの検証に失敗しました。' },
        { role: 'user', content: '採点内容を保ち、必須項目を全て含む有効なJSON Schema出力だけを返してください。' },
      ],
      response_format: zodResponseFormat(gradingResultSchema, 'grading_result'),
      max_completion_tokens: 1200,
    })
    const content = response.choices[0]?.message.content
    let parsed: unknown
    try {
      parsed = content ? JSON.parse(content) : null
    } catch {
      parsed = null
    }
    const result = gradingResultSchema.safeParse(parsed)
    if (result.success && isValidGradingResult(result.data)) return result.data
  }

  throw new Error('Foundry returned an invalid grading response')
}