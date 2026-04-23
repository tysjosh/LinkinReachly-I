import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../../src/main/settings'

const { mockGetApiKey } = vi.hoisted(() => ({
  mockGetApiKey: vi.fn<() => string | null>(() => 'test-key')
}))

vi.mock('../../../src/main/settings', () => ({
  getApiKey: mockGetApiKey
}))

vi.mock('../../../src/main/app-log', () => ({
  appLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import type { ApplicantBridgeSnapshot } from '@core/applicant-bridge-snapshot'
import {
  buildCandidateContextForJobsMatch,
  composeMessageDetailed,
  detectJobIntent,
  extractFirstCompleteJsonObject,
  linkedInJobsSearchUrl,
  llmBatchJobMatchPercents,
  llmMatchSnapshotToProfile,
  planJobSearch,
  resolveProfileValueForKey
} from '../../../src/main/llm'
import type { UserProfile } from '@core/profile-db'

const visionTestProfile: ApplicantBridgeSnapshot = {
  fullName: 'Alex Case',
  firstName: 'Alex',
  lastName: 'Case',
  email: 'alex@example.com',
  phone: '',
  phoneDigits: '',
  addressLine1: '',
  addressLine2: '',
  linkedInUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  websiteUrl: '',
  city: 'Austin',
  state: 'TX',
  postalCode: '',
  stateVariants: ['TX', 'Texas'],
  country: 'US',
  countryDisplay: 'United States',
  cityStateComma: 'Austin, TX',
  currentLocationLine: '',
  currentResidenceAnswer: '',
  yearsOfExperience: '7',
  educationSummary: 'BS CS',
  educationStartMonth: '',
  educationStartYear: '',
  educationEndMonth: '',
  educationEndYear: '',
  currentlyAttending: '',
  schoolName: '',
  degreeType: '',
  fieldOfStudy: '',
  languages: '',
  certifications: '',
  authorizedToWork: 'Yes',
  requiresSponsorship: 'No',
  clearanceEligible: '',
  willingToRelocate: '',
  willingToTravel: '',
  over18: '',
  hasDriversLicense: '',
  canPassBackgroundCheck: '',
  canPassDrugTest: '',
  salaryMin: undefined,
  salaryMax: undefined,
  salaryCurrency: '',
  noticePeriod: '2 weeks',
  startDatePreference: '',
  startDateMMDDYYYY: '',
  startDateDashesYYYYMMDD: '',
  startDateSlashesMMDDYYYY: '',
  workLocationPreference: 'Remote',
  answerBank: []
}

describe('extractFirstCompleteJsonObject', () => {
  it('parses trimmed whole object', () => {
    expect(extractFirstCompleteJsonObject('  {"done":true}  ')).toBe('{"done":true}')
  })

  it('extracts first object after prose', () => {
    expect(extractFirstCompleteJsonObject('Ok:\n{"thought":"x","tool_call":null,"done":true}')).toBe(
      '{"thought":"x","tool_call":null,"done":true}'
    )
  })

  it('supports nested objects and escaped quotes in strings', () => {
    const inner = '{"a":{"b":1},"q":"say \\"hi\\""}'
    expect(extractFirstCompleteJsonObject(`prefix ${inner} tail`)).toBe(inner)
  })

  it('returns null when no parseable object', () => {
    expect(extractFirstCompleteJsonObject('not json')).toBeNull()
    expect(extractFirstCompleteJsonObject('{broken')).toBeNull()
  })
})

const baseSettings: AppSettings = {
  seenOnboarding: true,
  bridgePort: 19511,
  llmProvider: 'grok',
  llmBaseUrl: 'http://127.0.0.1:8000',
  llmModel: 'grok-4.1-fast',
  llmEnabled: true,
  llmMode: 'bundled' as const,
  apiKeyStored: null,
  apiKeyIsEncrypted: false,
  lastExecutionId: 'generic_connection',
  templates: ['Hi {firstName}'],
  mustInclude: [],
  dailyCap: 20,
  weeklyConnectionCap: 60,
  sessionBreaksEnabled: true,
  sessionBreakEveryMin: 5,
  sessionBreakEveryMax: 8,
  sessionBreakDurationMin: 2,
  sessionBreakDurationMax: 5,
  delayBetweenRequestsMin: 45,
  delayBetweenRequestsMax: 90,
  delayBetweenActionsMin: 1,
  delayBetweenActionsMax: 3,
  resumeText: '',
  resumeFileName: '',
  jobsSearchKeywords: '',
  jobsSearchLocation: '',
  jobsSearchHistory: [],
  userBackground: '',
  outreachTone: 'peer' as const,
  easyApplyTailorCoverLetter: false,
  easyApplyEnrichCompanyContext: false,
  jobsSearchRecencySeconds: 86400,
  jobsSearchSortBy: 'DD' as const,
  jobsSearchDistanceMiles: 0,
  jobsSearchExperienceLevels: [],
  jobsSearchJobTypes: [],
  jobsSearchRemoteTypes: [],
  jobsSearchSalaryFloor: 0,
  jobsSearchFewApplicants: false,
  jobsSearchVerifiedOnly: false,
  jobsSearchEasyApplyOnly: true,
  jobsScreeningCriteria: '',
  customOutreachPrompt: ''
}

describe('composeMessageDetailed', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetApiKey.mockReturnValue('test-key')
  })

  it('stays template-driven when AI assist is disabled even if a key exists', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await composeMessageDetailed(
      { ...baseSettings, llmEnabled: false },
      { profileUrl: 'https://www.linkedin.com/in/sam/', firstName: 'Sam' },
      {},
      { executionId: 'generic_connection' }
    )

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.body).toBe('Hi Sam')
    expect(result.variant).toBe('T0')
    expect(result.route).toBe('template')
  })

  it('uses the API path when AI assist is enabled and a key is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"variant_index":0,"body":"AI hi Sam"}' } }]
      })
    } as Response)

    const result = await composeMessageDetailed(
      { ...baseSettings, llmEnabled: true },
      { profileUrl: 'https://www.linkedin.com/in/sam/', firstName: 'Sam' },
      {},
      { executionId: 'generic_connection' }
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.body).toBe('AI hi Sam')
    expect(result.variant).toBe('T0-llm')
  })

  it('falls back to template when LLM body exceeds 280 chars after variable expansion', async () => {
    const padding = 'x'.repeat(258)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: `{"variant_index":0,"body":"Hi {firstName}, ${padding}"}` } }]
      })
    } as Response)

    const result = await composeMessageDetailed(
      { ...baseSettings, llmEnabled: true },
      { profileUrl: 'https://www.linkedin.com/in/sam/', firstName: 'Bartholomew-Alexander' },
      {},
      { executionId: 'generic_connection' }
    )

    expect(result.route).toBe('template')
    expect(result.detail).toMatch(/over_limit/)
  })
})

