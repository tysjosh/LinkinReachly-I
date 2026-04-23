// ---------------------------------------------------------------------------
// llm-compose.ts — Message composition, mission planning, heuristic execution
// selection, people search URL generation.
// ---------------------------------------------------------------------------

import {
  EXECUTION_REGISTRY,
  getExecutionById,
  templatesForConnectionCompose,
  templatesForFollowUpCompose,
  type ExecutionDefinition
} from '@core/executions'
import { fillTemplate, pickVariant, validateMessageBody } from '@core/message-compose'
import type { AiFieldDefinition, ProfileFacts, TargetRow } from '@core/types'
import type { AppSettings } from './settings'
import { getApiKey } from './settings'
import { callLlm, classifyLlmError, extractErrorDetail } from './llm-core'

// ── Types ────────────────────────────────────────────────────────────────

type ComposeOptions = {
  executionId: string
  forFollowUp?: boolean
  apiKeyOverride?: string | null
}

type ComposeTrace = {
  body: string
  variant: string
  route: 'llm' | 'template'
  detail: string
}

export type MissionPlanTrace = {
  title: string
  summary: string
  executionId: string
  executionLabel: string
  searchQuery: string
  searchUrl: string
  csvSeed: string
  templates: string[]
  mustInclude: string[]
  nextStep: string
  mode: 'people' | 'jobs'
  route: 'llm' | 'heuristic'
  detail: string
}

// ── Compose message ──────────────────────────────────────────────────────

export async function composeMessageDetailed(
  settings: AppSettings,
  row: TargetRow,
  facts: ProfileFacts,
  opts: ComposeOptions
): Promise<ComposeTrace> {
  const key = opts.apiKeyOverride?.trim() || getApiKey()
  const userTpl = settings.templates.length ? settings.templates : ['Hi {firstName}, would love to connect.']
  const templates = opts.forFollowUp
    ? templatesForFollowUpCompose(opts.executionId, userTpl)
    : templatesForConnectionCompose(opts.executionId, userTpl)

  if (!settings.llmEnabled) {
    const { body, variant } = pickVariant(templates, row.profileUrl)
    return {
      body: fillTemplate(body, row, facts),
      variant,
      route: 'template',
      detail: 'llm_disabled'
    }
  }

  if (!key) {
    const { body, variant } = pickVariant(templates, row.profileUrl)
    return {
      body: fillTemplate(body, row, facts),
      variant,
      route: 'template',
      detail: 'no_api_key'
    }
  }

  const kindLabel = opts.forFollowUp ? 'short LinkedIn DM (already connected)' : 'LinkedIn connection note'

  const toneLabels: Record<string, string> = {
    peer: 'professional peer — concise, direct, no flattery',
    warm_intro: 'warm introduction — reference shared context',
    job_seeker: 'career explorer — genuine interest in company/team',
    sales: 'consultative seller — lead with insight, not a pitch'
  }
  const toneDesc = toneLabels[settings.outreachTone] || toneLabels.peer

  const goalContext = settings.lastGoal?.trim()
    ? `\n## Why this person\nThe sender's outreach goal: "${settings.lastGoal.trim()}". Reference this context naturally — don't repeat it verbatim.\n`
    : ''

  const defaultPrompt = `You are writing a ${kindLabel} for a LinkedIn outreach campaign.

## Task
Write a personalized message for this specific person. Reference something concrete about them (their role, company, or industry).
${goalContext}
## Tone
${toneDesc}

## Rules
- Max 280 characters. No hashtags. No "I came across your profile" or "I hope this finds you well."
- Sound like a real person, not a bot. Be specific to the recipient.
- variant_index is 0..${templates.length - 1} (use as style reference, not copy).
- Resolve placeholders: {firstName}, {company}, {headline} from the target data.
- If the sender's background is provided, weave in a brief, relevant connection point.
- mustInclude phrases must appear in the body.

## Output
Strict JSON: {"variant_index": number, "body": string}`

  const system = (() => {
    const custom = settings.customOutreachPrompt?.trim()
    if (!custom) return defaultPrompt
    return custom
      .replace(/\{firstName\}/g, String(row.firstName || ''))
      .replace(/\{company\}/g, String(row.company || ''))
      .replace(/\{headline\}/g, String(facts.headline || row.headline || ''))
      .replace(/\{senderBackground\}/g, String(settings.userBackground || '').slice(0, 500))
      .replace(/\{goal\}/g, String(settings.lastGoal || ''))
    + `\n\nOutput strict JSON: {"variant_index": ${Math.max(templates.length - 1, 0)}, "body": string}`
  })()

  const userPayload: Record<string, unknown> = {
    templates,
    target: row,
    facts,
    mustInclude: settings.mustInclude
  }
  if (settings.userBackground?.trim()) {
    userPayload.senderBackground = settings.userBackground.trim()
  }
  const user = JSON.stringify(userPayload)

  try {
    const body = await callLlm(settings, system, user, key)
    const parsed = JSON.parse(body) as { variant_index?: number; body?: string }
    const idx = Math.min(templates.length - 1, Math.max(0, Number(parsed.variant_index) || 0))
    let text = String(parsed.body || '').trim()
    if (!text) {
      const fb = fillTemplate(templates[idx], row, facts)
      return {
        body: fb,
        variant: `T${idx}-fallback`,
        route: 'template',
        detail: 'llm_empty_body'
      }
    }
    const MAX_LEN = 280
    text = fillTemplate(text, row, facts)
    if (text.length > MAX_LEN) {
      const fb = fillTemplate(templates[idx], row, facts)
      return {
        body: fb.slice(0, MAX_LEN),
        variant: `T${idx}-validated`,
        route: 'template',
        detail: `over_limit:${text.length}`
      }
    }
    const validation = validateMessageBody(text, settings.mustInclude, MAX_LEN)
    if (!validation.ok) {
      const fb = fillTemplate(templates[idx], row, facts)
      return {
        body: fb.slice(0, MAX_LEN),
        variant: `T${idx}-validated`,
        route: 'template',
        detail: `mustInclude_fail:${validation.detail}`
      }
    }
    return {
      body: text.slice(0, MAX_LEN),
      variant: `T${idx}-llm`,
      route: 'llm',
      detail: `provider:${settings.llmProvider}`
    }
  } catch (error) {
    const { body, variant } = pickVariant(templates, row.profileUrl)
    const detail = extractErrorDetail(error)
    return {
      body: fillTemplate(body, row, facts),
      variant,
      route: 'template',
      detail: `${classifyLlmError(detail)}:${detail}`
    }
  }
}

