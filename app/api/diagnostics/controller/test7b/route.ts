import { NextResponse } from "next/server"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const SOURCE_FIXTURE = "diagnostic-fixtures/test6e-ahroon-evidence-gaps.json"
const OUTPUT_FIXTURE = "diagnostic-fixtures/test7b-research-controller.json"

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
  derivation: {
    sourceFields: IntelligenceResult
    categoryDerivation: string
    strategySignals: string[]
    counterfactual: {
      compared: boolean
      research_goal_differs: boolean
      retrieval_strategy_differs: boolean
      reason_differs: boolean
      passed: boolean
    } | null
  }
}

const GENERIC_CONSTRAINTS = [
  "Existing evidence is additive and must not be replaced or discarded.",
  "New evidence may be added to the existing evidence set.",
  "Reposts must not be hard-filtered.",
  "Founder-authorship must not be a hard filter.",
  "Retrieval owns date-windowing; do not introduce a second six-month cutoff.",
  "Do not treat unsupported URLs, entities, or facts as established.",
] as const

const GENERIC_DO_NOT_DO = [
  "Do not execute retrieval.",
  "Do not call Groq or any LLM.",
  "Do not call Bright Data.",
  "Do not access or mutate the database.",
  "Do not invoke the production research pipeline.",
  "Do not generate final synthesis or ASK output.",
  "Do not rank, select, or discard posts.",
  "Do not infer facts beyond the supplied intelligence.",
] as const

const COUNTERFACTUAL_INTEL: IntelligenceResult = {
  known:
    "The subject has published technical writing about distributed systems.",
  unknown:
    "The subject's current employment, organization, and intended audience remain unknown.",
  next:
    "Find public employment and organization evidence that clarifies the subject's current professional affiliation.",
}