describe('detectJobIntent', () => {
  it('detects explicit job search phrasing', () => {
    expect(detectJobIntent('find me jobs in fintech')).toBe(true)
    expect(detectJobIntent('job search for product managers')).toBe(true)
    expect(detectJobIntent('looking for a role at Google')).toBe(true)
    expect(detectJobIntent('what jobs are available at Stripe')).toBe(true)
    expect(detectJobIntent('search for jobs in NYC')).toBe(true)
  })

  it('does not trigger on people-oriented prompts', () => {
    expect(detectJobIntent('connect with hedge fund managers')).toBe(false)
    expect(detectJobIntent('find fintech founders in NYC')).toBe(false)
    expect(detectJobIntent('network with software engineers')).toBe(false)
    expect(detectJobIntent('reach out to VCs who invest in AI')).toBe(false)
  })
})

describe('linkedInJobsSearchUrl', () => {
  it('drops generic filler words and promotes a trailing location into the location field', () => {
    const url = new URL(linkedInJobsSearchUrl('anthropic role in new york'))

    expect(url.searchParams.get('keywords')).toBe('anthropic')
    expect(url.searchParams.get('location')).toBe('new york')
  })

  it('keeps the last location segment when the query already uses an earlier "in"', () => {
    const url = new URL(linkedInJobsSearchUrl('machine learning in healthcare in new york'))

    expect(url.searchParams.get('keywords')).toBe('machine learning in healthcare')
    expect(url.searchParams.get('location')).toBe('new york')
  })

  it('promotes a bare trailing city into the location field', () => {
    const url = new URL(linkedInJobsSearchUrl('chief of staff ai startup new york'))

    expect(url.searchParams.get('keywords')).toBe('chief of staff ai startup')
    expect(url.searchParams.get('location')).toBe('new york')
  })

  it('accepts options object with recency, sort, distance, and filter params', () => {
    const url = new URL(linkedInJobsSearchUrl('product manager', 'new york', {
      easyApplyOnly: true,
      recencySeconds: 3600,
      sortBy: 'DD',
      distanceMiles: 50,
      experienceLevels: ['3', '4'],
      jobTypes: ['F', 'C'],
      remoteTypes: ['2', '3']
    }))

    expect(url.searchParams.get('f_AL')).toBe('true')
    expect(url.searchParams.get('f_TPR')).toBe('r3600')
    expect(url.searchParams.get('sortBy')).toBe('DD')
    expect(url.searchParams.get('distance')).toBe('50')
    expect(url.searchParams.get('f_E')).toBe('3,4')
    expect(url.searchParams.get('f_JT')).toBe('F,C')
    expect(url.searchParams.get('f_WT')).toBe('2,3')
  })

  it('omits optional params when zero/empty', () => {
    const url = new URL(linkedInJobsSearchUrl('pm', undefined, {
      easyApplyOnly: false,
      recencySeconds: 0,
      distanceMiles: 0,
      experienceLevels: [],
      jobTypes: [],
      remoteTypes: []
    }))

    expect(url.searchParams.get('f_AL')).toBeNull()
    expect(url.searchParams.get('f_TPR')).toBeNull()
    expect(url.searchParams.get('sortBy')).toBeNull()
    expect(url.searchParams.get('distance')).toBeNull()
    expect(url.searchParams.get('f_E')).toBeNull()
    expect(url.searchParams.get('f_JT')).toBeNull()
    expect(url.searchParams.get('f_WT')).toBeNull()
  })

  it('backward compat: boolean easyApplyOnly still works', () => {
    const url = new URL(linkedInJobsSearchUrl('engineer', undefined, true))
    expect(url.searchParams.get('f_AL')).toBe('true')
    expect(url.searchParams.get('f_TPR')).toBeNull()
  })

  it('sets salary, few-applicants, and verified filters', () => {
    const url = new URL(linkedInJobsSearchUrl('pm', undefined, {
      salaryFloor: 4,
      fewApplicants: true,
      verifiedOnly: true
    }))

    expect(url.searchParams.get('f_SB2')).toBe('4')
    expect(url.searchParams.get('f_JIYN')).toBe('true')
    expect(url.searchParams.get('f_VJ')).toBe('true')
  })
})

