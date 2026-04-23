// ---------------------------------------------------------------------------
// job-scorer.ts — Heuristic job-fit scoring engine.  Pure functions, no
// Electron imports, no I/O.  Scores a job against a UserProfile using
// multi-dimensional matching with recency weighting.
// ---------------------------------------------------------------------------

import type {
  UserProfile,
  ProfileEntry,
  RequirementMatch,
  JobFitReport
} from './profile-db'
import { calculateRecencyWeight, recommendationFromScore } from './profile-db'

// ── Public types ──────────────────────────────────────────────────────────

export interface JobPosting {
  title: string
  company: string
  location: string
  jobUrl: string
  description?: string
  postedDate?: string
  requirements?: string[]   // extracted from JD
  niceToHave?: string[]
}

interface HeuristicScoreResult {
  overall: number             // 0-100
  dimensions: {
    skillMatch: number        // 0-100
    domainMatch: number       // 0-100
    seniorityFit: number      // 0-100
    recencyBoost: number      // 0-100
    titleRelevance: number    // 0-100
  }
  matchedRequirements: RequirementMatch[]
  strengths: string[]
  gaps: string[]
  recommendation: JobFitReport['recommendation']
}

// ── Internal constants ────────────────────────────────────────────────────

/** Weights for combining dimension scores into an overall score. */
const WEIGHTS = {
  skillMatch: 0.30,
  domainMatch: 0.20,
  seniorityFit: 0.20,
  recencyBoost: 0.15,
  titleRelevance: 0.15
} as const

/** Map job-title keywords to experience-type tags from the profile. */
const TITLE_TO_EXPERIENCE_TYPE: Array<{ patterns: RegExp[]; types: string[] }> = [
  { patterns: [/founder/i, /co-?founder/i, /CEO/i], types: ['founder', 'ceo'] },
  { patterns: [/CTO/i, /chief technology/i], types: ['founder', 'cto', 'engineering_lead'] },
  { patterns: [/COO/i, /chief operating/i, /chief of staff/i], types: ['chief_of_staff', 'operations'] },
  { patterns: [/engineer/i, /developer/i, /software/i], types: ['engineer', 'software', 'developer'] },
  { patterns: [/product\s+manager/i, /\bPM\b/], types: ['product_manager', 'product'] },
  { patterns: [/analyst/i], types: ['analyst', 'research'] },
  { patterns: [/account\s+executive/i, /\bAE\b/, /sales/i, /business\s+development/i, /\bBDR\b/i], types: ['sales', 'business_development', 'account_executive'] },
  { patterns: [/partner/i, /partnerships/i, /alliances/i], types: ['partnerships', 'business_development', 'founder'] },
  { patterns: [/growth/i, /marketing/i, /GTM/i, /go.to.market/i], types: ['growth', 'marketing', 'gtm'] },
  { patterns: [/strateg/i, /consulting/i], types: ['strategy', 'consulting'] },
  { patterns: [/director/i, /VP/i, /head\s+of/i, /lead/i], types: ['director', 'vp', 'lead'] },
  { patterns: [/research/i], types: ['research', 'analyst'] },
  { patterns: [/intern/i], types: ['intern'] }
]

/** Seniority levels mapped from title keywords. Lower = more junior. */
const SENIORITY_LEVELS: Array<{ patterns: RegExp[]; level: number }> = [
  { patterns: [/intern/i], level: 1 },
  { patterns: [/junior/i, /associate/i, /entry/i], level: 2 },
  { patterns: [/analyst/i, /coordinator/i], level: 3 },
  { patterns: [/senior/i, /\bsr\.?\b/i], level: 4 },
  { patterns: [/lead/i, /staff/i, /principal/i, /manager/i], level: 5 },
  { patterns: [/director/i, /head\s+of/i], level: 6 },
  { patterns: [/VP/i, /vice\s+president/i], level: 7 },
  { patterns: [/chief/i, /\bC[A-Z]O\b/i, /founder/i, /partner/i], level: 8 }
]

// ── Helper functions ──────────────────────────────────────────────────────

function extractSeniorityLevel(title: string): number {
  let best = -1
  for (const { patterns, level } of SENIORITY_LEVELS) {
    if (patterns.some(p => p.test(title))) {
      best = Math.max(best, level)
    }
  }
  return best === -1 ? 3 : best
}

function extractExperienceTypes(title: string): string[] {
  const types: string[] = []
  for (const { patterns, types: t } of TITLE_TO_EXPERIENCE_TYPE) {
    if (patterns.some(p => p.test(title))) {
      types.push(...t)
    }
  }
  return [...new Set(types)]
}

function profileSeniorityLevel(profile: UserProfile): number {
  if (profile.entries.length === 0) return 3
  // Use the most senior recent role (top 3 by recency)
  const sorted = [...profile.entries].sort((a, b) => b.recencyWeight - a.recencyWeight)
  const top = sorted.slice(0, 3)
  let best = 1
  for (const entry of top) {
    const level = extractSeniorityLevel(entry.role)
    best = Math.max(best, level)
  }
  return best
}

