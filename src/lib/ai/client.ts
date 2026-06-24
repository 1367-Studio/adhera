import OpenAI from "openai"

const GROQ_BASE_URL = "https://api.groq.com/openai/v1"
export const GROQ_MODEL = "llama-3.3-70b-versatile"

export function makeGroqClient(apiKey: string) {
  return new OpenAI({ apiKey, baseURL: GROQ_BASE_URL })
}

export const platformClient = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: GROQ_BASE_URL })
  : null