function extractIntelligenceResult(
  fixture: any,
): IntelligenceResult | null {
  const content =
    fixture?.response?.rawProviderResponse?.choices?.[0]?.message?.content

  if (typeof content !== "string" || content.trim().length === 0) {
    return null
  }

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

  return {
    known: parsed.known.trim(),
    unknown: parsed.unknown.trim(),
    next: parsed.next.trim(),
  }
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

/**
 * This is intentionally NOT a production classifier.
 *
 * The category is derived directly from the intelligence payload.
 * The first unresolved question in `unknown` becomes the category label.
 */
function deriveEvidenceCategory(intel: IntelligenceResult): {
  category: string
  explanation: string
} {
  const firstQuestion =
    normalize(intel.unknown)
      .split(/[.;?]/)
      .map((part) => part.trim())
      .find(Boolean) ?? normalize(intel.next)

  return {
    category: firstQuestion,
    explanation:
      "Derived deterministically from the first unresolved statement in intel.unknown; this is diagnostic composition, not a production taxonomy or classifier.",
  }
}

function buildControllerPlan(
  intel: IntelligenceResult,
): ControllerPlan {
  const category = deriveEvidenceCategory(intel)

  return {
    research_goal:
      `Reduce the unresolved uncertainty identified by the intelligence layer by pursuing the stated next step: ${intel.next}`,

    evidence_category: category.category,

    retrieval_strategy:
      `Plan additional public-evidence retrieval around the intelligence layer's next step: ${intel.next} The retrieval should address this unresolved information: ${intel.unknown}`,

    reason:
      `The intelligence layer identifies the following unresolved information: ${intel.unknown} The known context is retained as context rather than replaced: ${intel.known}`,

    constraints: [...GENERIC_CONSTRAINTS],

    do_not_do: [...GENERIC_DO_NOT_DO],

    derivation: {
      sourceFields: {
        known: intel.known,
        unknown: intel.unknown,
        next: intel.next,
      },
      categoryDerivation: category.explanation,
      strategySignals: [
        "intel.next directly determines the retrieval objective.",
        "intel.unknown directly determines the evidence gap being addressed.",
      ],
      counterfactual: null,
    },
  }
}

function containsUrl(value: string): boolean {
  return /https?:\/\//i.test(value)
}

function materiallyReferences(
  text: string,
  source: string,
): boolean {
  return text.includes(source)
}

export async function POST() {
  const boundaries = {
    llmCalls: 0,
    brightDataCalls: 0,
    databaseMutations: 0,
    productionPipelineInvocations: 0,
    researchEngineInvocations: 0,
    retrievalExecuted: false,
  }

  const sourcePath = path.join(process.cwd(), SOURCE_FIXTURE)

  let fixtureRaw: string

  try {
    fixtureRaw = await readFile(sourcePath, "utf8")
  } catch {
    return NextResponse.json(
      {
        test: "TEST 7B",
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
        test: "TEST 7B",
        status: "FAIL",
        failureReason: "Source fixture is not valid JSON.",
        boundaries,
      },
      { status: 500 },
    )
  }

  const intel = extractIntelligenceResult(fixture)

  if (!intel) {
    return NextResponse.json(
      {
        test: "TEST 7B",
        status: "FAIL",
        failureReason:
          "Could not extract { known, unknown, next } from TEST 6E.",
        boundaries,
      },
      { status: 500 },
    )
  }

  const plan = buildControllerPlan(intel)
  const counterfactualPlan =
    buildControllerPlan(COUNTERFACTUAL_INTEL)

  const researchGoalDiffers =
    plan.research_goal !== counterfactualPlan.research_goal

  const retrievalStrategyDiffers =
    plan.retrieval_strategy !==
    counterfactualPlan.retrieval_strategy

  const reasonDiffers =
    plan.reason !== counterfactualPlan.reason

  const counterfactualPassed =
    researchGoalDiffers &&
    retrievalStrategyDiffers &&
    reasonDiffers

  plan.derivation.counterfactual = {
    compared: true,
    research_goal_differs: researchGoalDiffers,
    retrieval_strategy_differs: retrievalStrategyDiffers,
    reason_differs: reasonDiffers,
    passed: counterfactualPassed,
  }

  const narrative =
    plan.research_goal +
    plan.evidence_category +
    plan.retrieval_strategy +
    plan.reason

  const checks = {
    required_fields_exist:
      typeof plan.research_goal === "string" &&
      typeof plan.evidence_category === "string" &&
      typeof plan.retrieval_strategy === "string" &&
      typeof plan.reason === "string" &&
      Array.isArray(plan.constraints) &&
      Array.isArray(plan.do_not_do) &&
      typeof plan.derivation === "object",

    research_goal_contains_actual_next:
      materiallyReferences(plan.research_goal, intel.next),

    reason_contains_actual_unknown:
      materiallyReferences(plan.reason, intel.unknown),

    retrieval_strategy_contains_actual_next:
      materiallyReferences(
        plan.retrieval_strategy,
        intel.next,
      ),

    retrieval_strategy_contains_actual_unknown:
      materiallyReferences(
        plan.retrieval_strategy,
        intel.unknown,
      ),

    evidence_category_is_derived:
      plan.evidence_category ===
        deriveEvidenceCategory(intel).category &&
      plan.evidence_category !==
        "company_product_information",

    counterfactual_changes_goal:
      researchGoalDiffers,

    counterfactual_changes_strategy:
      retrievalStrategyDiffers,

    counterfactual_changes_reason:
      reasonDiffers,

    counterfactual_passed:
      counterfactualPassed,

    no_invented_urls:
      !containsUrl(narrative),

    generic_additive_policy:
      plan.constraints.some((value) =>
        value.includes("additive"),
      ),

    generic_repost_policy:
      plan.constraints.some((value) =>
        value.includes("Reposts"),
      ),

    generic_authorship_policy:
      plan.constraints.some((value) =>
        value.includes("Founder-authorship"),
      ),

    generic_date_cutoff_policy:
      plan.constraints.some((value) =>
        value.includes("second six-month cutoff"),
      ),

    generic_unsupported_fact_policy:
      plan.constraints.some((value) =>
        value.includes("unsupported URLs"),
      ),

    no_provider_calls:
      boundaries.llmCalls === 0 &&
      boundaries.brightDataCalls === 0,

    no_database_mutations:
      boundaries.databaseMutations === 0,

    no_production_pipeline:
      boundaries.productionPipelineInvocations === 0,

    no_research_engine:
      boundaries.researchEngineInvocations === 0,

    retrieval_not_executed:
      boundaries.retrievalExecuted === false,
  }

  const validationPass =
    Object.values(checks).every(Boolean)

  const result = {
    test: "TEST 7B",
    capturedAt: new Date().toISOString(),
    sourceFixture: SOURCE_FIXTURE,
    sourceIntelligenceResult: intel,
    controllerPlan: plan,
    counterfactual: {
      writtenAsFixture: false,
      research_goal: researchGoalDiffers,
      retrieval_strategy: retrievalStrategyDiffers,
      reason: reasonDiffers,
      passed: counterfactualPassed,
    },
    validation: {
      checks,
      status: validationPass ? "PASS" : "FAIL",
    },
    boundaries,
    status: validationPass ? "PASS" : "FAIL",
  }

  const outputPath = path.join(
    process.cwd(),
    OUTPUT_FIXTURE,
  )

  await writeFile(
    outputPath,
    JSON.stringify(result, null, 2),
    "utf8",
  )

  return NextResponse.json(result, {
    status: validationPass ? 200 : 500,
  })
}