function tokenize(text: string): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9&+#]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
}

function textOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  const matches = a.filter(w => setB.has(w))
  return matches.length / a.length
}

// ── Dimension scorers ─────────────────────────────────────────────────────

function scoreSkillMatch(profile: UserProfile, job: JobPosting): { score: number; matched: string[]; missing: string[] } {
  const jobText = [job.title, job.description || '', ...(job.requirements || [])].join(' ').toLowerCase()
  const jobTokens = tokenize(jobText)

  const allProfileSkills = new Set<string>()
  for (const entry of profile.entries) {
    for (const skill of entry.skills || []) {
      allProfileSkills.add(skill.toLowerCase())
    }
  }

  // Match profile skills against job text
  const matched: string[] = []
  const allJobRequirements = job.requirements || []

  for (const skill of allProfileSkills) {
    const skillTokens = tokenize(skill)
    if (skillTokens.some(t => jobTokens.includes(t))) {
      matched.push(skill)
    }
  }

  // Check for requirements not matched
  const missing: string[] = []
  for (const req of allJobRequirements) {
    const reqTokens = tokenize(req)
    const matchCount = reqTokens.filter(t => {
      for (const skill of allProfileSkills) {
        if (tokenize(skill).includes(t)) return true
      }
      return false
    }).length
    if (matchCount < reqTokens.length * 0.5) missing.push(req)
  }

  // Score: weighted by recency of the entries where skills appeared
  let weightedMatches = 0
  let totalWeight = 0
  for (const entry of profile.entries) {
    const entrySkillsLower = (entry.skills || []).map(s => s.toLowerCase())
    const entryMatched = entrySkillsLower.filter(s => {
      const skillTokens = tokenize(s)
      return skillTokens.some(t => jobTokens.includes(t))
    })
    if (entryMatched.length > 0) {
      weightedMatches += (entryMatched.length / Math.max(1, entrySkillsLower.length)) * entry.recencyWeight
      totalWeight += entry.recencyWeight
    }
  }

  const baseRatio = allProfileSkills.size > 0
    ? matched.length / Math.max(matched.length + missing.length, 1)
    : 0
  const recencyBonus = totalWeight > 0 ? weightedMatches / totalWeight : 0
  const score = Math.round(Math.min(100, (baseRatio * 60 + recencyBonus * 40)))

  return { score, matched, missing }
}

function scoreDomainMatch(profile: UserProfile, job: JobPosting): number {
  const jobText = [job.title, job.company, job.description || ''].join(' ').toLowerCase()

  // Collect all domains from profile, weighted by recency
  const domainWeights = new Map<string, number>()
  for (const entry of profile.entries) {
    for (const domain of entry.domain || []) {
      const current = domainWeights.get(domain) || 0
      domainWeights.set(domain, Math.max(current, entry.recencyWeight))
    }
  }

  if (domainWeights.size === 0) return 50 // neutral

  let bestMatch = 0
  for (const [domain, weight] of domainWeights) {
    if (jobText.includes(domain.toLowerCase())) {
      bestMatch = Math.max(bestMatch, weight * 100)
    }
  }

  // Also check for broad text overlap between profile bullets and job description
  if (bestMatch === 0 && job.description) {
    const profileTokens = profile.entries
      .flatMap(e => e.bullets || [])
      .join(' ')
    const overlap = textOverlap(tokenize(job.description), tokenize(profileTokens))
    bestMatch = Math.round(overlap * 60) // cap at 60 for indirect matches
  }

  return Math.round(Math.min(100, bestMatch))
}

function scoreSeniorityFit(profile: UserProfile, job: JobPosting): number {
  const jobLevel = extractSeniorityLevel(job.title)
  const profileLevel = profileSeniorityLevel(profile)

  const diff = Math.abs(jobLevel - profileLevel)
  if (diff === 0) return 100
  if (diff === 1) return 80
  if (diff === 2) return 55
  return Math.max(10, 55 - (diff - 2) * 20)
}

function scoreRecencyBoost(profile: UserProfile, job: JobPosting): number {
  // How well do the candidate's RECENT roles align with this job?
  const jobTypes = extractExperienceTypes(job.title)
  if (jobTypes.length === 0) return 60 // neutral

  // Weight each matching entry by recency
  let totalMatch = 0
  let totalWeight = 0
  for (const entry of profile.entries) {
    const entryTypes = [entry.experienceType, ...extractExperienceTypes(entry.role)]
    const overlap = entryTypes.some(t => jobTypes.includes(t))
    totalWeight += entry.recencyWeight
    if (overlap) {
      totalMatch += entry.recencyWeight
    }
  }

  if (totalWeight === 0) return 50
  return Math.round((totalMatch / totalWeight) * 100)
}

