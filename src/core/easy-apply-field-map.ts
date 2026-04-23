import type { ApplicantProfile } from './application-types'
import { locatedInUnitedStatesAnswer } from './easy-apply-factual-helpers'
import { normalizeFieldLabelForSnapshotMatch } from './field-name-aliases'

/** Best-effort range/year text for repeater "Dates attended" when only educationSummary exists. */
function guessDatesAttendedFromEducationSummary(summary: string): string {
  const s = String(summary || '')
  const years = [...s.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0])
  if (years.length >= 2) return `${years[0]} - ${years[years.length - 1]}`
  if (years.length === 1) return years[0]
  return ''
}

/** Add canonical keys from {@link normalizeFieldLabelForSnapshotMatch} when missing (parity with snapshot matcher). */
function expandProfileKeysWithLabelAliases(map: Record<string, string>): void {
  for (const [k, v] of Object.entries(map)) {
    const norm = normalizeFieldLabelForSnapshotMatch(k)
    if (norm && norm !== k && map[norm] === undefined) map[norm] = v
  }
}

/** Maps applicant profile data to LinkedIn Easy Apply field label keys (exact + fuzzy match in assistant). */
export function buildEasyApplyProfileFieldMap(profile: ApplicantProfile): Record<string, string> {
  const profileFieldMap: Record<string, string> = {
    'First name': profile.basics.fullName.split(/\s+/)[0] || '',
    'Last name': profile.basics.fullName.split(/\s+/).slice(1).join(' ') || '',
    'Full name': profile.basics.fullName,
    'Full Legal Name': profile.basics.fullName,
    'Legal name': profile.basics.fullName,
    'Full legal name': profile.basics.fullName,
    'Email': profile.basics.email,
    'Email address': profile.basics.email,
    'Phone': profile.basics.phone || '',
    'Phone number': profile.basics.phone || '',
    'Mobile phone number': profile.basics.phone || '',
    'Address line 1': profile.basics.addressLine1 || '',
    'Address line 2': profile.basics.addressLine2 || '',
    Address: profile.basics.addressLine1 || '',
    'Street address': profile.basics.addressLine1 || '',
    City: profile.basics.city || '',
    State: profile.basics.state || '',
    'Postal code': profile.basics.postalCode || '',
    'ZIP code': profile.basics.postalCode || '',
    Country: profile.basics.country || '',
    LinkedIn: profile.links.linkedInUrl || '',
    'LinkedIn URL': profile.links.linkedInUrl || '',
    'LinkedIn Profile URL': profile.links.linkedInUrl || '',
    Website: profile.links.websiteUrl || '',
    Portfolio: profile.links.portfolioUrl || '',
    GitHub: profile.links.githubUrl || '',
    'Salary expectation':
      profile.compensation.salaryMin != null ? String(profile.compensation.salaryMin) : '',
    'Expected salary':
      profile.compensation.salaryMin != null ? String(profile.compensation.salaryMin) : '',
    'Maximum salary expectation':
      profile.compensation.salaryMax != null ? String(profile.compensation.salaryMax) : '',
    'Salary currency': profile.compensation.salaryCurrency || '',
    'Notice period': profile.compensation.noticePeriod || '',
    'Start date': profile.compensation.startDatePreference || '',
    'Work location preference': profile.compensation.workLocationPreference || '',
    'Years of experience': profile.background.yearsOfExperience || '',
    Education: profile.background.educationSummary || ''
  }

  const city = profile.basics.city || ''
  const state = profile.basics.state || ''
  const cityStateComma =
    city && state ? `${city}, ${state}` : city || state ? `${city}${state}` : ''
  const locationLine = profile.basics.currentLocationLine?.trim() || cityStateComma
  const residenceNarrative = profile.basics.currentResidenceAnswer?.trim() || ''
  /** “Where residing” / current-address questions — prefer dedicated answer, then short line. */
  const forResidencePrompts = residenceNarrative || locationLine
  /** Short “Location” boxes — prefer one-line field, then narrative if that’s all we have. */
  const forGenericLocation = locationLine || residenceNarrative

  if (forResidencePrompts) {
    profileFieldMap['What is your current location'] = forResidencePrompts
    profileFieldMap['What is your current location?'] = forResidencePrompts
    profileFieldMap['What city & state do you currently reside in'] = forResidencePrompts
    profileFieldMap['What city & state do you currently reside in?'] = forResidencePrompts
    profileFieldMap['Where are you currently residing'] = forResidencePrompts
    profileFieldMap['Where are you currently residing?'] = forResidencePrompts
    profileFieldMap['Where are you currently residing in'] = forResidencePrompts
    profileFieldMap['Where are you currently residing in?'] = forResidencePrompts
    profileFieldMap['Please indicate where you are currently residing'] = forResidencePrompts
    profileFieldMap['Where do you currently reside'] = forResidencePrompts
    profileFieldMap['Where do you currently reside?'] = forResidencePrompts
    profileFieldMap['Where do you reside'] = forResidencePrompts
    profileFieldMap['Where do you reside?'] = forResidencePrompts
    profileFieldMap['current location'] = forResidencePrompts
    profileFieldMap['Current location'] = forResidencePrompts
    profileFieldMap['Where do you currently live'] = forResidencePrompts
    profileFieldMap['Where do you currently live?'] = forResidencePrompts
    profileFieldMap['Place of residence'] = forResidencePrompts
    profileFieldMap['place of residence'] = forResidencePrompts
  }
  if (forGenericLocation) {
    profileFieldMap['Location'] = forGenericLocation
    profileFieldMap['location'] = forGenericLocation
    profileFieldMap['Your location'] = forGenericLocation
  }
  if (profile.basics.addressLine1?.trim()) {
    const line1 = profile.basics.addressLine1.trim()
    profileFieldMap['Mailing address'] = line1
    profileFieldMap['Residential address'] = line1
    profileFieldMap['Home address'] = line1
    profileFieldMap['Street'] = line1
    profileFieldMap['Address 1'] = line1
  }
  if (profile.basics.addressLine2?.trim()) {
    const line2 = profile.basics.addressLine2.trim()
    profileFieldMap['Address 2'] = line2
    profileFieldMap['Apartment, suite, etc.'] = line2
  }
  if (profile.basics.postalCode?.trim()) {
    const postal = profile.basics.postalCode.trim()
    profileFieldMap['Zip'] = postal
    profileFieldMap['Postal'] = postal
  }
  if (city) {
    profileFieldMap['School city'] = city
    profileFieldMap['school city'] = city
    profileFieldMap['Institution city'] = city
    profileFieldMap['College city'] = city
  }
  const datesGuess = guessDatesAttendedFromEducationSummary(profile.background.educationSummary || '')
  if (datesGuess) {
    profileFieldMap['Dates attended'] = datesGuess
    profileFieldMap['dates attended'] = datesGuess
    profileFieldMap['Date attended'] = datesGuess
    profileFieldMap['Attendance dates'] = datesGuess
  }

  // Work authorization — many variations
  if (profile.workAuth.authorizedToWork != null) {
    const authStr = profile.workAuth.authorizedToWork ? 'Yes' : 'No'
    profileFieldMap['Are you legally authorized to work'] = authStr
    profileFieldMap['authorized to work'] = authStr
    profileFieldMap['Are you authorized to work in'] = authStr
    profileFieldMap['legally authorized'] = authStr
    profileFieldMap['eligible to work'] = authStr
    profileFieldMap['currently legally eligible'] = authStr
    profileFieldMap['legally eligible to work'] = authStr
    profileFieldMap['work authorization'] = authStr
    profileFieldMap['Do you have the legal right to work'] = authStr
    profileFieldMap['Are you eligible to work in the United States'] = authStr
    profileFieldMap['Are you authorized to work in the United States'] = authStr
    profileFieldMap['Are you currently legally eligible to work in the United States'] = authStr
    profileFieldMap['Do you have unrestricted authorization to work in the US'] = authStr
  }
  if (profile.workAuth.requiresSponsorship != null) {
    const sponsorStr = profile.workAuth.requiresSponsorship ? 'Yes' : 'No'
    profileFieldMap['require sponsorship'] = sponsorStr
    profileFieldMap['Will you now or in the future require sponsorship'] = sponsorStr
    profileFieldMap['sponsorship'] = sponsorStr
    profileFieldMap['visa sponsorship'] = sponsorStr
    profileFieldMap['immigration sponsorship'] = sponsorStr
    profileFieldMap['Do you now or will you in the future require'] = sponsorStr
    profileFieldMap['require visa sponsorship'] = sponsorStr
    profileFieldMap['need sponsorship'] = sponsorStr
  }
  if (profile.workAuth.clearanceEligible != null) {
    profileFieldMap['Security clearance'] = profile.workAuth.clearanceEligible ? 'Yes' : 'No'
    profileFieldMap['Clearance eligible'] = profile.workAuth.clearanceEligible ? 'Yes' : 'No'
  }

  // Citizenship / permanent resident — finer than authorized to work
  const citizenStatus = profile.workAuth.citizenshipStatus
  if (citizenStatus) {
    const isCitizenOrPR = citizenStatus === 'citizen' || citizenStatus === 'permanent_resident'
    const citizenPRStr = isCitizenOrPR ? 'Yes' : 'No'
    profileFieldMap['Are you a US Citizen or Permanent Resident'] = citizenPRStr
    profileFieldMap['Are you a US Citizen or Permanent Resident?'] = citizenPRStr
    profileFieldMap['US Citizen or Permanent Resident'] = citizenPRStr
    profileFieldMap['US citizen or permanent resident'] = citizenPRStr
    profileFieldMap['Are you a U.S. Citizen or Permanent Resident'] = citizenPRStr
    profileFieldMap['Are you a citizen'] = citizenStatus === 'citizen' ? 'Yes' : 'No'
    profileFieldMap['Are you a US citizen'] = citizenStatus === 'citizen' ? 'Yes' : 'No'
    profileFieldMap['citizenship status'] = citizenStatus === 'citizen' ? 'US Citizen' : citizenStatus === 'permanent_resident' ? 'Permanent Resident' : 'Other'
  }

  const usLocated = locatedInUnitedStatesAnswer(profile)
  if (usLocated) {
    profileFieldMap['Are you located in the United States'] = usLocated
    profileFieldMap['Are you located in the United States?'] = usLocated
    profileFieldMap['located in the United States'] = usLocated
  }

  // Education-related questions
  const edu = profile.background.educationSummary || ''
  if (edu.trim()) {
    const hasPhd = /phd|ph\.d|doctorate|doctor of/i.test(edu)
    const hasJdMd = /\bjd\b|j\.d\.|juris doctor|\bmd\b|m\.d\.|doctor of medicine/i.test(edu)
    const hasMBA = /mba/i.test(edu)
    const hasMasters = hasPhd || hasJdMd || hasMBA || /master|mph|ms\b|m\.s\./i.test(edu)
    const hasBachelors = hasMasters || /bachelor|bsc|b\.s\.|b\.a\./i.test(edu)
    const hasHighSchool = hasBachelors // if you have a bachelor's, you completed HS
    const degreeLevel = hasPhd ? 'Doctorate' : hasJdMd ? 'Doctorate' : hasMBA ? "Master's Degree" : hasMasters ? "Master's Degree" : hasBachelors ? "Bachelor's Degree" : "High School"
    profileFieldMap['What is the highest level of education you have completed'] = degreeLevel
    profileFieldMap['Highest level of education'] = degreeLevel
    profileFieldMap['highest degree'] = degreeLevel
    profileFieldMap['Education level'] = degreeLevel
    if (hasBachelors) {
      profileFieldMap['Do you have a Bachelor'] = 'Yes'
      profileFieldMap["Bachelor's Degree"] = 'Yes'
      profileFieldMap['High School Diploma'] = 'Yes'
      profileFieldMap['GED'] = 'Yes'
    }
    if (hasMasters) profileFieldMap["Master's Degree"] = 'Yes'
    if (hasMBA) profileFieldMap['MBA'] = 'Yes'
    if (hasPhd) {
      profileFieldMap['PhD'] = 'Yes'
      profileFieldMap['Doctorate'] = 'Yes'
      profileFieldMap['Doctoral degree'] = 'Yes'
    }
    if (hasJdMd) {
      profileFieldMap['Doctorate'] = 'Yes'
      profileFieldMap['Professional degree'] = 'Yes'
    }
  }

  // Work experience detail fields (repeater sections on "My Experience" forms)
  const workHistory = profile.background.workHistory || []
  if (workHistory.length > 0) {
    const mostRecent = workHistory[0]!
    if (mostRecent.title?.trim()) {
      const title = mostRecent.title.trim()
      profileFieldMap['Job Title'] = title
      profileFieldMap['Job title'] = title
      profileFieldMap['job title'] = title
      profileFieldMap['Title'] = title
      profileFieldMap['Position title'] = title
      profileFieldMap['Position'] = title
      profileFieldMap['Role'] = title
      profileFieldMap['Current title'] = title
      profileFieldMap['Most recent title'] = title
    }
    if (mostRecent.company?.trim()) {
      const company = mostRecent.company.trim()
      profileFieldMap['Company'] = company
      profileFieldMap['company'] = company
      profileFieldMap['Company name'] = company
      profileFieldMap['Employer'] = company
      profileFieldMap['Organization'] = company
      profileFieldMap['Current company'] = company
      profileFieldMap['Most recent company'] = company
      profileFieldMap['Company Name'] = company
    }
    if (mostRecent.location?.trim()) {
      // Use specific keys that won't collide with the generic "Location" used for city/state
      profileFieldMap['Work location'] = mostRecent.location.trim()
      profileFieldMap['Job location'] = mostRecent.location.trim()
    }
    if (mostRecent.description?.trim()) {
      const desc = mostRecent.description.trim()
      profileFieldMap['Role Description'] = desc
      profileFieldMap['role description'] = desc
      profileFieldMap['Job description'] = desc
      profileFieldMap['Description'] = desc
      profileFieldMap['Responsibilities'] = desc
      profileFieldMap['Job responsibilities'] = desc
      profileFieldMap['Role description'] = desc
    }
    if (mostRecent.currentlyWorkHere != null) {
      const cw = mostRecent.currentlyWorkHere ? 'Yes' : 'No'
      profileFieldMap['I currently work here'] = cw
      profileFieldMap['i currently work here'] = cw
      profileFieldMap['Currently working here'] = cw
      profileFieldMap['currently working here'] = cw
    }
    if (mostRecent.startMonth) {
      profileFieldMap['Month of start'] = String(mostRecent.startMonth).padStart(2, '0')
    }
    if (mostRecent.startYear) {
      profileFieldMap['Year of start'] = String(mostRecent.startYear)
    }
    // Format "From" as MM/YYYY for combined date fields
    if (mostRecent.startMonth && mostRecent.startYear) {
      const fromStr = `${String(mostRecent.startMonth).padStart(2, '0')}/${mostRecent.startYear}`
      profileFieldMap['From'] = fromStr
      profileFieldMap['from'] = fromStr
      profileFieldMap['Start date'] = fromStr
    }
    if (mostRecent.endMonth && mostRecent.endYear) {
      const toStr = `${String(mostRecent.endMonth).padStart(2, '0')}/${mostRecent.endYear}`
      profileFieldMap['To'] = toStr
      profileFieldMap['to'] = toStr
      profileFieldMap['End date'] = toStr
    }
  }

  // Experience-related questions — only when user has provided this fact.
  const yearsStr = String(profile.background.yearsOfExperience || '').trim()
  if (yearsStr) {
    const yearsNum = parseInt(yearsStr, 10)
    const yearsValue = Number.isFinite(yearsNum) ? String(yearsNum) : yearsStr
    profileFieldMap['years of experience'] = yearsValue
    profileFieldMap['How many years of work experience'] = yearsValue
    profileFieldMap['years of relevant experience'] = yearsValue
    profileFieldMap['Total years of experience'] = yearsValue
    profileFieldMap['How many years of work experience do you have with'] = yearsValue
    profileFieldMap['How many years of Information Technology experience'] = yearsValue
    profileFieldMap['years of Information Technology experience'] = yearsValue
    profileFieldMap['How many years of software'] = yearsValue
    profileFieldMap['years of software development'] = yearsValue
    profileFieldMap['years of engineering experience'] = yearsValue
    profileFieldMap['How many years of professional experience'] = yearsValue
    profileFieldMap['years of industry experience'] = yearsValue
  }

  // Start-date / availability facts only when explicitly provided.
  if (profile.compensation.startDatePreference?.trim()) {
    const start = profile.compensation.startDatePreference.trim()
    profileFieldMap['available to start'] = start
    profileFieldMap['When can you start'] = start
    profileFieldMap['start date'] = start
  }

  const yesNo = (value: boolean | undefined): string | null =>
    value == null ? null : value ? 'Yes' : 'No'

  const over18 = yesNo(profile.workAuth.over18)
  if (over18) {
    profileFieldMap['Are you at least 18 years'] = over18
    profileFieldMap['Are you 18 years of age or older'] = over18
    profileFieldMap['Are you over 18'] = over18
    profileFieldMap['at least 18'] = over18
  }

  const bgCheck = yesNo(profile.workAuth.canPassBackgroundCheck)
  if (bgCheck) {
    profileFieldMap['pass a background check'] = bgCheck
    profileFieldMap['background check'] = bgCheck
  }

  const drugTest = yesNo(profile.workAuth.canPassDrugTest)
  if (drugTest) {
    profileFieldMap['drug test'] = drugTest
    profileFieldMap['drug screen'] = drugTest
    profileFieldMap['pass a drug test'] = drugTest
  }

  const driver = yesNo(profile.workAuth.hasDriversLicense)
  if (driver) {
    profileFieldMap["driver's license"] = driver
    profileFieldMap['valid driver'] = driver
    profileFieldMap['Do you have a valid'] = driver
  }

  const relocate = yesNo(profile.workAuth.willingToRelocate)
  if (relocate) {
    profileFieldMap['willing to relocate'] = relocate
    profileFieldMap['relocation'] = relocate
  }

  const travel = yesNo(profile.workAuth.willingToTravel)
  if (travel) {
    profileFieldMap['willing to travel'] = travel
    profileFieldMap['travel requirement'] = travel
  }

  // Salary expectations
  if (profile.compensation.salaryMin != null) {
    const salMin = String(profile.compensation.salaryMin)
    profileFieldMap['desired salary'] = salMin
    profileFieldMap['salary expectations'] = salMin
    profileFieldMap['compensation expectations'] = salMin
    profileFieldMap['minimum salary'] = salMin
    profileFieldMap['expected total annual'] = salMin
    profileFieldMap['total annual compensation'] = salMin
    profileFieldMap['expected annual salary'] = salMin
    profileFieldMap['expected salary range'] = salMin
    profileFieldMap['What is your expected total annual compensation'] = salMin
    profileFieldMap['expected total annual compensation'] = salMin
    profileFieldMap['compensation expectation'] = salMin
  }
  if (profile.compensation.salaryMax != null) {
    profileFieldMap['maximum salary'] = String(profile.compensation.salaryMax)
    profileFieldMap['salary max'] = String(profile.compensation.salaryMax)
  }
  // Compensation alignment — removed auto-Yes; user's salary range doesn't
  // necessarily align with the job's range since we don't compare them.

  // Preferred name — first name from profile
  const firstName = profile.basics.fullName.split(/\s+/)[0] || ''
  if (firstName) {
    profileFieldMap['Preferred name'] = firstName
    profileFieldMap['preferred name'] = firstName
    profileFieldMap['What is your preferred name'] = firstName
    profileFieldMap['What name do you prefer'] = firstName
    profileFieldMap['Preferred first name'] = firstName
    profileFieldMap['What name do you go by'] = firstName
    profileFieldMap['Nickname'] = firstName
  }

  // Employee of company — always No (you're applying, not already employed there)
  profileFieldMap['Are you an employee of'] = 'No'
  profileFieldMap['employee of'] = 'No'
  profileFieldMap['Are you a current employee'] = 'No'
  profileFieldMap['current employee of'] = 'No'
  profileFieldMap['currently employed by'] = 'No'
  profileFieldMap['Do you currently work for'] = 'No'
  profileFieldMap['Do you currently work at'] = 'No'
  profileFieldMap['Are you currently employed at'] = 'No'
  profileFieldMap['Are you currently employed by'] = 'No'

  // Former employee / worked before — removed defaults; user may be a re-applicant
  // Non-compete — removed defaults; user may actually have a non-compete

  // Lie detector / polygraph acknowledgment (Massachusetts EPPA legal notice — "Yes" acknowledges reading)
  profileFieldMap['Employee Polygraph Protection Act'] = 'Yes'
  profileFieldMap['EPPA'] = 'Yes'
  profileFieldMap['lie detector acknowledgment'] = 'Yes'
  profileFieldMap['acknowledge the lie detector'] = 'Yes'

  // How did you hear about
  profileFieldMap['How did you hear about'] = 'LinkedIn'
  profileFieldMap['Where did you hear'] = 'LinkedIn'
  profileFieldMap['referral source'] = 'LinkedIn'
  profileFieldMap['How did you learn about'] = 'LinkedIn'
  profileFieldMap['How did you find out about'] = 'LinkedIn'
  profileFieldMap['How did you find this'] = 'LinkedIn'
  profileFieldMap['Where did you find this'] = 'LinkedIn'
  profileFieldMap['Source'] = 'LinkedIn'
  profileFieldMap['How were you referred'] = 'LinkedIn'

  // EEO / voluntary self-identification disclosures
  const eeoDeclination = 'I choose not to self-identify'
  const declineAlt = 'Decline to self-identify'
  const declineAlt2 = 'Decline To Self Identify'
  const declineAlt3 = 'I don\'t wish to answer'
  profileFieldMap['veteran status'] = eeoDeclination
  profileFieldMap['disability status'] = eeoDeclination
  profileFieldMap['gender'] = declineAlt
  profileFieldMap['Gender'] = declineAlt
  profileFieldMap['Gender identity'] = declineAlt
  profileFieldMap['What is your gender'] = declineAlt
  profileFieldMap['race'] = declineAlt
  profileFieldMap['Race'] = declineAlt
  profileFieldMap['ethnicity'] = declineAlt
  profileFieldMap['Ethnicity'] = declineAlt
  profileFieldMap['Race/Ethnicity'] = declineAlt
  profileFieldMap['Race / Ethnicity'] = declineAlt
  profileFieldMap['voluntary self-identification'] = eeoDeclination
  profileFieldMap['Voluntary Self-Identification'] = eeoDeclination
  profileFieldMap['Veteran status'] = declineAlt
  profileFieldMap['Are you a veteran'] = declineAlt3
  profileFieldMap['Are you a protected veteran'] = declineAlt3
  profileFieldMap['Disability status'] = declineAlt
  profileFieldMap['Disability Status'] = declineAlt
  profileFieldMap['Do you have a disability'] = declineAlt3
  profileFieldMap['Hispanic or Latino'] = declineAlt3
  profileFieldMap['Are you Hispanic or Latino'] = declineAlt3
  profileFieldMap['Sexual orientation'] = declineAlt
  profileFieldMap['Pronouns'] = ''

  // Education detail fields (dropdowns / free text on multi-step forms)
  if (profile.background.schoolName?.trim()) {
    const school = profile.background.schoolName.trim()
    profileFieldMap['School'] = school
    profileFieldMap['school'] = school
    profileFieldMap['University'] = school
    profileFieldMap['university'] = school
    profileFieldMap['Institution'] = school
    profileFieldMap['College'] = school
    profileFieldMap['School name'] = school
    profileFieldMap['University name'] = school
    profileFieldMap['Name of school'] = school
    profileFieldMap['Educational institution'] = school
  }
  if (profile.background.degreeType?.trim()) {
    const degree = profile.background.degreeType.trim()
    profileFieldMap['Degree'] = degree
    profileFieldMap['degree'] = degree
    profileFieldMap['Degree type'] = degree
    profileFieldMap['Type of degree'] = degree
    profileFieldMap['Degree level'] = degree
  }
  if (profile.background.fieldOfStudy?.trim()) {
    const field = profile.background.fieldOfStudy.trim()
    profileFieldMap['Field of study'] = field
    profileFieldMap['field of study'] = field
    profileFieldMap['Major'] = field
    profileFieldMap['major'] = field
    profileFieldMap['Discipline'] = field
    profileFieldMap['Area of study'] = field
    profileFieldMap['Concentration'] = field
  }
  if (profile.background.educationStartMonth) {
    profileFieldMap['Month of From'] = String(profile.background.educationStartMonth)
    profileFieldMap['Start month'] = String(profile.background.educationStartMonth)
  }
  if (profile.background.educationStartYear) {
    profileFieldMap['Year of From'] = String(profile.background.educationStartYear)
    profileFieldMap['Start year'] = String(profile.background.educationStartYear)
  }
  if (profile.background.educationEndMonth) {
    profileFieldMap['Month of To'] = String(profile.background.educationEndMonth)
    profileFieldMap['End month'] = String(profile.background.educationEndMonth)
  }
  if (profile.background.educationEndYear) {
    profileFieldMap['Year of To'] = String(profile.background.educationEndYear)
    profileFieldMap['End year'] = String(profile.background.educationEndYear)
    profileFieldMap['Graduation year'] = String(profile.background.educationEndYear)
  }
  if (profile.background.currentlyAttending != null) {
    profileFieldMap['I currently attend here'] = profile.background.currentlyAttending ? 'Yes' : 'No'
    profileFieldMap['Currently attending'] = profile.background.currentlyAttending ? 'Yes' : 'No'
  }

  // Cover letter / additional info
  profileFieldMap['cover letter'] = ''
  profileFieldMap['additional information'] = ''
  profileFieldMap['anything else'] = ''

  for (const entry of profile.answerBank) {
    profileFieldMap[entry.prompt] = String(entry.answer)
  }

  // Screening answer cache wins over profile defaults — user-provided answers are source of truth
  if (profile.screeningAnswerCache && typeof profile.screeningAnswerCache === 'object') {
    for (const [label, answer] of Object.entries(profile.screeningAnswerCache)) {
      if (answer) {
        profileFieldMap[label] = String(answer)
      }
    }
  }

  expandProfileKeysWithLabelAliases(profileFieldMap)
  return profileFieldMap
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-education context resolution
// ────────────────────────────────────────────────────────────────────────────

type EducationHistoryEntry = { school: string; degree: string; field: string; year: number | null }

const EDUCATION_SCHOOL_LABEL_RE = /\b(?:school|university|institution|college)(?:\s+name)?\b/i
const EDUCATION_SCHOOL_LABEL_EXCLUDE_RE = /\b(?:year|month|city|state|country|location|diploma|ged|high\s+school)\b/i
const EDUCATION_DEGREE_LABEL_RE = /\b(?:degree|diploma)\b/i
const EDUCATION_DEGREE_LABEL_EXCLUDE_RE = /\b(?:highest|level)\b/i
const EDUCATION_END_YEAR_LABEL_RE = /\b(?:graduation|end|to)\s*year\b|\byear of to\b/i
const FOUR_DIGIT_YEAR_RE = /\b(19|20)\d{2}\b/
const ACRONYM_STOP_WORDS = new Set(['of', 'the', 'and', 'for', 'at', 'in', 'on'])

/** Fuzzy-match a pre-populated school value against an educationHistory entry. */
function schoolMatchScore(formValue: string, historySchool: string): number {
  const a = formValue.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const b = historySchool.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  if (!a || !b) return 0
  if (a === b) return 100
  if (a.includes(b) || b.includes(a)) return 80
  const acronym = (text: string): string => text
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ACRONYM_STOP_WORDS.has(w))
    .map((w) => w[0])
    .join('')
  const aAcr = acronym(a)
  const bAcr = acronym(b)
  if (aAcr && bAcr && (aAcr === bAcr || a.includes(bAcr) || b.includes(aAcr))) return 70
  // Word overlap (handles "Columbia Business School" vs "Columbia University - Business School")
  const aWords = new Set(a.split(/\s+/).filter(w => w.length > 2))
  const bWords = new Set(b.split(/\s+/).filter(w => w.length > 2))
  let overlap = 0
  for (const w of aWords) { if (bWords.has(w)) overlap++ }
  const maxWords = Math.max(aWords.size, bWords.size)
  if (maxWords === 0) return 0
  return Math.round((overlap / maxWords) * 60)
}