describe('planJobSearch', () => {
  it('sends the user request and profile background separately so the request stays primary', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"queries":["Anthropic","Anthropic product manager"],"criteria":"Target product roles at Anthropic in New York.","summary":"Searching Anthropic product roles in New York."}'
            }
          }
        ]
      })
    } as Response)

    const result = await planJobSearch(
      baseSettings,
      'anthropic role in new york',
      null,
      'Founder in financial research and strategy.'
    )

    expect(result.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body || '{}')) as {
      messages?: Array<{ role?: string; content?: string }>
    }
    expect(body.messages?.[0]?.content).toContain("Treat the user's request as the source of truth")
    expect(body.messages?.[1]?.content).toContain('"request":"anthropic role in new york"')
    expect(body.messages?.[1]?.content).toContain('"profileBackground":"Founder in financial research and strategy."')
    expect(body.messages?.[1]?.content).toContain('"location":"new york"')
  })
})

describe('buildCandidateContextForJobsMatch', () => {
  it('uses résumé text when no structured profile', () => {
    const ctx = buildCandidateContextForJobsMatch(
      { ...baseSettings, resumeText: 'x'.repeat(250), userBackground: '' },
      null
    )
    expect(ctx.length).toBeGreaterThanOrEqual(200)
  })

  it('uses structured profile when usable', () => {
    const profile: UserProfile = {
      name: 'Alex',
      location: 'SF',
      email: '',
      linkedinUrl: '',
      summary: 'Engineer building tools.',
      entries: [
        {
          id: '1',
          type: 'experience',
          role: 'Engineer',
          company: 'Acme',
          startDate: 'Jan 2020',
          endDate: 'Present',
          durationMonths: 24,
          skills: ['TypeScript'],
          metrics: [],
          domain: ['devtools'],
          experienceType: 'engineer',
          bullets: ['Shipped APIs'],
          recencyWeight: 1
        }
      ],
      education: [],
      languages: [],
      countriesWorked: [],
      totalYearsExperience: 3,
      lastUpdated: '2026-01-01'
    }
    const ctx = buildCandidateContextForJobsMatch(baseSettings, profile)
    expect(ctx).toContain('Alex')
    expect(ctx).toContain('Acme')
    expect(ctx).toContain('TypeScript')
  })
})