function scoreTitleRelevance(profile: UserProfile, job: JobPosting): number {
  const jobTokens = tokenize(job.title)

  // Check overlap with profile role titles
  const recentRoles = [...profile.entries]
    .sort((a, b) => b.recencyWeight - a.recencyWeight)
    .slice(0, 5)

  let bestOverlap = 0
  for (const entry of recentRoles) {
    const roleTokens = tokenize(entry.role)
    const overlap = textOverlap(jobTokens, roleTokens)
    const weighted = overlap * entry.recencyWeight
    bestOverlap = Math.max(bestOverlap, weighted)
  }

  // Also give partial credit for experience-type alignment
  const jobTypes = extractExperienceTypes(job.title)
  const profileTypes = new Set(profile.entries.map(e => e.experienceType))
  const typeOverlap = jobTypes.filter(t => profileTypes.has(t)).length / Math.max(1, jobTypes.length)

  return Math.round(Math.min(100, bestOverlap * 70 + typeOverlap * 30))
}

// ── Main scorer ───────────────────────────────────────────────────────────

/**
 * Score how well a job posting fits a user's profile using heuristic
 * multi-dimensional analysis.  Returns a 0-100 score with breakdown.
 *
 * This is the fast, offline scorer — no LLM call needed.  Use it for
 * bulk pre-filtering before sending top candidates to the LLM for
 * deep analysis.
 */
export function scoreJobFitHeuristic(
  profile: UserProfile,
  job: JobPosting
): HeuristicScoreResult {
  const skillResult = scoreSkillMatch(profile, job)
  const domainScore = scoreDomainMatch(profile, job)
  const seniorityScore = scoreSeniorityFit(profile, job)
  const recencyScore = scoreRecencyBoost(profile, job)
  const titleScore = scoreTitleRelevance(profile, job)

  const dimensions = {
    skillMatch: skillResult.score,
    domainMatch: domainScore,
    seniorityFit: seniorityScore,
    recencyBoost: recencyScore,
    titleRelevance: titleScore
  }

  const overall = Math.round(
    dimensions.skillMatch * WEIGHTS.skillMatch +
    dimensions.domainMatch * WEIGHTS.domainMatch +
    dimensions.seniorityFit * WEIGHTS.seniorityFit +
    dimensions.recencyBoost * WEIGHTS.recencyBoost +
    dimensions.titleRelevance * WEIGHTS.titleRelevance
  )

  // Build strengths and gaps
  const strengths: string[] = []
  const gaps: string[] = []

  if (dimensions.skillMatch >= 70) strengths.push(`Strong skill overlap (${skillResult.matched.slice(0, 5).join(', ')})`)
  else if (dimensions.skillMatch < 40) gaps.push(`Limited skill match — missing: ${skillResult.missing.slice(0, 3).join(', ')}`)

  if (dimensions.domainMatch >= 70) strengths.push('Domain experience aligns well')
  else if (dimensions.domainMatch < 30) gaps.push('Limited domain overlap')

  if (dimensions.seniorityFit >= 80) strengths.push('Seniority level is a match')
  else if (dimensions.seniorityFit < 50) gaps.push('Seniority mismatch — may be over/under-leveled')

  if (dimensions.recencyBoost >= 70) strengths.push('Recent experience is highly relevant')
  else if (dimensions.recencyBoost < 40) gaps.push('Most relevant experience is dated')

  if (dimensions.titleRelevance >= 60) strengths.push('Role title aligns with background')

  // Build requirement matches
  const matchedRequirements: RequirementMatch[] = (job.requirements || []).map(req => {
    const reqTokens = tokenize(req)
    let bestEntry: ProfileEntry | null = null
    let bestStrength = 0

    for (const entry of profile.entries) {
      const entryTokens = tokenize((entry.bullets || []).join(' ') + ' ' + (entry.skills || []).join(' '))
      const overlap = textOverlap(reqTokens, entryTokens)
      const weighted = overlap * entry.recencyWeight * 100
      if (weighted > bestStrength) {
        bestStrength = weighted
        bestEntry = entry
      }
    }

    return {
      requirement: req,
      matched: bestStrength > 20,
      matchedEntryId: bestEntry?.id,
      matchStrength: Math.round(Math.min(100, bestStrength)),
      recencyAdjusted: Math.round(Math.min(100, bestStrength)),
      detail: bestEntry
        ? `Matched via ${bestEntry.role} at ${bestEntry.company}`
        : 'No strong match found'
    }
  })

  return {
    overall,
    dimensions,
    matchedRequirements,
    strengths,
    gaps,
    recommendation: recommendationFromScore(overall)
  }
}

/**
 * Batch-score multiple jobs and return them sorted by fit (descending).
 */
export function rankJobsByFit(
  profile: UserProfile,
  jobs: JobPosting[]
): Array<JobPosting & { heuristicScore: HeuristicScoreResult }> {
  return jobs
    .map(job => ({
      ...job,
      heuristicScore: scoreJobFitHeuristic(profile, job)
    }))
    .sort((a, b) => b.heuristicScore.overall - a.heuristicScore.overall)
}