// ── Generate AI fields ───────────────────────────────────────────────────

export async function generateAiFields(
  settings: AppSettings,
  fields: AiFieldDefinition[],
  prospect: TargetRow,
  facts: ProfileFacts,
  senderBackground?: string,
  apiKeyOverride?: string | null
): Promise<{ ok: boolean; values: Record<string, string>; detail: string }> {
  const key = apiKeyOverride?.trim() || getApiKey()
  if (!key || !settings.llmEnabled || fields.length === 0) {
    const values: Record<string, string> = {}
    for (const f of fields) values[f.name] = ''
    return { ok: false, values, detail: key ? 'llm_disabled' : 'no_api_key' }
  }

  const fieldDescriptions = fields.map((f) => ({
    name: f.name,
    instruction: f.instruction || `Generate a suitable value for "${f.name}" based on the prospect's profile.`
  }))

  const system = `You generate specific field values for a LinkedIn connection message template.

## Task
For each field below, generate a short value (1-15 words) based on the prospect's profile data and the field's instruction.

## Fields to generate
${fieldDescriptions.map((f) => `- **{${f.name}}**: ${f.instruction}`).join('\n')}

## Rules
- Each value must be concise and natural — it will be inserted into a message template.
- Use the prospect's actual data (name, company, headline) to make values specific.
- If you cannot determine a good value, produce a plausible generic alternative.
${senderBackground ? `- The sender's background: ${senderBackground.slice(0, 500)}` : ''}

## Output
Strict JSON object mapping field names to values: {"fieldName": "value", ...}`

  const user = JSON.stringify({
    prospect: {
      firstName: facts.firstName || prospect.firstName,
      company: facts.company || prospect.company,
      headline: facts.headline || prospect.headline,
      profileUrl: prospect.profileUrl
    },
    extraData: Object.fromEntries(
      Object.entries(prospect).filter(([k]) => !['profileUrl', 'firstName', 'company', 'headline'].includes(k))
    )
  })

  try {
    const body = await callLlm(settings, system, user, key)
    const parsed = JSON.parse(body) as Record<string, unknown>
    const values: Record<string, string> = {}
    for (const f of fields) {
      const raw = parsed[f.name]
      values[f.name] = typeof raw === 'string' ? raw.trim() : ''
    }
    return { ok: true, values, detail: `provider:${settings.llmProvider}` }
  } catch (error) {
    const values: Record<string, string> = {}
    for (const f of fields) values[f.name] = ''
    const detail = extractErrorDetail(error)
    return { ok: false, values, detail: `${classifyLlmError(detail)}:${detail}` }
  }
}

// ── Heuristic helpers ────────────────────────────────────────────────────

function csvSeedForExecution(execution: ExecutionDefinition): string {
  const ordered = ['profileUrl', 'firstName', 'company', 'headline', ...execution.requiredCsvHeaders]
  const seen = new Set<string>()
  const headers = ordered.filter((value) => {
    const key = value.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return headers.join(',') + '\n'
}

function heuristicExecution(prompt: string): ExecutionDefinition {
  const text = prompt.toLowerCase()
  if (/\b(follow up|follow-up|reconnect|nudge|warm up existing)\b/.test(text)) {
    return getExecutionById('post_accept_followup')!
  }
  if (/\b(job|hiring|hire|candidate|recruit|career|open role)\b/.test(text)) {
    return getExecutionById('job_signal_connection')!
  }
  if (/\b(ria|advisor|wealth manager|allocator|registered investment advisor)\b/.test(text)) {
    return getExecutionById('ria_connection')!
  }
  if (/\b(influencer|creator|founder|podcast|newsletter|content|speaker)\b/.test(text)) {
    return getExecutionById('influencer_connection')!
  }
  return getExecutionById('generic_connection')!
}

function compactAudience(prompt: string): string {
  return prompt
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^i want to\s+/i, '')
    .replace(/^help me\s+/i, '')
    .slice(0, 90)
}

function heuristicTemplates(prompt: string, execution: ExecutionDefinition): string[] {
  const audience = compactAudience(prompt) || 'people in this market'
  if (execution.id === 'job_signal_connection') {
    return [
      `Hi {firstName} - I spend time with teams around ${audience}. Thought a simple connection could be useful as hiring needs evolve at {company}.`,
      `Hi {firstName} - reaching out because ${audience} came up in my work. Would be glad to connect in case it is useful for {company}.`
    ]
  }
  if (execution.id === 'influencer_connection') {
    return [
      `Hi {firstName} - we overlap around ${audience}. I value thoughtful voices in this space and thought it made sense to connect.`,
      `Hi {firstName} - I keep track of people close to ${audience}. Your perspective stood out and I would be glad to connect.`
    ]
  }
  if (execution.id === 'ria_connection') {
    return [
      `Hi {firstName} - I am speaking with thoughtful allocator peers around ${audience}. Would be glad to connect if that is relevant on your side.`,
      `Hi {firstName} - ${audience} came up in my recent conversations with firms like {firm_name}. Thought a light connection made sense.`
    ]
  }
  if (execution.id === 'post_accept_followup') {
    return [
      `Hi {firstName} - thanks again for connecting. I am staying close to ${audience} and thought I would say hello.`,
      `Hi {firstName} - appreciate the connection. If ${audience} is relevant on your side, happy to compare notes sometime.`
    ]
  }
  return [
    `Hi {firstName} - I am reaching out to people around ${audience} and thought a simple connection could be useful.`,
    `Hi {firstName} - ${audience} came up in my work recently. Would be glad to connect if that is relevant for you.`
  ]
}

function heuristicSearchQuery(prompt: string, execution: ExecutionDefinition): string {
  const audience = compactAudience(prompt) || execution.label
  if (execution.id === 'job_signal_connection') {
    return `${audience} recruiter OR hiring manager OR talent acquisition`
  }
  if (execution.id === 'ria_connection') {
    return `${audience} advisor OR principal OR wealth management`
  }
  if (execution.id === 'influencer_connection') {
    return `${audience} founder OR creator OR operator`
  }
  if (execution.id === 'post_accept_followup') {
    return 'Use your Connections page and recent accepted invites'
  }
  return `${audience} ${execution.label.toLowerCase()}`
}

// ── People search URL ────────────────────────────────────────────────────

function sanitizeLinkedInQuery(raw: string): string {
  let q = raw
  q = q.replace(/site:\S+/gi, '')
  q = q.replace(/[()]/g, ' ')
  q = q.replace(/\bAND\b/gi, ' ')
  q = q.replace(/"([^"]{40,})"/g, '$1')
  q = q.replace(/\s+/g, ' ').trim()
  return q.slice(0, 220)
}

export function linkedInPeopleSearchUrl(query: string): string {
  const keywords = sanitizeLinkedInQuery(query) || 'linkedin'
  const params = new URLSearchParams({
    keywords,
    origin: 'SWITCH_SEARCH_VERTICAL'
  })
  return `https://www.linkedin.com/search/results/people/?${params.toString()}`
}

