import { describe, expect, it } from 'vitest'
import { scoreJobFitHeuristic, rankJobsByFit, type JobPosting } from '@core/job-scorer'
import type { UserProfile } from '@core/profile-db'

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    name: 'Victor Bian',
    location: 'New York, NY',
    email: 'victor@example.com',
    linkedinUrl: '',
    summary: 'AI founder with biotech and finance background',
    entries: [
      {
        id: 'e1',
        type: 'experience',
        role: 'Co-Founder & CEO',
        company: 'AiCo',
        location: 'New York, NY',
        startDate: 'Jan 2024',
        endDate: 'Present',
        durationMonths: 15,
        skills: ['AI', 'product', 'fundraising', 'enterprise', 'SaaS', 'B2B'],
        metrics: ['$2M raised', '$500K ARR'],
        domain: ['AI', 'enterprise'],
        experienceType: 'founder',
        bullets: [
          'Built AI copilot serving 50+ enterprise clients',
          'Raised $2M seed round',
          'Grew ARR from $0 to $500K in 12 months'
        ],
        recencyWeight: 1.0
      },
      {
        id: 'e2',
        type: 'experience',
        role: 'Chief of Staff',
        company: 'BioStart',
        location: 'San Francisco, CA',
        startDate: 'Jun 2021',
        endDate: 'Dec 2023',
        durationMonths: 30,
        skills: ['strategy', 'operations', 'biotech', 'FDA', 'business development'],
        metrics: ['$15M budget'],
        domain: ['biotech', 'healthcare'],
        experienceType: 'chief_of_staff',
        bullets: [
          'Led cross-functional initiatives',
          'Managed $15M budget',
          'Drove FDA submission strategy'
        ],
        recencyWeight: 0.75
      },
      {
        id: 'e3',
        type: 'experience',
        role: 'Equity Research Analyst',
        company: 'China Merchants',
        location: 'Shanghai, China',
        startDate: 'Jul 2018',
        endDate: 'May 2020',
        durationMonths: 22,
        skills: ['equity research', 'financial modeling', 'valuation', 'IPO'],
        metrics: ['20+ research reports', '$5B+ market cap coverage'],
        domain: ['finance', 'healthcare'],
        experienceType: 'analyst',
        bullets: [
          'Published equity research reports on healthcare sector',
          'Built financial models for IPO valuations'
        ],
        recencyWeight: 0.35
      }
    ],
    education: [
      {
        id: 'ed1',
        institution: 'Columbia Business School',
        degree: 'MBA',
        field: 'Business',
        location: 'New York, NY',
        graduationYear: 2023,
        highlights: ["Dean's Fellow"]
      }
    ],
    languages: ['English', 'Mandarin'],
    countriesWorked: ['US', 'China'],
    totalYearsExperience: 7,
    lastUpdated: new Date().toISOString(),
    ...overrides
  }
}

function makeJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    title: 'Account Executive, Startups',
    company: 'Anthropic',
    location: 'San Francisco, CA',
    jobUrl: 'https://jobs.anthropic.com/ae-startups',
    description: 'Looking for an account executive to drive AI product adoption among startup customers. Requires enterprise SaaS sales experience and understanding of AI/ML technologies.',
    requirements: ['enterprise SaaS sales', 'AI/ML understanding', 'startup ecosystem knowledge'],
    ...overrides
  }
}

describe('scoreJobFitHeuristic', () => {
  const profile = makeProfile()

  it('returns a score between 0 and 100', () => {
    const result = scoreJobFitHeuristic(profile, makeJob())
    expect(result.overall).toBeGreaterThanOrEqual(0)
    expect(result.overall).toBeLessThanOrEqual(100)
  })

  it('returns all dimension scores', () => {
    const result = scoreJobFitHeuristic(profile, makeJob())
    expect(result.dimensions).toHaveProperty('skillMatch')
    expect(result.dimensions).toHaveProperty('domainMatch')
    expect(result.dimensions).toHaveProperty('seniorityFit')
    expect(result.dimensions).toHaveProperty('recencyBoost')
    expect(result.dimensions).toHaveProperty('titleRelevance')
  })

  it('returns a recommendation bucket', () => {
    const result = scoreJobFitHeuristic(profile, makeJob())
    expect(['strong_fit', 'good_fit', 'stretch', 'poor_fit']).toContain(result.recommendation)
  })

  it('scores higher for AI-related roles (matching recent experience)', () => {
    const aiJob = makeJob({
      title: 'AI Partnerships Lead',
      description: 'Lead partnerships with AI startups. Requires founder experience and deep AI knowledge.'
    })
    const unrelatedJob = makeJob({
      title: 'Senior Mechanical Engineer',
      description: 'Design mechanical systems for manufacturing. Requires CAD, materials science, thermodynamics.'
    })
    const aiScore = scoreJobFitHeuristic(profile, aiJob)
    const mechScore = scoreJobFitHeuristic(profile, unrelatedJob)
    expect(aiScore.overall).toBeGreaterThan(mechScore.overall)
  })

  it('weights recent experience higher', () => {
    const founderJob = makeJob({
      title: 'Startup Founder in Residence',
      description: 'Build new AI products from scratch. Requires founder experience, fundraising, product development.',
      requirements: ['founder experience', 'fundraising', 'product development']
    })
    const result = scoreJobFitHeuristic(profile, founderJob)
    // Recency boost should be meaningful because founder is the most recent role
    expect(result.dimensions.recencyBoost).toBeGreaterThan(40)
  })

  it('identifies strengths and gaps', () => {
    const result = scoreJobFitHeuristic(profile, makeJob())
    // Should have at least some strengths or gaps
    expect(result.strengths.length + result.gaps.length).toBeGreaterThan(0)
  })

  it('generates requirement matches when requirements are provided', () => {
    const job = makeJob({
      requirements: ['AI/ML experience', 'financial modeling', 'Python programming']
    })
    const result = scoreJobFitHeuristic(profile, job)
    expect(result.matchedRequirements).toHaveLength(3)
    expect(result.matchedRequirements[0]).toHaveProperty('requirement')
    expect(result.matchedRequirements[0]).toHaveProperty('matched')
    expect(result.matchedRequirements[0]).toHaveProperty('matchStrength')
  })

  it('handles jobs with no description gracefully', () => {
    const job = makeJob({ description: undefined, requirements: undefined })
    const result = scoreJobFitHeuristic(profile, job)
    expect(result.overall).toBeGreaterThanOrEqual(0)
  })

  it('handles empty profile gracefully', () => {
    const emptyProfile = makeProfile({ entries: [], education: [] })
    const result = scoreJobFitHeuristic(emptyProfile, makeJob())
    expect(result.overall).toBeGreaterThanOrEqual(0)
    expect(result.overall).toBeLessThanOrEqual(100)
  })
})

