export interface SkillDefinition {
  name: string;
  aliases: string[];
  category: string;
  ambiguous?: boolean;
}
const groups: Record<string, string[][]> = {
  Technical: [
    ["JavaScript", "JS"],
    ["TypeScript", "TS"],
    ["React", "React.js", "ReactJS"],
    ["Node.js", "NodeJS", "Node js"],
    ["Next.js", "NextJS"],
    ["PostgreSQL", "Postgres"],
    ["Docker"],
    ["AWS", "Amazon Web Services"],
    ["Azure", "Microsoft Azure"],
    ["Java"],
    ["Python"],
    ["SQL"],
    ["MySQL"],
    ["MongoDB"],
    ["C++"],
    ["C#"],
    ["HTML", "HTML5"],
    ["CSS", "CSS3"],
    ["Git"],
    ["Kubernetes", "K8s"],
    ["Linux"],
    ["REST APIs", "REST API"],
    ["Django"],
    ["Spring Boot"],
    ["Angular"],
    ["Vue.js", "VueJS"],
    ["Go", "Golang"],
    ["R"],
  ],
  Analytics: [
    ["Excel", "Microsoft Excel", "MS Excel"],
    ["Power BI", "PowerBI"],
    ["Tableau"],
    ["Pandas"],
    ["NumPy"],
    ["Statistics"],
  ],
  Business: [
    ["Sales"],
    ["Customer Relationship Management", "CRM"],
    ["Salesforce"],
    ["Accounting"],
    ["Bookkeeping"],
    ["Tally", "Tally ERP"],
    ["GST"],
    ["Financial Reporting"],
    ["Human Resources", "HR"],
    ["Recruitment"],
    ["Payroll"],
    ["Talent Acquisition"],
    ["Negotiation"],
    ["Project Management"],
    ["Customer Service"],
  ],
  Healthcare: [
    ["Patient Care"],
    ["Nursing"],
    ["Clinical Documentation"],
    ["CPR"],
    ["First Aid"],
  ],
  General: [["Communication"], ["Leadership"], ["Teamwork"]],
};
export const skillDictionary: SkillDefinition[] = Object.entries(
  groups,
).flatMap(([category, entries]) =>
  entries.map(([name, ...aliases]) => ({
    name,
    aliases,
    category,
    ambiguous: [
      "Go",
      "R",
      "Sales",
      "HR",
      "Communication",
      "Leadership",
      "Teamwork",
    ].includes(name),
  })),
);