export function detectJobIntent(prompt: string): boolean {
  const lower = prompt.toLowerCase()
  const jobPatterns = [
    /\bfind\s+(me\s+)?jobs?\b/,
    /\bjob\s+(search|listings?|openings?|postings?)\b/,
    /\bsearch\s+(for\s+)?jobs?\b/,
    /\blooking\s+for\s+(a\s+)?(job|role|position|opening)\b/,
    /\b(roles?|positions?|openings?)\s+(at|in|near|available)\b/,
    /\bwhat\s+jobs?\b/,
    /\bhiring\s+(for|at)\b/
  ]
  return jobPatterns.some((p) => p.test(lower))
}

// ── Mission planning ─────────────────────────────────────────────────────

function heuristicSummary(prompt: string, execution: ExecutionDefinition): MissionPlanTrace {
  const templates = heuristicTemplates(prompt, execution)
  const audience = compactAudience(prompt) || execution.label.toLowerCase()
  const searchQuery = heuristicSearchQuery(prompt, execution)
  return {
    title: `${execution.label} plan`,
    summary: `Set up a ${execution.label.toLowerCase()} flow for ${audience}.`,
    executionId: execution.id,
    executionLabel: execution.label,
    searchQuery,
    searchUrl: linkedInPeopleSearchUrl(searchQuery),
    csvSeed: csvSeedForExecution(execution),
    templates,
    mustInclude: [],
    nextStep:
      execution.queueKind === 'post_accept_dm'
        ? 'Open Run and start the follow-up flow when Chrome is linked to LinkedIn.'
        : 'Find people from this plan, review the imported list, then press Start run.',
    mode: detectJobIntent(prompt) ? 'jobs' : 'people',
    route: 'heuristic',
    detail: 'heuristic'
  }
}

