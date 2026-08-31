import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

const FIXTURE_PATH = path.join(process.cwd(), 'diagnostic-fixtures', 'test4d-ahroon-compacted.json')
const RESULT_PATH = path.join(process.cwd(), 'diagnostic-fixtures', 'test6c-ahroon-evidence-gaps.json')
const EXPECTED_IDS = [
  '7498710459660021761', '7498327134676107264', '7497974835789275138',
  '7497601173051482112', '7497258519570583552', '7495839682195374080', '7494762712376418305',
]
const MODEL = 'openai/gpt-oss-20b'
const SYSTEM_PROMPT = `You are an evidence-gap analyst. Analyze all seven supplied founder posts together. Use only the supplied evidence. Distinguish directly supported facts, reasonable inferences, and unknowns. Identify only important evidence gaps and propose a sensible next-evidence acquisition plan; do not execute retrieval. Do not invent facts, URLs, or sources. Reposts remain admissible evidence. Return ONLY a valid JSON object matching the schema; no markdown or text outside JSON.`
const RESEARCH_OBJECTIVE = `Understand what Ahroon Santhosh is currently building, why he is building it, who is involved, the current state of the company/product, and what important facts a researcher still needs to know.`
const SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'evidence_gap_minimal',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        known: { type: 'string' },
        unknown: { type: 'string' },
        next: { type: 'string' },
      },
      required: ['known', 'unknown', 'next'],
      additionalProperties: false,
    },
  },
}

async function loadFixture() {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'))
  const posts = Array.isArray(fixture.posts) ? fixture.posts : []
  const ids = posts.map((post: any) => String(post?.id ?? ''))
  const valid = fixture.post_count === 7 && posts.length === 7 && EXPECTED_IDS.every((id) => ids.includes(id))
  if (!valid) throw new Error(`Fixture validation failed: expected all 7 TEST 5B post IDs; received ${ids.join(', ')}`)
  return { fixture, posts, ids }
}

function hasOnlyExpectedIds(value: unknown, ids: Set<string>): boolean {
  if (Array.isArray(value)) return value.every((item) => hasOnlyExpectedIds(item, ids))
  if (!value || typeof value !== 'object') return true
  return Object.entries(value).every(([key, child]) => key.endsWith('post_ids') || key === 'post_id' ? Array.isArray(child) ? child.every((id) => typeof id === 'string' && ids.has(id)) : typeof child === 'string' && ids.has(child) : hasOnlyExpectedIds(child, ids))
}

export async function POST() {
  let input: Awaited<ReturnType<typeof loadFixture>>
  try { input = await loadFixture() } catch (error) {
    return NextResponse.json({ test: 'TEST 6C', status: 'FAIL', error: error instanceof Error ? error.message : 'Fixture unavailable', brightDataCalls: 0, llmCalls: 0, databaseMutations: 0 }, { status: 422 })
  }
  const evidence = JSON.stringify(input.posts)
  const userPrompt = `Research objective: ${RESEARCH_OBJECTIVE}\n\nDetermine the most important established facts, the most important unknowns, and the three highest-value types of additional evidence to retrieve next. Put the answer only in the three string fields known, unknown, and next. All seven posts are supplied below; do not omit any. Do not execute retrieval. Do not add fields.\n\nCOMPLETE EVIDENCE:\n${evidence}`
  const estimatedInputTokens = Math.ceil(`${SYSTEM_PROMPT}\n${userPrompt}`.length / 4)
  const requestMetadata = { provider: 'Groq', model: MODEL, responseFormat: 'text', maxOutputTokens: 1600, postsSupplied: 7, estimatedInputTokens }
  if (!process.env.GROQ_API_KEY) return NextResponse.json({ test: 'TEST 6C', status: 'FAIL', error: 'GROQ_API_KEY is not configured.', request: requestMetadata, brightDataCalls: 0, llmCalls: 0, databaseMutations: 0 }, { status: 502 })

  const started = Date.now()
  let response: Response
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 1600, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }] }), signal: AbortSignal.timeout(90000) })
  } catch (error) {
    return NextResponse.json({ test: 'TEST 6C', status: 'FAIL', request: requestMetadata, error: error instanceof Error ? error.message : 'LLM request failed', brightDataCalls: 0, llmCalls: 1, databaseMutations: 0 }, { status: 502 })
  }

  const rawBody = await response.text()
  let providerPayload: any = null
  try { providerPayload = JSON.parse(rawBody) } catch { providerPayload = null }
  const content = providerPayload?.choices?.[0]?.message?.content
  let parsed: any = null
  try { parsed = typeof content === 'string' && content.trim() ? JSON.parse(content) : null } catch { parsed = null }
  const expectedSet = new Set<string>(input.ids)
  const validShape = parsed && typeof parsed === 'object' && Object.keys(parsed).length === 3 && ['known', 'unknown', 'next'].every((key) => key in parsed) && typeof parsed.known === 'string' && typeof parsed.unknown === 'string' && typeof parsed.next === 'string'
  const validCitations = Boolean(validShape && hasOnlyExpectedIds(parsed, expectedSet))
  const structuredValid = Boolean(response.ok && content && validShape && validCitations)
  const result = {
    test: 'TEST 6C', capturedAt: new Date().toISOString(), sourceFixture: 'diagnostic-fixtures/test4d-ahroon-compacted.json', postIdsSupplied: input.ids,
    request: requestMetadata,
    response: { httpStatus: response.status, statusText: response.statusText, latencyMs: Date.now() - started, actualInputTokens: providerPayload?.usage?.prompt_tokens ?? providerPayload?.usage?.input_tokens ?? null, actualOutputTokens: providerPayload?.usage?.completion_tokens ?? providerPayload?.usage?.output_tokens ?? null, messageContentPresent: Boolean(content), messageReasoningPresent: Boolean(providerPayload?.choices?.[0]?.message?.reasoning), rawProviderResponse: providerPayload ? { ...providerPayload, choices: providerPayload.choices?.map((choice: any) => ({ ...choice, message: choice.message ? { ...choice.message, reasoning: choice.message.reasoning ? '[REDACTED FROM DIAGNOSTIC]' : undefined } : choice.message })) } : rawBody, messageContent: content ?? null, parsedJson: parsed, providerError: response.ok ? null : providerPayload?.error ?? rawBody },
    validation: { structuredJson: structuredValid ? 'VALID' : 'INVALID', allExpectedPostIdsSupplied: input.ids.length === 7 && EXPECTED_IDS.every((id) => input.ids.includes(id)), citationsUseOnlySuppliedIds: validCitations },
    boundaries: { brightDataCalls: 0, llmCalls: 1, databaseMutations: 0, productionPipeline: false, askGeneration: false, finalSynthesis: false, semanticFilteringBeforeLlm: false, repostFiltering: false },
    status: structuredValid ? 'PASS' : 'FAIL', failureReason: structuredValid ? null : response.ok ? 'Structured JSON missing, invalid, or cited an unsupplied post ID.' : 'Groq provider request failed.',
  }
  await writeFile(RESULT_PATH, JSON.stringify(result, null, 2))
  return NextResponse.json(result, { status: structuredValid ? 200 : 502 })
}

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export async function GET() { return POST() }
