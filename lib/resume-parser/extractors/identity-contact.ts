import { extractResumeFields, jobTitle } from "../basic";
import { heading } from "../section-detector";
import { evidence, type MachineEvidence } from "../field-confidence";
import type { SectionLine } from "../section-detector";
import { parseDate } from "../validators/dates";
import { meaningfulReviewText } from "../review-policy";
const indianRegions = "Andhra Pradesh|Arunachal Pradesh|Assam|Bihar|Chhattisgarh|Goa|Gujarat|Haryana|Himachal Pradesh|Jharkhand|Karnataka|Kerala|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Punjab|Rajasthan|Sikkim|Tamil Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|West Bengal|Delhi|Chandigarh|Jammu and Kashmir|Ladakh|Puducherry|Andaman and Nicobar Islands|Lakshadweep|Dadra and Nagar Haveli and Daman and Diu";
const indianRegionLine = new RegExp(`^(?:${indianRegions})(?:\\s+\\d{6})?$`, "i");
export function extractIdentityContact(lines: SectionLine[]) {
  const contactLines = lines.filter(
    (l) =>
      ["header", "personal"].includes(l.section) &&
      !/\b(?:reference|referee|recruiter|company email|employer contact|(?:employer|company|university|institution|project)\s+(?:address|location))\b/i.test(
        l.text,
      ),
  );
  const eligible = contactLines.map((l) => ({
    ...l,
    text: l.text.replace(/^(?:full name|name)\s*:\s*/i, ""),
  }));
  const basic = extractResumeFields(eligible.map((l) => l.text).join("\n"));
  const primaryPhoneLine = eligible.find((l) =>
    /\d[\d ().+-]{7,}/.test(l.text),
  );
  const primaryPhoneText = primaryPhoneLine?.text.match(
    /(?:\+?\d[\d ().-]{7,}\d)/,
  )?.[0];
  const unresolvedPhone = Boolean(
    basic.phone && primaryPhoneText && !primaryPhoneText.startsWith("+"),
  );
  if (unresolvedPhone) {
    // Keep the stated number for review; do not invent its calling country.
    basic.phone = primaryPhoneText!.trim();
    basic.countryCode = null;
    basic.normalizedPhone = null;
    basic.phoneConfidence = 0.55;
  }
  const proofs: MachineEvidence[] = [];
  const profile: Record<string, unknown> = {};
  if (basic.name) {
    const line = eligible.find(
      (l) => l.text.toLowerCase() === basic.name?.toLowerCase(),
    );
    if (line) {
      proofs.push(
        evidence(
          "basic.name",
          line,
          ["HEADER_NAME_PATTERN"],
          basic.nameConfidence,
        ),
      );
    } else {
      basic.name = null;
      basic.nameConfidence = 0;
    }
  }
  for (const field of ["email", "phone"] as const) {
    const line = eligible.find((l) =>
      field === "email"
        ? l.text.toLowerCase().includes(basic.email ?? "\0")
        : /\d[\d ()+-]{7,}/.test(l.text),
    );
    if (basic[field] && line)
      proofs.push(
        evidence(
          `basic.${field}`,
          line,
          [
            field === "phone" && unresolvedPhone
              ? "UNRESOLVED_PHONE_COUNTRY"
              : "VALIDATED_CONTACT",
            "CANDIDATE_HEADER",
          ],
          basic[field === "email" ? "emailConfidence" : "phoneConfidence"],
        ),
      );
  }
  const locationComponents = new Map<string, { value: string; line: SectionLine }>();
  for (const [index, original] of contactLines.entries()) {
    const line = { ...original };
    const explicitlyLocated = /^(?:location|address|based in)\s*:/i.test(line.text);
    // Continue labelled addresses only through adjacent, address-shaped lines.
    // Preserve source spelling; other contact fields and section headings stop it.
    if (explicitlyLocated) {
      for (let offset = 1; offset <= 3; offset++) {
        const next = contactLines[index + offset];
        const previous = contactLines[index + offset - 1];
        if (!next || next.page !== original.page || next.line !== previous.line + 1 ||
            heading(next.text) || jobTitle(next.text) || /[:@/]/.test(next.text) ||
            !/^[\p{L}\d .,'-]+$/u.test(next.text) ||
            !(/,/.test(next.text) || /\b\d{5,6}\b/.test(next.text) || indianRegionLine.test(next.text) ||
              /^(?:location|address|based in)\s*:\s*$/i.test(line.text) ||
              /^(?:India|United States|United Kingdom|Canada|Australia|United Arab Emirates|South Africa|New Zealand)$/i.test(next.text))) break;
        line.text += /[:,]\s*$/.test(line.text) ? " " + next.text : ", " + next.text;
      }
    }
    const location = line.text.match(
      /^(?:location|address|based in)\s*:\s*(.+)$/i,
    );
    if (location) {
      profile.locationText = location[1].slice(0, 500);
      proofs.push(
        evidence("profile.locationText", line, ["EXPLICIT_LABEL"], 0.94),
      );
    }
    // Preserve clearly formatted, unlabelled header locations as text only.
    // Do not guess which comma-separated component is a state or country.
    if (
      !location &&
      !profile.locationText &&
      (/^[\p{L} .'-]+,\s*[\p{L} .'-]+(?:,\s*[\p{L} .'-]+)?$/u.test(line.text) ||
       /^[\p{L} .,'-]+\s+\d{6}(?:,?\s+India)?$/u.test(line.text)) &&
      !line.text.includes("@")
    ) {
      profile.locationText = line.text.slice(0, 500);
      proofs.push(
        evidence(
          "profile.locationText",
          line,
          ["HEADER_LOCATION_PATTERN"],
          0.84,
        ),
      );
    }
    const parts = line.text
      .replace(/^(?:location|address|based in)\s*:\s*/i, "")
      .split(/,\s*/);
    const states =
      "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming".split(
        "|",
      );
    if (
      parts.length === 3 &&
      /^(United States|USA|U\.S\.A\.?)$/i.test(parts[2]) &&
      states.some((s) => s.toLowerCase() === parts[1].toLowerCase()) &&
      /^[\p{L} .'-]+$/u.test(parts[0])
    ) {
      if (!profile.locationText) {
        profile.locationText = line.text.replace(/^(?:location|address|based in)\s*:\s*/i, "").slice(0, 500);
        proofs.push(evidence("profile.locationText", line, ["HEADER_LOCATION", "RECOGNIZED_COUNTRY_AND_REGION"], 0.88));
      }
    }
    for (const [key, label] of [
      ["city", "city"],
      ["region", "state|region"],
      ["country", "country"],
    ]) {
      const m = line.text.match(new RegExp(`^(?:${label})\\s*:\\s*(.+)$`, "i"));
      if (m) {
        const value = m[1].slice(0, 200);
        if (meaningfulReviewText(value)) locationComponents.set(key, { value, line });
      }
    }
    const dob = line.text.match(
      /^(?:date of birth|dob|birth date)\s*:\s*(.+)$/i,
    );
    if (dob) {
      const parsed = parseDate(dob[1]);
      if (parsed?.year && parsed.month && parsed.day) {
        const date = new Date(
          Date.UTC(parsed.year, parsed.month - 1, parsed.day),
        );
        if (date <= new Date()) {
          profile.dateOfBirth = date.toISOString().slice(0, 10);
          proofs.push(
            evidence(
              "profile.dateOfBirth",
              line,
              ["EXPLICIT_DOB_LABEL", "FULL_DATE"],
              0.96,
            ),
          );
        }
      }
    }
  }
  if (!meaningfulReviewText(profile.locationText as string | undefined) && locationComponents.size) {
    profile.locationText = ["city", "region", "country"]
      .flatMap(key => locationComponents.has(key) ? [locationComponents.get(key)!.value] : [])
      .join(", ");
    for (const component of locationComponents.values())
      proofs.push(evidence("profile.locationText", component.line, ["EXPLICIT_LOCATION_COMPONENT"], 0.96));
  }
  return { basic, profile, evidence: proofs };
}