function normalizeMissionPlan(raw: Record<string, unknown>, prompt: string): MissionPlanTrace {
  const fallbackExecution = heuristicExecution(prompt)
  const rawExecutionId = typeof raw.executionId === 'string' ? raw.executionId : fallbackExecution.id
  const execution = getExecutionById(rawExecutionId) || fallbackExecution
  const templates = Array.isArray(raw.templates)
    ? raw.templates
        .filter((line): line is string => typeof line === 'string')
        .map((line) => line.trim())
        .filter(Boolean)
    : []
  const mustInclude = Array.isArray(raw.mustInclude)
    ? raw.mustInclude
        .filter((line): line is string => typeof line === 'string')
        .map((line) => line.trim())
        .filter(Boolean)
    : []
  const normalizedTemplates = templates.length > 0 ? templates.slice(0, 3) : heuristicTemplates(prompt, execution)
  const csvSeed =
    typeof raw.csvSeed === 'string' && raw.csvSeed.trim().length > 0
      ? raw.csvSeed.trimEnd() + '\n'
      : csvSeedForExecution(execution)
  return {
    title:
      typeof raw.title === 'string' && raw.title.trim().length > 0
        ? raw.title.trim().slice(0, 80)
        : `${execution.label} plan`,
    summary:
      typeof raw.summary === 'string' && raw.summary.trim().length > 0
        ? raw.summary.trim().slice(0, 220)
        : heuristicSummary(prompt, execution).summary,
    executionId: execution.id,
    executionLabel: execution.label,
    searchQuery:
      typeof raw.searchQuery === 'string' && raw.searchQuery.trim().length > 0
        ? raw.searchQuery.trim().slice(0, 220)
        : heuristicSearchQuery(prompt, execution),
    searchUrl: linkedInPeopleSearchUrl(
      typeof raw.searchQuery === 'string' && raw.searchQuery.trim().length > 0
        ? raw.searchQuery.trim().slice(0, 220)
        : heuristicSearchQuery(prompt, execution)
    ),
    csvSeed,
    templates: normalizedTemplates,
    mustInclude,
    nextStep:
      typeof raw.nextStep === 'string' && raw.nextStep.trim().length > 0
        ? raw.nextStep.trim().slice(0, 220)
        : heuristicSummary(prompt, execution).nextStep,
    mode: raw.mode === 'jobs' ? 'jobs' : detectJobIntent(prompt) ? 'jobs' : 'people',
    route: 'llm',
    detail: 'provider'
  }
}

