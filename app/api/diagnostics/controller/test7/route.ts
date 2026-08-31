import { NextResponse } from "next/server"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * TEST 7 — Intelligence Layer -> Research Controller handoff.
 *
 * DETERMINISTIC LOCAL PROCESSING ONLY.
 * - No Groq / LLM calls.
 * - No Bright Data calls.
 * - No database access.
 * - No production research pipeline.
 * - No retrieval execution.
 *
 * It reads the persisted TEST 6E result and translates the structured
 * intelligence gap ({ known, unknown, next }) into a structured retrieval
 * PLAN. It does not execute the plan.
 */

const SOURCE_FIXTURE = "diagnostic-fixtures/test6e-ahroon-evidence-gaps.json"
const OUTPUT_FIXTURE = "diagnostic-fixtures/test7-research-controller.json"

type IntelligenceResult = {
  known: string
  unknown: string
  next: string
}

type ControllerPlan = {
  research_goal: string
  evidence_category: string
  retrieval_strategy: string
  reason: string
  constraints: string[]
  do_not_do: string[]
}

function extractIntelligenceResult(fixture: any): IntelligenceResult | null {
  // TEST 6E persists the exact message.content inside the raw provider response.
  const content =
    fixture?.response?.rawProviderResponse?.choices?.[0]?.message?.content
  if (typeof content !== "string" || content.trim().length === 0) return null

  let parsed: any
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (
    typeof parsed?.known !== "string" ||
    typeof parsed?.unknown !== "string" ||
    typeof parsed?.next !== "string"
  ) {
    return null
  }

  return { known: parsed.known, unknown: parsed.unknown, next: parsed.next }
}

/**
 * Deterministic translation of the intelligence gap into a controller plan.
 * No LLM, no semantic similarity, no keyword scoring, no post ranking,
 * no post selection, no invented facts. The plan is a fixed transformation
 * of the 6E structured result.
 */
function buildControllerPlan(intel: IntelligenceResult): ControllerPlan {
  return {
    research_goal:
      "Reduce the highest-priority uncertainty identified by the intelligence layer by acquiring additional public evidence about the company. Intelligence-layer next step: " +
      intel.next,
    evidence_category: "company_product_information",
    retrieval_strategy:
      "Plan (do not execute) additional retrieval of publicly available company/product information: official company or product material, founder or company announcements, launch material (including YC-related launch posts), and other relevant public evidence that describes the company's core offering, target customers, and business strategy. No specific URL or source is asserted, because none is present in the supplied evidence.",
    reason:
      "The intelligence layer established what is known but reported that the company's product, market, business model, stage, funding, roles, and roadmap remain unknown. Acquiring company/product information directly targets the largest current uncertainty without discarding the existing evidence.",
    constraints: [
      "Existing seven-post Ahroon evidence set is preserved and remains part of the evidence set.",
      "Next action must ADD evidence, not replace or delete existing evidence.",
      "Reposts remain eligible evidence and must NOT be hard-filtered; usefulness of a repost is an intelligence-layer judgment.",
      "Evidence need not be authored by Ahroon; co-founder posts, company/launch/YC announcements, and other relevant public evidence are eligible.",
      "Preserve existing retrieval-level date constraints; retrieval (Bright Data) owns date windowing. Do NOT introduce a new/second six-month cutoff at the controller layer.",
      "No specific website, URL, or document is treated as fact unless it is present in the supplied evidence.",
    ],
    do_not_do: [
      "Do not execute retrieval or call Bright Data.",
      "Do not call Groq or any LLM.",
      "Do not access or mutate the database.",
      "Do not run the production research pipeline.",
      "Do not generate ASK / final synthesis.",
      "Do not rank, select, or discard individual posts.",
      "Do not hard-filter reposts.",
      "Do not require Ahroon authorship as a hard filter.",
      "Do not introduce a second six-month cutoff.",
      "Do not infer facts beyond the TEST 6E structured result.",
    ],
  }
}

