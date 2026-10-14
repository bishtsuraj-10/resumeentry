// All identities, employers and institutions below are synthetic.
export interface CorpusCase {
  id: string;
  kind: string;
  text: string;
  expected: Record<string, string | string[] | number | null>;
}
const header =
  "ALEX MORGAN\nSoftware Engineer\nalex.morgan@example.com\n+91 98765 43210";
const base = {
  "basic.name": "Alex Morgan",
  "basic.email": "alex.morgan@example.com",
  "basic.normalizedPhone": "+919876543210",
  "basic.designation": "Software Engineer",
  "profile.firstName": "Alex",
  "profile.lastName": "Morgan",
  "profile.headline": "Software Engineer",
};
export const corpus: CorpusCase[] = [
  {
    id: "developer",
    kind: "standard software developer",
    text:
      header +
      `\nLocation: Pune, Maharashtra, India\nCity: Pune\nState: Maharashtra\nCountry: India\nProfessional Summary\nBuilds web applications for internal operations.\nTechnical Skills\nJS, TypeScript, React.js, Node.js, PostgreSQL, Docker\nProfessional Experience\nSoftware Engineer at Synthetic Systems | Jan 2021 - Dec 2023\n- Built web services using Node.js and PostgreSQL\n- Reduced response time by 20%\nEducation\nBachelor of Technology in Computer Science\nInstitution: Synthetic Institute\n2017 - 2021\nCGPA: 8.1/10\nProjects\nProject: Operations Portal\nRole: Developer\nTechnologies: React.js, Node.js\n- Implemented access controls\nCertifications\nCertification: Cloud Foundations\nIssuer: Example Academy\nIssue Date: Jan 2023\nCredential ID: SYN-001\nLanguages\nEnglish, Hindi`,
    expected: {
      ...base,
      "profile.locationText": "Pune, Maharashtra, India",
      "profile.city": "Pune",
      "profile.region": "Maharashtra",
      "profile.country": "India",
      "profile.summary": "Builds web applications for internal operations.",
      "profile.totalExperienceMonths": 36,
      skills: [
        "JavaScript",
        "TypeScript",
        "React",
        "Node.js",
        "PostgreSQL",
        "Docker",
      ],
      "employment.employer": ["Synthetic Systems"],
      "employment.designation": ["Software Engineer"],
      "education.degree": ["Bachelor of Technology"],
      "education.institution": ["Synthetic Institute"],
      "projects.name": ["Operations Portal"],
      "certifications.name": ["Cloud Foundations"],
      "certifications.issuer": ["Example Academy"],
      "additional.title": ["English", "Hindi"],
    },
  },
  {
    id: "fresher",
    kind: "fresher",
    text: `MAYA REED\nmaya.reed@example.com\n+91 98765 43210\nCareer Objective\nSeeking an entry-level role in software development.\nEducation\nB.Sc in Computer Science\nInstitution: Synthetic College\nCompletion Date: 2025\nSkills\nPython, SQL\nProjects\nProject: Library Tool\nTechnologies: Python, SQL`,
    expected: {
      "basic.name": "Maya Reed",
      "basic.email": "maya.reed@example.com",
      "basic.normalizedPhone": "+919876543210",
      "profile.firstName": "Maya",
      "profile.lastName": "Reed",
      "profile.objective":
        "Seeking an entry-level role in software development.",
      skills: ["Python", "SQL"],
      "education.degree": ["B.Sc"],
      "education.institution": ["Synthetic College"],
      "projects.name": ["Library Tool"],
    },
  },
  {
    id: "experienced",
    kind: "experienced overlapping employment",
    text:
      header +
      `\nExperience\nSoftware Engineer at Example North | Jan 2020 - Dec 2022\n- Built services with Java\nSenior Software Engineer at Example South | Jan 2022 - Dec 2024\n- Led delivery using Docker\nEngineering Manager at Example South | Jan 2025 - Present`,
    expected: {
      ...base,
      "basic.designation": "Engineering Manager",
      "profile.totalExperienceMonths": 81,
      skills: ["Java", "Docker"],
      "employment.employer": ["Example North", "Example South"],
      "employment.designation": [
        "Software Engineer",
        "Senior Software Engineer",
        "Engineering Manager",
      ],
    },
  },
  {
    id: "analyst",
    kind: "data analyst",
    text: `JAMIE BLAKE\nData Analyst\njamie.blake@example.com\n+1 415 555 1234\nCore Competencies: Excel, PowerBI, SQL, Python\nEmployment\nData Analyst at Example Analytics | Feb 2022 - Jan 2024\n- Improved reporting using Power BI\nAcademic Qualifications\nMaster of Science\nInstitution: Example University`,
    expected: {
      "basic.name": "Jamie Blake",
      "basic.email": "jamie.blake@example.com",
      "basic.normalizedPhone": "+14155551234",
      "basic.designation": "Data Analyst",
      "profile.firstName": "Jamie",
      "profile.lastName": "Blake",
      "profile.headline": "Data Analyst",
      "profile.totalExperienceMonths": 24,
      skills: ["Excel", "Power BI", "SQL", "Python"],
      "employment.employer": ["Example Analytics"],
      "employment.designation": ["Data Analyst"],
      "education.degree": ["Master of Science"],
      "education.institution": ["Example University"],
    },
  },
  {
    id: "sales",
    kind: "sales",
    text: `TAYLOR LANE\nSales Executive\ntaylor.lane@example.com\nSkills\nSales, CRM, Negotiation, Excel\nWork Experience\nSales Executive at Example Retail | 2021 - 2024\n- Increased revenue by 12%`,
    expected: {
      "basic.name": "Taylor Lane",
      "basic.email": "taylor.lane@example.com",
      "basic.designation": "Sales Executive",
      "profile.firstName": "Taylor",
      "profile.lastName": "Lane",
      "profile.headline": "Sales Executive",
      skills: [
        "Sales",
        "Customer Relationship Management",
        "Negotiation",
        "Excel",
      ],
      "employment.employer": ["Example Retail"],
      "employment.designation": ["Sales Executive"],
    },
  },
  {
    id: "hr",
    kind: "human resources",
    text: `ROBIN HALE\nHR Manager\nrobin.hale@example.com\nTechnical Skills\nHuman Resources, Recruitment, Payroll, Talent Acquisition\nExperience\nHR Manager at Example Services | Apr 2021 - Mar 2024\nNotice Period: 30 days\nEmployment Preferences: Remote, Full-time`,
    expected: {
      "basic.name": "Robin Hale",
      "basic.email": "robin.hale@example.com",
      "basic.designation": "Hr Manager",
      "profile.firstName": "Robin",
      "profile.lastName": "Hale",
      "profile.headline": "HR Manager",
      "profile.totalExperienceMonths": 36,
      "profile.noticePeriod": "30 days",
      "profile.employmentPreferences": ["Remote", "Full-time"],
      skills: [
        "Human Resources",
        "Recruitment",
        "Payroll",
        "Talent Acquisition",
      ],
      "employment.employer": ["Example Services"],
      "employment.designation": ["Hr Manager"],
    },
  },
  {
    id: "accountant",
    kind: "accountant",
    text: `SAMIRA NOOR\nAccountant\nsamira.noor@example.com\nSkills\nAccounting, Tally, GST, Excel, Financial Reporting\nEducation\nBachelor of Commerce\nInstitution: Example College\nExperience\nAccountant at Example Finance | 2019 - 2023`,
    expected: {
      "basic.name": "Samira Noor",
      "basic.email": "samira.noor@example.com",
      "basic.designation": "Accountant",
      "profile.firstName": "Samira",
      "profile.lastName": "Noor",
      "profile.headline": "Accountant",
      skills: ["Accounting", "Tally", "GST", "Excel", "Financial Reporting"],
      "education.degree": ["Bachelor of Commerce"],
      "education.institution": ["Example College"],
      "employment.employer": ["Example Finance"],
      "employment.designation": ["Accountant"],
    },
  },
  {
    id: "healthcare",
    kind: "healthcare",
    text: `DANA WELLS\nRegistered Nurse\ndana.wells@example.com\nSkills\nPatient Care, Nursing, CPR, Clinical Documentation\nExperience\nRegistered Nurse at Example Hospital | Jan 2020 - Dec 2024\nEducation\nBachelor of Science in Nursing\nInstitution: Example Nursing College\nLicenses\nCertification: Nursing License\nIssuer: Example Council`,
    expected: {
      "basic.name": "Dana Wells",
      "basic.email": "dana.wells@example.com",
      "basic.designation": "Registered Nurse",
      "profile.firstName": "Dana",
      "profile.lastName": "Wells",
      "profile.headline": "Registered Nurse",
      "profile.totalExperienceMonths": 60,
      skills: ["Patient Care", "Nursing", "CPR", "Clinical Documentation"],
      "employment.employer": ["Example Hospital"],
      "employment.designation": ["Registered Nurse"],
      "education.degree": ["Bachelor of Science"],
      "education.institution": ["Example Nursing College"],
      "certifications.name": ["Nursing License"],
      "certifications.issuer": ["Example Council"],
    },
  },
  {
    id: "two-column",
    kind: "two-column text order",
    text:
      header +
      `\nSKILLS\tEDUCATION\nJavaScript, React\tB.Tech in Computing\nDocker\tInstitution: Example Institute\nExperience\nSoftware Engineer at Example Labs | Jan 2022 - Dec 2023`,
    expected: {
      ...base,
      skills: ["JavaScript", "React", "Docker"],
      "education.degree": ["B.Tech"],
      "education.institution": ["Example Institute"],
      "employment.employer": ["Example Labs"],
      "employment.designation": ["Software Engineer"],
      "profile.totalExperienceMonths": 24,
    },
  },
  {
    id: "table",
    kind: "table-heavy text",
    text:
      header +
      `\nExperience\nSoftware Engineer\tExample Tables\tJan 2020 - Dec 2021\nSkills\nPython\tExcel\tSQL\nEducation\nB.Sc\nInstitution: Example College`,
    expected: {
      ...base,
      skills: ["Python", "Excel", "SQL"],
      "employment.employer": ["Example Tables"],
      "employment.designation": ["Software Engineer"],
      "profile.totalExperienceMonths": 24,
      "education.degree": ["B.Sc"],
      "education.institution": ["Example College"],
    },
  },
  {
    id: "scanned-transcript",
    kind: "scanned OCR transcript",
    text: `ALEX MORGAN\nSoftware Engineer\nalex.morgan@example.com\n+91 98765 43210\nSKILLS\nPython, SQL\nEDUCATION\nB.Sc\nInstitution: Example College`,
    expected: {
      ...base,
      skills: ["Python", "SQL"],
      "education.degree": ["B.Sc"],
      "education.institution": ["Example College"],
    },
  },
  {
    id: "multi-page",
    kind: "multi-page",
    text:
      header +
      `\nSkills\nJava, Docker\nPage 1 of 2\n\f\nExperience\nSoftware Engineer at Example Multi | Jan 2021 - Dec 2022\nEducation\nB.Tech\nInstitution: Example Institute\nPage 2 of 2`,
    expected: {
      ...base,
      skills: ["Java", "Docker"],
      "employment.employer": ["Example Multi"],
      "employment.designation": ["Software Engineer"],
      "profile.totalExperienceMonths": 24,
      "education.degree": ["B.Tech"],
      "education.institution": ["Example Institute"],
    },
  },
  {
    id: "unusual-order",
    kind: "unusual heading order",
    text:
      header +
      `\nE D U C A T I O N :\nB.Sc\nInstitution: Example College\nCORE COMPETENCIES:\nPython, Excel\nPROFESSIONAL SUMMARY:\nCreates concise operational reports.\nPublications\nExample Methods Paper\nAwards\nExample Award`,
    expected: {
      ...base,
      skills: ["Python", "Excel"],
      "profile.summary": "Creates concise operational reports.",
      "education.degree": ["B.Sc"],
      "education.institution": ["Example College"],
      "additional.title": ["Example Methods Paper", "Example Award"],
    },
  },
  {
    id: "minimal",
    kind: "missing optional fields",
    text: `KAI RIVERS\nkai.rivers@example.com`,
    expected: {
      "basic.name": "Kai Rivers",
      "basic.email": "kai.rivers@example.com",
      "profile.firstName": "Kai",
      "profile.lastName": "Rivers",
    },
  },
  {
    id: "partial-dates",
    kind: "partial dates and explicit DOB",
    text:
      header +
      `\nDOB: 2000-02-29\nExperience\nSoftware Engineer at Example Partial | 2021 - Present\nEducation\nB.Tech\nInstitution: Example College\nCompletion Date: 2021`,
    expected: {
      ...base,
      "profile.dateOfBirth": "2000-02-29",
      "employment.employer": ["Example Partial"],
      "employment.designation": ["Software Engineer"],
      "education.degree": ["B.Tech"],
      "education.institution": ["Example College"],
    },
  },
  {
    id: "references",
    kind: "reference contacts",
    text:
      header +
      `\nSkills\nJavaScript\nReferences\nDR REFERENCE PERSON\nreference@example.com\n+1 415 555 9999\nEngineering Manager\nLinkedIn: https://linkedin.com/in/reference\nCompany Email: recruiter@example.com`,
    expected: { ...base, skills: ["JavaScript"] },
  },
  // Holdout-shaped ambiguous entries: report misses rather than invent companies/skills.
  {
    id: "ambiguous-layout",
    kind: "unlabelled ambiguous record",
    text: `ELENA PARK\nelena.park@example.com\nExperience\nExample Co\nEngineering duties\n2019 - 2022\nProjects\nBuilt several tools for teams.\nSkills\nJavaScript`,
    expected: {
      "basic.name": "Elena Park",
      "basic.email": "elena.park@example.com",
      "profile.firstName": "Elena",
      "profile.lastName": "Park",
      skills: ["JavaScript"],
      "employment.employer": ["Example Co"],
    },
  },
];
// Independent ground truth for more granular date, contact and relationship fields.
const details: Record<
  string,
  Record<string, string | string[] | number | null>