export async function planMission(
  settings: AppSettings,
  prompt: string,
  apiKeyOverride?: string | null,
  previousOutreachSummary?: string
): Promise<MissionPlanTrace> {
  const trimmedPrompt = prompt.trim()
  const fallbackExecution = heuristicExecution(trimmedPrompt)
  const fallback = heuristicSummary(trimmedPrompt, fallbackExecution)
  const key = apiKeyOverride?.trim() || getApiKey()
  if (!settings.llmEnabled) {
    return { ...fallback, detail: 'llm_disabled' }
  }
  if (!key) {
    return { ...fallback, detail: 'no_api_key' }
  }

  const availableExecutions = EXECUTION_REGISTRY.map((execution) => ({
    id: execution.id,
    label: execution.label,
    description: execution.description,
    queueKind: execution.queueKind,
    requiredCsvHeaders: execution.requiredCsvHeaders
  }))

  const toneGuide: Record<string, string> = {
    peer: 'Write as a professional peer — concise, direct, no flattery. Think of messaging a colleague you respect but haven\'t met.',
    warm_intro: 'Write as if introduced by a mutual contact — warm, specific, reference a shared interest or context.',
    job_seeker: 'Write as someone exploring career opportunities — genuine interest in the company or team, not desperate.',
    sales: 'Write as a consultative seller — lead with a relevant insight or observation about their business, not a pitch.'
  }

  const system = `You are a senior LinkedIn outreach strategist. You turn plain-English goals into precise, actionable campaign plans.

## Instructions
Given the user's goal (and optionally their background), produce a campaign setup:
1. Pick one executionId from the provided registry.
2. Generate 1-3 short, professional message templates matching the tone.
3. Create a searchQuery: simple LinkedIn People Search keywords (3-8 words). No site:, parentheses, or complex boolean. Just natural keywords like "hedge fund portfolio manager" or "fintech product manager series B". You may use OR between alternatives.
4. Determine mode: "people" for networking/outreach, "jobs" for job search.

## Tone
${toneGuide[settings.outreachTone] || toneGuide.peer}

## Rules
- Prefer connection invite flows unless user explicitly asks for follow-up.
- Templates: max 280 chars each, no hashtags, no clichés like "I came across your profile."
- csvSeed: a single CSV header row ending with profileUrl.
- If previousOutreach is provided, avoid suggesting the same audience segment.

## Output
Strict JSON:
{"title":string,"summary":string,"executionId":string,"searchQuery":string,"mode":string,"csvSeed":string,"templates":string[],"mustInclude":string[],"nextStep":string}

## Examples

Input: {"prompt":"Connect with fintech founders in NYC"}
Output: {"title":"NYC Fintech Founder Outreach","summary":"Connection campaign targeting fintech founders and co-founders in the New York area.","executionId":"generic_connection","searchQuery":"fintech founder CEO New York","mode":"people","csvSeed":"profileUrl,firstName,company,headline","templates":["Hi {firstName}, I work in fintech too and noticed {company} — would be great to connect.","Hey {firstName}, always looking to meet fellow builders in NYC fintech. Let's connect."],"mustInclude":[],"nextStep":"Find people from this plan, review messages, then send."}

Input: {"prompt":"I want to find a job as a product manager at an AI startup"}
Output: {"title":"AI Startup PM Job Search","summary":"Search for product manager openings at AI-focused startups.","executionId":"generic_connection","searchQuery":"product manager AI startup","mode":"jobs","csvSeed":"profileUrl,firstName,company,headline","templates":["Hi {firstName}, I'm exploring PM roles in AI and {company} caught my eye. Would love to learn more about the team."],"mustInclude":[],"nextStep":"Switching to job search to find matching openings."}`

  const userPayload: Record<string, unknown> = {
    prompt: trimmedPrompt,
    executions: availableExecutions
  }
  const bg = settings.userBackground?.trim()
  const resume = settings.resumeText?.trim()
  if (bg) {
    userPayload.myBackground = bg
  } else if (resume && resume.length >= 100) {
    userPayload.myBackground = resume.slice(0, 4000)
  }
  if (previousOutreachSummary?.trim()) {
    userPayload.previousOutreach = previousOutreachSummary.trim()
  }
  const user = JSON.stringify(userPayload)

  try {
    const body = await callLlm(settings, system, user, key)
    const parsed = JSON.parse(body) as Record<string, unknown>
    const normalized = normalizeMissionPlan(parsed, trimmedPrompt)
    return {
      ...normalized,
      route: 'llm',
      detail: `provider:${settings.llmProvider}`
    }
  } catch (error) {
    const detail = extractErrorDetail(error)
    return { ...fallback, detail: `${classifyLlmError(detail)}:${detail}` }
  }
}