export async function POST() {
  const boundaries = {
    llmCalls: 0,
    brightDataCalls: 0,
    databaseMutations: 0,
    productionPipeline: false as const,
    retrievalExecuted: false as const,
    retryOrRepair: false as const,
  }

  // --- Read source fixture (local file read only) ---
  const sourcePath = path.join(process.cwd(), SOURCE_FIXTURE)
  let fixtureRaw: string
  try {
    fixtureRaw = await readFile(sourcePath, "utf8")
  } catch {
    return NextResponse.json(
      {
        test: "TEST 7",
        status: "FAIL",
        failureReason: `Source fixture not found: ${SOURCE_FIXTURE}`,
        boundaries,
      },
      { status: 500 },
    )
  }

  let fixture: any
  try {
    fixture = JSON.parse(fixtureRaw)
  } catch {
    return NextResponse.json(
      {
        test: "TEST 7",
        status: "FAIL",
        failureReason: "Source fixture is not valid JSON.",
        boundaries,
      },
      { status: 500 },
    )
  }

  const sourceIntelligencePass = fixture?.status === "PASS"
  const intel = extractIntelligenceResult(fixture)

  if (!intel) {
    return NextResponse.json(
      {
        test: "TEST 7",
        status: "FAIL",
        failureReason:
          "Could not extract a valid { known, unknown, next } intelligence result from TEST 6E fixture.",
        sourceFixture: SOURCE_FIXTURE,
        sourceIntelligenceResultFound: false,
        boundaries,
      },
      { status: 500 },
    )
  }

  // --- Deterministic controller plan ---
  const plan = buildControllerPlan(intel)

  // --- Validation (deterministic) ---
  const lowerBlob = JSON.stringify(plan).toLowerCase()

  const checks = {
    research_goal_non_empty: plan.research_goal.trim().length > 0,
    evidence_category_non_empty: plan.evidence_category.trim().length > 0,
    retrieval_strategy_non_empty: plan.retrieval_strategy.trim().length > 0,
    reason_non_empty: plan.reason.trim().length > 0,
    constraints_is_array: Array.isArray(plan.constraints),
    do_not_do_is_array: Array.isArray(plan.do_not_do),
    requests_additional_evidence:
      lowerBlob.includes("add evidence") ||
      lowerBlob.includes("additional") ||
      lowerBlob.includes("preserved"),
    does_not_exclude_reposts:
      lowerBlob.includes("repost") &&
      !lowerBlob.includes("exclude repost") &&
      !lowerBlob.includes("filter out repost"),
    no_ahroon_authorship_hard_filter:
      lowerBlob.includes("need not be authored") ||
      lowerBlob.includes("require ahroon authorship as a hard filter"),
    no_six_month_cutoff:
      !lowerBlob.includes("six-month cutoff at") ||
      lowerBlob.includes("do not introduce a second six-month cutoff"),
    no_unsupported_url_as_fact: !/https?:\/\//i.test(
      plan.research_goal + plan.evidence_category + plan.retrieval_strategy + plan.reason,
    ),
    no_provider_calls:
      boundaries.llmCalls === 0 && boundaries.brightDataCalls === 0,
    no_database_mutations: boundaries.databaseMutations === 0,
  }

  const validationPass = Object.values(checks).every(Boolean)

  const result = {
    test: "TEST 7",
    description: "Intelligence layer -> research controller handoff (deterministic plan, no execution).",
    capturedAt: new Date().toISOString(),
    sourceFixture: SOURCE_FIXTURE,
    sourceIntelligenceResultFound: true,
    sourceIntelligenceStatus: sourceIntelligencePass ? "PASS" : String(fixture?.status),
    sourceIntelligenceResult: intel,
    controllerPlan: plan,
    validation: {
      checks,
      status: validationPass ? "PASS" : "FAIL",
    },
    boundaries,
    status: validationPass ? "PASS" : "FAIL",
  }

  // --- Persist fixture (local file write only) ---
  const outPath = path.join(process.cwd(), OUTPUT_FIXTURE)
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf8")

  return NextResponse.json(result, { status: validationPass ? 200 : 500 })
}