/** Infer education start dates from degree type + graduation year (mirrors extractEducationDates). */
function inferEducationDates(entry: EducationHistoryEntry): {
  startMonth: number; startYear: number; endMonth: number; endYear: number
} | null {
  if (!entry.year || entry.year <= 0) return null
  const degreeText = (entry.degree || '').toLowerCase()
  const durationYears = /\bphd\b|\bdoctor/.test(degreeText) ? 5
    : /\bmba\b|\bmaster|\bms\b|\bma\b|\bmed\b/.test(degreeText) ? 2
    : 4
  return {
    startMonth: 9,
    startYear: entry.year - durationYears,
    endMonth: 6,
    endYear: entry.year,
  }
}

/** Internal key matching parity with fill-form profile map matching. */
function findFieldMapKeyForLabel(label: string, fieldMap: Record<string, string>): string | undefined {
  const labelLower = label.toLowerCase()
  const labelNormLower = normalizeFieldLabelForSnapshotMatch(label).toLowerCase()
  let matchKey = Object.keys(fieldMap).find((k) => k.toLowerCase() === labelLower)
  if (!matchKey) matchKey = Object.keys(fieldMap).find((k) => k.toLowerCase() === labelNormLower)
  if (!matchKey) {
    matchKey = Object.keys(fieldMap).find((k) => {
      const kl = k.toLowerCase()
      const shorter = Math.min(kl.length, labelLower.length)
      const longer = Math.max(kl.length, labelLower.length)
      if (shorter < 6 || shorter / longer < 0.4) return false
      const wordBoundary = new RegExp(`\\b${kl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      return wordBoundary.test(labelLower) || wordBoundary.test(labelNormLower)
    })
  }
  return matchKey
}

function isSchoolLabel(label: string): boolean {
  return EDUCATION_SCHOOL_LABEL_RE.test(label) && !EDUCATION_SCHOOL_LABEL_EXCLUDE_RE.test(label)
}

/**
 * Given a set of form fields (with current values), detect if a School field
 * is pre-populated.  If so, find the best-matching educationHistory entry and
 * return field-map overrides so the rest of the education fields (degree, major,
 * dates) come from the SAME entry.
 *
 * Returns null when no context resolution is needed (no pre-populated school
 * or no matching history entry).
 */
export function resolveEducationContextOverrides(
  formFields: Array<{ label: string; value?: string | null }>,
  educationHistory: EducationHistoryEntry[] | undefined
): Record<string, string> | null {
  if (!educationHistory?.length) return null

  // Find the pre-populated school value from the form
  let prePopulatedSchool: string | null = null
  let prePopulatedDegree: string | null = null
  let prePopulatedGradYear: number | null = null
  for (const f of formFields) {
    const label = f.label || ''
    const val = String(f.value || '').trim()
    if (!prePopulatedSchool && EDUCATION_SCHOOL_LABEL_RE.test(label) && !EDUCATION_SCHOOL_LABEL_EXCLUDE_RE.test(label)) {
      if (val) prePopulatedSchool = val
    }
    if (!prePopulatedDegree && EDUCATION_DEGREE_LABEL_RE.test(label) && !EDUCATION_DEGREE_LABEL_EXCLUDE_RE.test(label) && val) {
      prePopulatedDegree = val
    }
    if (prePopulatedGradYear == null && EDUCATION_END_YEAR_LABEL_RE.test(label) && val) {
      const m = val.match(FOUR_DIGIT_YEAR_RE)
      if (m?.[0]) prePopulatedGradYear = parseInt(m[0], 10)
    }
  }
  if (!prePopulatedSchool) return null

  // Find best match in educationHistory
  let bestEntry: EducationHistoryEntry | null = null
  let bestScore = 0
  let bestSchoolScore = 0
  for (const entry of educationHistory) {
    const schoolScore = schoolMatchScore(prePopulatedSchool, entry.school)
    let score = schoolScore
    if (prePopulatedDegree) {
      score += Math.round(schoolMatchScore(prePopulatedDegree, entry.degree) * 0.35)
    }
    if (prePopulatedGradYear != null && entry.year != null) {
      if (prePopulatedGradYear === entry.year) score += 20
      else if (Math.abs(prePopulatedGradYear - entry.year) === 1) score += 6
    }
    if (score > bestScore) {
      bestScore = score
      bestSchoolScore = schoolScore
      bestEntry = entry
    }
  }
  // Require a reasonable school match (>= 40 = at least decent overlap).
  if (!bestEntry || bestSchoolScore < 40) return null

  // Build overrides
  const overrides: Record<string, string> = {}
  const school = bestEntry.school.trim()
  if (school) {
    for (const k of ['School', 'school', 'University', 'university', 'Institution', 'College', 'School name', 'University name', 'Name of school', 'Educational institution']) {
      overrides[k] = school
    }
  }
  const degree = bestEntry.degree.trim()
  for (const k of ['Degree', 'degree', 'Degree type', 'Type of degree', 'Degree level']) {
    overrides[k] = degree // may be '' — that's intentional to avoid stale cross-entry degree values
  }
  // Field of study: use the matched entry's field, even if empty (to avoid
  // filling a wrong major from a different education)
  const field = bestEntry.field.trim()
  for (const k of ['Field of study', 'field of study', 'Major', 'major', 'Discipline', 'Area of study', 'Concentration']) {
    overrides[k] = field // may be '' — that's intentional to prevent cross-contamination
  }

  const dates = inferEducationDates(bestEntry)
  if (dates) {
    overrides['Month of From'] = String(dates.startMonth)
    overrides['Start month'] = String(dates.startMonth)
    overrides['Year of From'] = String(dates.startYear)
    overrides['Start year'] = String(dates.startYear)
    overrides['Month of To'] = String(dates.endMonth)
    overrides['End month'] = String(dates.endMonth)
    overrides['Year of To'] = String(dates.endYear)
    overrides['End year'] = String(dates.endYear)
    overrides['Graduation year'] = String(dates.endYear)
  } else {
    // Clear date defaults from other education entries when we cannot infer dates.
    for (const k of ['Month of From', 'Start month', 'Year of From', 'Start year', 'Month of To', 'End month', 'Year of To', 'End year', 'Graduation year']) {
      overrides[k] = ''
    }
  }

  return overrides
}

/**
 * Resolve per-field education overrides for steps that contain one or more
 * school contexts (including repeatable cards with multiple educations).
 *
 * Returns a sparse map keyed by form-field index -> forced value.
 */
export function resolveEducationFieldOverridesByIndex(
  formFields: Array<{ label: string; value?: string | null }>,
  educationHistory: EducationHistoryEntry[] | undefined
): Record<number, string> {
  if (!educationHistory?.length || formFields.length === 0) return {}

  const schoolIndices: number[] = []
  for (let i = 0; i < formFields.length; i++) {
    const f = formFields[i]
    if (!f) continue
    if (!isSchoolLabel(f.label || '')) continue
    if (String(f.value || '').trim()) schoolIndices.push(i)
  }
  if (schoolIndices.length === 0) return {}

  const byIndex: Record<number, string> = {}
  for (let c = 0; c < schoolIndices.length; c++) {
    const start = schoolIndices[c]!
    const nextStart = schoolIndices[c + 1]
    const end = nextStart == null ? formFields.length - 1 : Math.max(start, nextStart - 1)
    const contextFields = formFields.slice(start, end + 1)
    const contextOverrides = resolveEducationContextOverrides(contextFields, educationHistory)
    if (!contextOverrides) continue

    for (let i = start; i <= end; i++) {
      const f = formFields[i]
      if (!f) continue
      const matchKey = findFieldMapKeyForLabel(f.label || '', contextOverrides)
      if (!matchKey) continue
      byIndex[i] = String(contextOverrides[matchKey] ?? '')
    }
  }

  return byIndex
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-work-experience context resolution
// ────────────────────────────────────────────────────────────────────────────

type WorkHistoryEntry = {
  title: string
  company: string
  location?: string
  description?: string
  startMonth?: number | null
  startYear: number | null
  endMonth?: number | null
  endYear: number | null
  currentlyWorkHere?: boolean
}

const WORK_TITLE_LABEL_RE = /\b(?:job\s*title|position\s*title|title|role)\b/i
const WORK_TITLE_LABEL_EXCLUDE_RE = /\b(?:year|month|date|salary|description|company|employer)\b/i
const WORK_COMPANY_LABEL_RE = /\b(?:company|employer|organization|company\s*name)\b/i
const WORK_DESCRIPTION_LABEL_RE = /\b(?:role\s*description|description|responsibilities|job\s*description)\b/i
const WORK_LOCATION_LABEL_RE = /\blocation\b/i
const WORK_FROM_LABEL_RE = /\b(?:from|start\s*date)\b/i
const WORK_TO_LABEL_RE = /\b(?:(?<!year of\s)to(?:\b)|end\s*date)\b/i
const WORK_CURRENT_LABEL_RE = /\bcurrently\s*work\s*here\b/i

function isWorkTitleLabel(label: string): boolean {
  return WORK_TITLE_LABEL_RE.test(label) && !WORK_TITLE_LABEL_EXCLUDE_RE.test(label)
}

/** Fuzzy match a form Job Title value against a work history entry title. */
function workTitleMatchScore(formValue: string, historyTitle: string): number {
  const a = formValue.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const b = historyTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  if (!a || !b) return 0
  if (a === b) return 100
  if (a.includes(b) || b.includes(a)) return 80
  const aWords = new Set(a.split(/\s+/).filter(w => w.length > 2))
  const bWords = new Set(b.split(/\s+/).filter(w => w.length > 2))
  let overlap = 0
  for (const w of aWords) { if (bWords.has(w)) overlap++ }
  const maxWords = Math.max(aWords.size, bWords.size)
  if (maxWords === 0) return 0
  return Math.round((overlap / maxWords) * 60)
}

/**
 * Given form fields with a pre-populated Job Title, find the best matching
 * workHistory entry and return field-map overrides so Company, Location,
 * dates, and description come from the SAME entry.
 */
export function resolveWorkExperienceContextOverrides(
  formFields: Array<{ label: string; value?: string | null }>,
  workHistory: WorkHistoryEntry[] | undefined
): Record<string, string> | null {
  if (!workHistory?.length) return null

  let prePopulatedTitle: string | null = null
  let prePopulatedCompany: string | null = null
  for (const f of formFields) {
    const val = String(f.value || '').trim()
    if (!prePopulatedTitle && isWorkTitleLabel(f.label || '') && val) {
      prePopulatedTitle = val
    }
    if (!prePopulatedCompany && WORK_COMPANY_LABEL_RE.test(f.label || '') && val) {
      prePopulatedCompany = val
    }
  }
  if (!prePopulatedTitle) return null

  let bestEntry: WorkHistoryEntry | null = null
  let bestScore = 0
  for (const entry of workHistory) {
    let score = workTitleMatchScore(prePopulatedTitle, entry.title)
    if (prePopulatedCompany && entry.company) {
      score += Math.round(workTitleMatchScore(prePopulatedCompany, entry.company) * 0.35)
    }
    if (score > bestScore) {
      bestScore = score
      bestEntry = entry
    }
  }
  if (!bestEntry || bestScore < 40) return null

  const overrides: Record<string, string> = {}
  const title = bestEntry.title.trim()
  if (title) {
    for (const k of ['Job Title', 'Job title', 'job title', 'Title', 'Position title', 'Position', 'Role', 'Current title', 'Most recent title']) {
      overrides[k] = title
    }
  }
  const company = bestEntry.company.trim()
  if (company) {
    for (const k of ['Company', 'company', 'Company name', 'Employer', 'Organization', 'Current company', 'Most recent company', 'Company Name']) {
      overrides[k] = company
    }
  }
  const loc = (bestEntry.location || '').trim()
  if (loc) {
    overrides['Location'] = loc
    overrides['location'] = loc
    overrides['Work location'] = loc
    overrides['Job location'] = loc
  }
  const desc = (bestEntry.description || '').trim()
  for (const k of ['Role Description', 'role description', 'Job description', 'Description', 'Responsibilities', 'Job responsibilities', 'Role description']) {
    overrides[k] = desc
  }
  if (bestEntry.currentlyWorkHere != null) {
    const cw = bestEntry.currentlyWorkHere ? 'Yes' : 'No'
    overrides['I currently work here'] = cw
    overrides['i currently work here'] = cw
    overrides['Currently working here'] = cw
  }
  if (bestEntry.startMonth && bestEntry.startYear) {
    const fromStr = `${String(bestEntry.startMonth).padStart(2, '0')}/${bestEntry.startYear}`
    overrides['From'] = fromStr
    overrides['from'] = fromStr
    overrides['Start date'] = fromStr
    overrides['Month of start'] = String(bestEntry.startMonth).padStart(2, '0')
    overrides['Year of start'] = String(bestEntry.startYear)
  }
  if (bestEntry.endMonth && bestEntry.endYear) {
    const toStr = `${String(bestEntry.endMonth).padStart(2, '0')}/${bestEntry.endYear}`
    overrides['To'] = toStr
    overrides['to'] = toStr
    overrides['End date'] = toStr
  }

  return overrides
}

/**
 * Resolve per-field work experience overrides for repeater forms with multiple
 * work experience cards. Mirrors resolveEducationFieldOverridesByIndex.
 */
export function resolveWorkExperienceFieldOverridesByIndex(
  formFields: Array<{ label: string; value?: string | null }>,
  workHistory: WorkHistoryEntry[] | undefined
): Record<number, string> {
  if (!workHistory?.length || formFields.length === 0) return {}

  const titleIndices: number[] = []
  for (let i = 0; i < formFields.length; i++) {
    const f = formFields[i]
    if (!f) continue
    if (!isWorkTitleLabel(f.label || '')) continue
    if (String(f.value || '').trim()) titleIndices.push(i)
  }
  if (titleIndices.length === 0) return {}

  const byIndex: Record<number, string> = {}
  for (let c = 0; c < titleIndices.length; c++) {
    const start = titleIndices[c]!
    const nextStart = titleIndices[c + 1]
    const end = nextStart == null ? formFields.length - 1 : Math.max(start, nextStart - 1)
    const contextFields = formFields.slice(start, end + 1)
    const contextOverrides = resolveWorkExperienceContextOverrides(contextFields, workHistory)
    if (!contextOverrides) continue

    for (let i = start; i <= end; i++) {
      const f = formFields[i]
      if (!f) continue
      const matchKey = findFieldMapKeyForLabel(f.label || '', contextOverrides)
      if (!matchKey) continue
      byIndex[i] = String(contextOverrides[matchKey] ?? '')
    }
  }

  return byIndex
}
