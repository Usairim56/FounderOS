import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

const FIXTURE_PATH = path.join(process.cwd(), 'diagnostic-fixtures', 'test4d-ahroon-compacted.json')
const RESULT_PATH = path.join(process.cwd(), 'diagnostic-fixtures', 'test6d-ahroon-evidence-gaps.json')
const EXPECTED_IDS = [
  '7498710459660021761', '7498327134676107264', '7497974835789275138',
  '7497601173051482112', '7497258519570583552', '7495839682195374080', '7494762712376418305',
]
const MODEL = 'openai/gpt-oss-20b'

// TEST 6D experimental variables (vs TEST 6C):
//  - Substantially larger output budget so reasoning cannot starve message.content.
//  - Lowest reasonable reasoning effort that still permits competent analysis.
// Everything else (text generation, no native JSON-schema enforcement, single request,
// all 7 posts supplied, no filtering) is held constant from TEST 6C.
const MAX_OUTPUT_TOKENS = 8192
const REASONING_EFFORT = 'low'

const SYSTEM_PROMPT = `You are an evidence-gap analyst. Analyze all seven supplied founder posts together. Use only the supplied evidence. Distinguish directly supported facts, reasonable inferences, and unknowns. Identify only important evidence gaps and propose a sensible next-evidence acquisition plan; do not execute retrieval. Do not invent facts, URLs, or sources. Reposts remain admissible evidence. Return ONLY a valid JSON object matching the schema; no markdown, no code fences, no text outside the JSON.`
const RESEARCH_OBJECTIVE = `Understand what Ahroon Santhosh is currently building, why he is building it, who is involved, the current state of the company/product, and what important facts a researcher still needs to know.`

async function loadFixture() {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'))
  const posts = Array.isArray(fixture.posts) ? fixture.posts : []
  const ids = posts.map((post: any) => String(post?.id ?? ''))
  const valid = fixture.post_count === 7 && posts.length === 7 && EXPECTED_IDS.every((id) => ids.includes(id))
  if (!valid) throw new Error(`Fixture validation failed: expected all 7 Ahroon post IDs; received ${ids.join(', ')}`)
  return { fixture, posts, ids }
}

function hasOnlyExpectedIds(value: unknown, ids: Set<string>): boolean {
  if (Array.isArray(value)) return value.every((item) => hasOnlyExpectedIds(item, ids))
  if (!value || typeof value !== 'object') return true
  return Object.entries(value).every(([key, child]) =>
    key.endsWith('post_ids') || key === 'post_id'
      ? Array.isArray(child)
        ? child.every((id) => typeof id === 'string' && ids.has(id))
        : typeof child === 'string' && ids.has(child)
      : hasOnlyExpectedIds(child, ids),
  )
}