> = {
  developer: {
    "employment.startDate": ["2021-01"],
    "employment.endDate": ["2023-12"],
    "education.endDate": ["2021"],
    "education.fieldOfStudy": ["Computer Science"],
    "education.grade": ["8.1"],
    "education.gradeScale": ["10"],
    "projects.role": ["Developer"],
    "projects.skills": ["React", "Node.js"],
    "certifications.issueDate": ["2023-01"],
  },
  fresher: {
    "education.fieldOfStudy": ["Computer Science"],
    "education.endDate": ["2025"],
    "projects.skills": ["Python", "SQL"],
  },
  experienced: {
    "employment.startDate": ["2020-01", "2022-01", "2025-01"],
    "employment.endDate": ["2022-12", "2024-12"],
  },
  analyst: {
    "employment.startDate": ["2022-02"],
    "employment.endDate": ["2024-01"],
  },
  sales: { "employment.startDate": ["2021"], "employment.endDate": ["2024"] },
  hr: {
    "employment.startDate": ["2021-04"],
    "employment.endDate": ["2024-03"],
  },
  accountant: {
    "employment.startDate": ["2019"],
    "employment.endDate": ["2023"],
  },
  healthcare: {
    "employment.startDate": ["2020-01"],
    "employment.endDate": ["2024-12"],
    "education.fieldOfStudy": ["Nursing"],
  },
  "two-column": {
    "employment.startDate": ["2022-01"],
    "employment.endDate": ["2023-12"],
    "education.fieldOfStudy": ["Computing"],
  },
  table: {
    "employment.startDate": ["2020-01"],
    "employment.endDate": ["2021-12"],
  },
  "multi-page": {
    "employment.startDate": ["2021-01"],
    "employment.endDate": ["2022-12"],
  },
  "partial-dates": {
    "employment.startDate": ["2021"],
    "education.endDate": ["2021"],
  },
  "ambiguous-layout": {
    "employment.startDate": ["2019"],
    "employment.endDate": ["2022"],
  },
};
for (const fixture of corpus)
  Object.assign(fixture.expected, details[fixture.id] ?? {});
corpus.push({
  id: "profile-links",
  kind: "multiple contacts and professional links",
  text:
    header +
    `\nOther Email: alex.other@example.com\nAlternate Phone: +1 415 555 1234\nLinkedIn: linkedin.com/in/synthetic\nGitHub: https://github.com/synthetic\nPortfolio: https://example.com/portfolio`,
  expected: {
    ...base,
    "basic.otherEmails": ["alex.other@example.com"],
    "profile.additionalPhones": ["+14155551234"],
    "links.url": [
      "https://linkedin.com/in/synthetic",
      "https://github.com/synthetic",
      "https://example.com/portfolio",
    ],
  },
});
