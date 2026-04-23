import { describe, expect, it } from 'vitest'
import type { AnswerBankItem, ApplicantProfile } from '@core/application-types'
import {
  buildEasyApplyProfileFieldMap,
  resolveEducationContextOverrides,
  resolveEducationFieldOverridesByIndex
} from '@core/easy-apply-field-map'

function makeProfile(partial: Partial<ApplicantProfile>): ApplicantProfile {
  const base: ApplicantProfile = {
    version: 1,
    basics: { fullName: 'Pat Example', email: 'pat@example.com' },
    links: {},
    workAuth: { countryCode: 'US' },
    compensation: {},
    background: {},
    assets: [],
    answerBank: [],
    updatedAt: new Date(0).toISOString()
  }
  return {
    ...base,
    ...partial,
    basics: { ...base.basics, ...(partial.basics || {}) },
    links: { ...base.links, ...(partial.links || {}) },
    workAuth: { ...base.workAuth, ...(partial.workAuth || {}) },
    compensation: { ...base.compensation, ...(partial.compensation || {}) },
    background: { ...base.background, ...(partial.background || {}) },
    assets: partial.assets ?? base.assets,
    answerBank: partial.answerBank ?? base.answerBank
  }
}

describe('buildEasyApplyProfileFieldMap', () => {
  it('splits full name and copies core contact fields', () => {
    const m = buildEasyApplyProfileFieldMap(
      makeProfile({
        basics: {
          fullName: 'Pat Example',
          email: 'pat@example.com',
          phone: '+1 555-0100',
          city: 'Austin',
          state: 'TX',
          country: 'US'
        },
        links: { linkedInUrl: 'https://linkedin.com/in/pat' },
        compensation: { salaryMin: 120000, salaryCurrency: 'USD' },
        background: { yearsOfExperience: '7', educationSummary: 'BS CS' }
      })
    )
    expect(m['First name']).toBe('Pat')
    expect(m['Last name']).toBe('Example')
    expect(m['Full name']).toBe('Pat Example')
    expect(m['Email address']).toBe('pat@example.com')
    expect(m['Phone number']).toBe('+1 555-0100')
    expect(m['City']).toBe('Austin')
    expect(m['What is your current location?']).toBe('Austin, TX')
    expect(m['Location']).toBe('Austin, TX')
  })

  it('uses currentLocationLine for generic Location and current-address keys', () => {
    const m = buildEasyApplyProfileFieldMap(
      makeProfile({
        basics: {
          fullName: 'Pat Example',
          email: 'pat@example.com',
          city: 'Austin',
          state: 'TX',
          country: 'US',
          currentLocationLine: 'Greater Boston, MA, USA'
        }
      })
    )
    expect(m['Location']).toBe('Greater Boston, MA, USA')
    expect(m['What is your current location?']).toBe('Greater Boston, MA, USA')
    expect(m['City']).toBe('Austin')
  })

  it('uses currentResidenceAnswer for residing phrasing; Location stays the short line when both set', () => {
    const narrative = 'I am currently residing in Austin, Texas, United States.'
    const m = buildEasyApplyProfileFieldMap(
      makeProfile({
        basics: {
          fullName: 'Pat Example',
          email: 'pat@example.com',
          city: 'Austin',
          state: 'TX',
          country: 'US',
          currentLocationLine: 'Austin, TX',
          currentResidenceAnswer: narrative
        }
      })
    )
    expect(m['Where are you currently residing?']).toBe(narrative)
    expect(m['What is your current location?']).toBe(narrative)
    expect(m['Location']).toBe('Austin, TX')
    expect(m['City']).toBe('Austin')
  })

  it('marks US presence when country is US', () => {
    const m = buildEasyApplyProfileFieldMap(
      makeProfile({
        basics: { fullName: 'Pat Example', email: 'pat@example.com', city: 'Brooklyn', state: 'NY', country: 'US' }
      })
    )
    expect(m['Are you located in the United States']).toBe('Yes')
  })

  it('adds work-auth booleans when set', () => {
    const m = buildEasyApplyProfileFieldMap(
      makeProfile({
        workAuth: {
          countryCode: 'US',
          authorizedToWork: true,
          requiresSponsorship: false,
          clearanceEligible: true
        }
      })
    )
    expect(m['Are you legally authorized to work']).toBe('Yes')
    expect(m['require sponsorship']).toBe('No')
    expect(m['Security clearance']).toBe('Yes')
  })

  it('adds normalized alias keys (field-name-aliases parity)', () => {
    const m = buildEasyApplyProfileFieldMap(
      makeProfile({
        basics: { fullName: 'Pat Example', email: 'pat@example.com' },
        workAuth: { countryCode: 'US', authorizedToWork: true }
      })
    )
    expect(m['work authorization']).toBe('Yes')
    expect(m['Work Authorization']).toBe('Yes')
  })

  it('merges answer bank prompts', () => {
    const bank: AnswerBankItem[] = [
      {
        id: '1',
        normalizedKey: '',
        prompt: 'Why this company?',
        answerType: 'text',
        answer: 'Mission fit.',
        scope: 'global',
        updatedAt: new Date().toISOString()
      }
    ]
    const m = buildEasyApplyProfileFieldMap(makeProfile({ answerBank: bank }))
    expect(m['Why this company?']).toBe('Mission fit.')
  })

  it('ignores school-city labels when resolving education context', () => {
    const overrides = resolveEducationContextOverrides(
      [{ label: 'School city', value: 'New York' }],
      [{ school: 'New York University', degree: 'BS', field: 'CS', year: 2020 }]
    )
    expect(overrides).toBeNull()
  })

  it('uses degree/year hints to disambiguate same-school multiple entries', () => {
    const overrides = resolveEducationContextOverrides(
      [
        { label: 'School name', value: 'Columbia University' },
        { label: 'Degree', value: 'MBA' },
        { label: 'Graduation year', value: '2024' }
      ],
      [
        { school: 'Columbia University', degree: 'BA', field: 'History', year: 2018 },
        { school: 'Columbia University', degree: 'MBA', field: '', year: 2024 }
      ]
    )
    expect(overrides?.['Degree']).toBe('MBA')
    expect(overrides?.['Field of study']).toBe('')
    expect(overrides?.['Graduation year']).toBe('2024')
  })

  it('clears date defaults when matched entry has no graduation year', () => {
    const overrides = resolveEducationContextOverrides(
      [{ label: 'School', value: 'Acme University' }],
      [{ school: 'Acme University', degree: '', field: '', year: null }]
    )
    expect(overrides?.['Degree']).toBe('')
    expect(overrides?.['Field of study']).toBe('')
    expect(overrides?.['Graduation year']).toBe('')
    expect(overrides?.['Start year']).toBe('')
  })

  it('builds per-index overrides for multiple education groups in one step', () => {
    const byIndex = resolveEducationFieldOverridesByIndex(
      [
        { label: 'School name', value: 'Columbia University' },
        { label: 'Degree', value: '' },
        { label: 'Field of study', value: '' },
        { label: 'School name', value: 'MIT' },
        { label: 'Degree', value: '' },
        { label: 'Field of study', value: '' }
      ],
      [
        { school: 'Columbia University', degree: 'MBA', field: '', year: 2024 },
        { school: 'MIT', degree: 'BS', field: 'Computer Science', year: 2020 }
      ]
    )
    expect(byIndex[1]).toBe('MBA')
    expect(byIndex[2]).toBe('')
    expect(byIndex[4]).toBe('BS')
    expect(byIndex[5]).toBe('Computer Science')
  })

  it('forces correction when prefilled education values conflict with matched context', () => {
    const byIndex = resolveEducationFieldOverridesByIndex(
      [
        { label: 'School', value: 'Columbia University' },
        { label: 'Degree', value: 'BA' },
        { label: 'Field of study', value: 'History' }
      ],
      [{ school: 'Columbia University', degree: 'MBA', field: '', year: 2024 }]
    )
    expect(byIndex[1]).toBe('MBA')
    expect(byIndex[2]).toBe('')
  })

  it('detects PhD as Doctorate for highest education level', () => {
    const m = buildEasyApplyProfileFieldMap(
      makeProfile({
        background: { educationSummary: 'PhD Computer Science, Stanford 2022' }
      })
    )
    expect(m['What is the highest level of education you have completed']).toBe('Doctorate')
    expect(m['PhD']).toBe('Yes')
    expect(m["Master's Degree"]).toBe('Yes')
    expect(m["Bachelor's Degree"]).toBe('Yes')
  })

  it('detects JD as Doctorate for highest education level', () => {
    const m = buildEasyApplyProfileFieldMap(
      makeProfile({
        background: { educationSummary: 'JD, Harvard Law School 2021' }
      })
    )
    expect(m['What is the highest level of education you have completed']).toBe('Doctorate')
    expect(m['Professional degree']).toBe('Yes')
  })
})