describe('llmBatchJobMatchPercents', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetApiKey.mockReturnValue('test-key')
  })

  it('returns null when candidate context is too short', async () => {
    const m = await llmBatchJobMatchPercents(
      { ...baseSettings, llmEnabled: true },
      [{ jobUrl: 'https://example.com/j1', title: 'Eng', company: 'Co', location: 'SF' }],
      'short',
      null
    )
    expect(m).toBeNull()
  })

  it('parses score map from model JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"scores":[{"jobUrl":"https://example.com/j1","matchPercent":82,"reason":"Strong title fit"}]}'
            }
          }
        ]
      })
    } as Response)

    const m = await llmBatchJobMatchPercents(
      { ...baseSettings, llmEnabled: true },
      [{ jobUrl: 'https://example.com/j1', title: 'Engineer', company: 'Co', location: 'SF' }],
      'y'.repeat(80),
      null
    )
    expect(m).not.toBeNull()
    expect(m!.get('https://example.com/j1')?.matchPercent).toBe(82)
    expect(m!.get('https://example.com/j1')?.reason).toContain('title')
  })

  it('includes job descriptions in the LLM payload when available', async () => {
    let capturedBody = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = typeof opts?.body === 'string' ? opts.body : ''
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"scores":[{"jobUrl":"https://example.com/j1","matchPercent":75,"reason":"skills match"}]}' } }]
        })
      } as Response
    })

    await llmBatchJobMatchPercents(
      { ...baseSettings, llmEnabled: true },
      [{
        jobUrl: 'https://example.com/j1',
        title: 'Engineer',
        company: 'Co',
        location: 'SF',
        description: 'We are looking for a senior software engineer with 5+ years experience in TypeScript and React.'
      }],
      'y'.repeat(80),
      null
    )

    const parsed = JSON.parse(capturedBody)
    const userContent = JSON.parse(parsed.messages[1].content)
    expect(userContent.jobs[0].description).toContain('senior software engineer')
  })

  it('omits short descriptions from the payload', async () => {
    let capturedBody = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = typeof opts?.body === 'string' ? opts.body : ''
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"scores":[{"jobUrl":"https://example.com/j1","matchPercent":50,"reason":"ok"}]}' } }]
        })
      } as Response
    })

    await llmBatchJobMatchPercents(
      { ...baseSettings, llmEnabled: true },
      [{
        jobUrl: 'https://example.com/j1',
        title: 'Engineer',
        company: 'Co',
        location: 'SF',
        description: 'Short'
      }],
      'y'.repeat(80),
      null
    )

    const parsed = JSON.parse(capturedBody)
    const userContent = JSON.parse(parsed.messages[1].content)
    expect(userContent.jobs[0].description).toBeUndefined()
  })
})

// ── Layer 2: A11y tree + LLM structured matching ──────────────────────────

describe('resolveProfileValueForKey', () => {
  it('resolves standard string keys', () => {
    expect(resolveProfileValueForKey('email', visionTestProfile)).toBe('alex@example.com')
    expect(resolveProfileValueForKey('city', visionTestProfile)).toBe('Austin')
    expect(resolveProfileValueForKey('yearsOfExperience', visionTestProfile)).toBe('7')
  })

  it('returns null for empty/unset keys', () => {
    expect(resolveProfileValueForKey('phone', visionTestProfile)).toBeNull()
    expect(resolveProfileValueForKey('linkedInUrl', visionTestProfile)).toBeNull()
  })

  it('resolves salaryExpectation from salaryMin/Max', () => {
    const withSalary = { ...visionTestProfile, salaryMin: 120000, salaryMax: 150000, salaryCurrency: 'USD' }
    const result = resolveProfileValueForKey('salaryExpectation', withSalary)
    expect(result).toContain('120')
    expect(result).toContain('150')
  })

  it('returns null for salaryExpectation when salaryMin is undefined', () => {
    expect(resolveProfileValueForKey('salaryExpectation', visionTestProfile)).toBeNull()
  })

  it('returns null for unknown keys', () => {
    expect(resolveProfileValueForKey('nonexistent', visionTestProfile)).toBeNull()
  })
})