describe('rankJobsByFit', () => {
  const profile = makeProfile()

  it('returns jobs sorted by score descending', () => {
    const jobs: JobPosting[] = [
      makeJob({ title: 'Senior Mechanical Engineer', description: 'CAD and thermodynamics' }),
      makeJob({ title: 'AI Startup Partnerships', description: 'AI product partnerships with startups, fundraising' }),
      makeJob({ title: 'Data Entry Clerk', description: 'Basic data entry tasks' })
    ]
    const ranked = rankJobsByFit(profile, jobs)
    expect(ranked).toHaveLength(3)
    // Scores should be in descending order
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].heuristicScore.overall).toBeGreaterThanOrEqual(ranked[i + 1].heuristicScore.overall)
    }
  })

  it('attaches heuristicScore to each job', () => {
    const ranked = rankJobsByFit(profile, [makeJob()])
    expect(ranked[0]).toHaveProperty('heuristicScore')
    expect(ranked[0].heuristicScore).toHaveProperty('overall')
    expect(ranked[0].heuristicScore).toHaveProperty('dimensions')
  })
})

describe('seniority detection for junior roles', () => {
  it('scores intern job lower for a senior profile than a mid-level job', () => {
    const seniorProfile = makeProfile({
      entries: [
        {
          id: 's1',
          type: 'experience',
          role: 'Senior Software Engineer',
          company: 'BigCo',
          location: 'NYC',
          startDate: 'Jan 2022',
          endDate: 'Present',
          durationMonths: 36,
          skills: ['software', 'engineering'],
          metrics: [],
          domain: ['enterprise'],
          experienceType: 'engineer',
          bullets: ['Led platform team'],
          recencyWeight: 1.0
        }
      ]
    })
    const internJob = makeJob({ title: 'Software Engineering Intern', description: 'Summer internship' })
    const midJob = makeJob({ title: 'Software Engineer', description: 'Mid-level engineering role' })
    const internResult = scoreJobFitHeuristic(seniorProfile, internJob)
    const midResult = scoreJobFitHeuristic(seniorProfile, midJob)
    expect(internResult.dimensions.seniorityFit).toBeLessThan(midResult.dimensions.seniorityFit)
  })

  it('gives a high seniority score when intern applies to intern role', () => {
    const internProfile = makeProfile({
      entries: [
        {
          id: 'i1',
          type: 'experience',
          role: 'Marketing Intern',
          company: 'StartupCo',
          location: 'SF',
          startDate: 'Jun 2025',
          endDate: 'Present',
          durationMonths: 3,
          skills: ['marketing'],
          metrics: [],
          domain: [],
          experienceType: 'intern',
          bullets: ['Assisted with campaigns'],
          recencyWeight: 1.0
        }
      ]
    })
    const internJob = makeJob({ title: 'Marketing Intern', description: 'Entry-level internship' })
    const result = scoreJobFitHeuristic(internProfile, internJob)
    expect(result.dimensions.seniorityFit).toBe(100)
  })
})

describe('recencyAdjusted requirement scoring', () => {
  it('does not double-penalize older experience in recencyAdjusted', () => {
    const result = scoreJobFitHeuristic(makeProfile(), makeJob({
      requirements: ['equity research', 'financial modeling']
    }))
    for (const rm of result.matchedRequirements) {
      expect(rm.recencyAdjusted).toBe(rm.matchStrength)
    }
  })
})

describe('multi-word requirement matching', () => {
  it('reports a gap when a multi-word requirement has only partial token overlap', () => {
    const narrowProfile = makeProfile({
      entries: [
        {
          id: 'n1',
          type: 'experience',
          role: 'Operations Manager',
          company: 'Acme',
          location: 'NYC',
          startDate: 'Jan 2023',
          endDate: 'Present',
          durationMonths: 12,
          skills: ['enterprise'],
          metrics: [],
          domain: ['enterprise'],
          experienceType: 'manager',
          bullets: ['Managed enterprise operations'],
          recencyWeight: 1.0
        }
      ]
    })
    const withPartialReq = scoreJobFitHeuristic(narrowProfile, makeJob({
      requirements: ['enterprise SaaS sales experience']
    }))
    const withFullReq = scoreJobFitHeuristic(narrowProfile, makeJob({
      requirements: ['enterprise operations']
    }))
    // Partial overlap requirement should produce a lower baseRatio (more missing)
    // than a fully-matched requirement, resulting in a lower overall score
    expect(withPartialReq.overall).toBeLessThan(withFullReq.overall)
  })
})