export async function POST() {
  let input: Awaited<ReturnType<typeof loadFixture>>
  try {
    input = await loadFixture()
  } catch (error) {
    return NextResponse.json({ test: 'TEST 6D', status: 'FAIL', error: error instanceof Error ? error.message : 'Fixture unavailable', brightDataCalls: 0, llmCalls: 0, databaseMutations: 0 }, { status: 422 })
  }

  const evidence = JSON.stringify(input.posts)
  const userPrompt = `Research objective: ${RESEARCH_OBJECTIVE}\n\nPerform evidence-gap analysis over the COMPLETE supplied evidence. Determine (1) what is already established by the evidence, (2) what important information remains unknown, and (3) which single category of evidence should be retrieved next to reduce the most important uncertainty. Put the answer only in the three string fields "known", "unknown", and "next". All seven posts are supplied below; do not omit or filter any. Do not execute retrieval. Do not add fields. Return ONLY the JSON object {"known":"...","unknown":"...","next":"..."}.\n\nCOMPLETE EVIDENCE:\n${evidence}`
  const estimatedInputTokens = Math.ceil(`${SYSTEM_PROMPT}\n${userPrompt}`.length / 4)
  const requestMetadata = { provider: 'Groq', model: MODEL, responseFormat: 'text', maxOutputTokens: MAX_OUTPUT_TOKENS, reasoningEffort: REASONING_EFFORT, postsSupplied: 7, estimatedInputTokens }

  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json({ test: 'TEST 6D', status: 'FAIL', error: 'GROQ_API_KEY is not configured.', request: requestMetadata, brightDataCalls: 0, llmCalls: 0, databaseMutations: 0 }, { status: 502 })
  }

  const started = Date.now()
  let response: Response
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: REASONING_EFFORT,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(120000),
    })
  } catch (error) {
    return NextResponse.json({ test: 'TEST 6D', status: 'FAIL', request: requestMetadata, error: error instanceof Error ? error.message : 'LLM request failed', brightDataCalls: 0, llmCalls: 1, databaseMutations: 0 }, { status: 502 })
  }

  const rawBody = await response.text()
  let providerPayload: any = null
  try {
    providerPayload = JSON.parse(rawBody)
  } catch {
    providerPayload = null
  }
  const content = providerPayload?.choices?.[0]?.message?.content
  const finishReason = providerPayload?.choices?.[0]?.finish_reason ?? null
  // Never substitute reasoning for message.content: parse ONLY message.content.
  let parsed: any = null
  try {
    parsed = typeof content === 'string' && content.trim() ? JSON.parse(content) : null
  } catch {
    parsed = null
  }
  const expectedSet = new Set<string>(input.ids)
  const validShape = parsed && typeof parsed === 'object' && Object.keys(parsed).length === 3 && ['known', 'unknown', 'next'].every((key) => key in parsed) && typeof parsed.known === 'string' && typeof parsed.unknown === 'string' && typeof parsed.next === 'string'
  const validCitations = Boolean(validShape && hasOnlyExpectedIds(parsed, expectedSet))
  const structuredValid = Boolean(response.ok && content && validShape && validCitations)

  const result = {
    test: 'TEST 6D', capturedAt: new Date().toISOString(), sourceFixture: 'diagnostic-fixtures/test4d-ahroon-compacted.json', postIdsSupplied: input.ids,
    request: requestMetadata,
    response: {
      httpStatus: response.status, statusText: response.statusText, latencyMs: Date.now() - started, finishReason,
      actualInputTokens: providerPayload?.usage?.prompt_tokens ?? providerPayload?.usage?.input_tokens ?? null,
      actualOutputTokens: providerPayload?.usage?.completion_tokens ?? providerPayload?.usage?.output_tokens ?? null,
      reasoningTokens: providerPayload?.usage?.completion_tokens_details?.reasoning_tokens ?? providerPayload?.usage?.reasoning_tokens ?? null,
      messageContentPresent: Boolean(content),
      messageReasoningPresent: Boolean(providerPayload?.choices?.[0]?.message?.reasoning),
      // Persist the full provider payload but redact the reasoning text body (keep only its presence flag).
      rawProviderResponse: providerPayload ? { ...providerPayload, choices: providerPayload.choices?.map((choice: any) => ({ ...choice, message: choice.message ? { ...choice.message, reasoning: choice.message.reasoning ? '[REASONING PRESENT — REDACTED FROM DIAGNOSTIC]' : undefined } : choice.message })) } : rawBody,
      messageContent: content ?? null,
      parsedJson: parsed,
      providerError: response.ok ? null : providerPayload?.error ?? rawBody,
    },
    validation: {
      structuredJson: structuredValid ? 'VALID' : 'INVALID',
      messageContentNonEmpty: Boolean(content && String(content).trim()),
      jsonParse: parsed ? 'PASS' : 'FAIL',
      requiredFields: validShape ? 'PASS' : 'FAIL',
      allExpectedPostIdsSupplied: input.ids.length === 7 && EXPECTED_IDS.every((id) => input.ids.includes(id)),
      citationsUseOnlySuppliedIds: validCitations,
    },
    boundaries: { brightDataCalls: 0, llmCalls: 1, databaseMutations: 0, productionPipeline: false, askGeneration: false, finalSynthesis: false, semanticFilteringBeforeLlm: false, repostFiltering: false, retryOrRepair: false },
    status: structuredValid ? 'PASS' : 'FAIL',
    failureReason: structuredValid ? null : response.ok ? (content ? 'message.content present but JSON invalid or cited an unsupplied post ID.' : `message.content empty (finish_reason: ${finishReason}).`) : 'Groq provider request failed.',
  }

  await writeFile(RESULT_PATH, JSON.stringify(result, null, 2))
  return NextResponse.json(result, { status: structuredValid ? 200 : 502 })
}

export const dynamic = 'force-dynamic'
export const maxDuration = 180
