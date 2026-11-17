import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { postGradeAnswer } from './answer.controller.js'

const allowedOrigins = new Set((process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean))

export const app = express()

app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
}))
app.use(express.json({ limit: '16kb' }))
app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
app.post('/api/answers/grade', rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: '採点リクエストが多すぎます。しばらくしてから再試行してください。' },
}), postGradeAnswer)