describe('llmMatchSnapshotToProfile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty when LLM is disabled', async () => {
    const settings = { ...baseSettings, llmEnabled: false }
    const result = await llmMatchSnapshotToProfile(settings, 'snapshot', visionTestProfile, ['Email'])
    expect(result.mappings).toHaveLength(0)
  })

  it('returns empty when no API key', async () => {
    mockGetApiKey.mockReturnValueOnce(null)
    const result = await llmMatchSnapshotToProfile(baseSettings, 'snapshot text here that is long enough', visionTestProfile, ['Email'])
    expect(result.mappings).toHaveLength(0)
  })

  it('returns empty when no unmatched labels', async () => {
    const result = await llmMatchSnapshotToProfile(baseSettings, 'snapshot', visionTestProfile, [])
    expect(result.mappings).toHaveLength(0)
  })

  it('parses valid LLM response into mappings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              mappings: [
                { ref: 'e12', profileKey: 'email', label: 'Email Address', confidence: 0.95 },
                { ref: 'e14', profileKey: 'city', label: 'City', confidence: 0.88 }
              ]
            })
          }
        }]
      })
    } as Response)

    const snapshot = '- textbox "Email Address" [ref=e12]: \n- textbox "City" [ref=e14]:'
    const result = await llmMatchSnapshotToProfile(baseSettings, snapshot, visionTestProfile, ['Email Address', 'City'])
    expect(result.mappings).toHaveLength(2)
    expect(result.mappings[0].profileKey).toBe('email')
    expect(result.mappings[0].ref).toBe('e12')
    expect(result.mappings[1].profileKey).toBe('city')
  })

  it('filters out mappings with invalid profile keys', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              mappings: [
                { ref: 'e12', profileKey: 'email', label: 'Email', confidence: 0.9 },
                { ref: 'e13', profileKey: 'invented_field', label: 'Foo', confidence: 0.8 }
              ]
            })
          }
        }]
      })
    } as Response)

    const snapshot = '- textbox "Email" [ref=e12]: \n- textbox "Foo" [ref=e13]:'
    const result = await llmMatchSnapshotToProfile(baseSettings, snapshot, visionTestProfile, ['Email', 'Foo'])
    expect(result.mappings).toHaveLength(1)
    expect(result.mappings[0].profileKey).toBe('email')
  })

  it('filters out mappings where profile value is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              mappings: [
                { ref: 'e12', profileKey: 'phone', label: 'Phone Number', confidence: 0.9 }
              ]
            })
          }
        }]
      })
    } as Response)

    const snapshot = '- textbox "Phone Number" [ref=e12]:'
    const result = await llmMatchSnapshotToProfile(baseSettings, snapshot, visionTestProfile, ['Phone Number'])
    expect(result.mappings).toHaveLength(0)
  })

  it('returns error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    const snapshot = '- textbox "Email" [ref=e12]: \n- textbox "City" [ref=e14]: \n- textbox "Phone" [ref=e16]: '
    const result = await llmMatchSnapshotToProfile(baseSettings, snapshot, visionTestProfile, ['Email'])
    expect(result.mappings).toHaveLength(0)
    expect(result.error).toBe('network down')
  })

  it('clamps confidence to 0-1 range', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              mappings: [
                { ref: 'e12', profileKey: 'email', label: 'Email', confidence: 5.0 },
                { ref: 'e14', profileKey: 'city', label: 'City', confidence: -1 }
              ]
            })
          }
        }]
      })
    } as Response)

    const snapshot = '- textbox "Email" [ref=e12]: \n- textbox "City" [ref=e14]:'
    const result = await llmMatchSnapshotToProfile(baseSettings, snapshot, visionTestProfile, ['Email', 'City'])
    expect(result.mappings[0].confidence).toBe(1)
    expect(result.mappings[1].confidence).toBe(0)
  })
})
