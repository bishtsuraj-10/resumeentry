import { extractResumeFields } from "../basic";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { evidence, type MachineEvidence } from "../field-confidence";
import type { SectionLine } from "../section-detector";
import { parseDate } from "../validators/dates";
export function extractIdentityContact(lines: SectionLine[]) {
  const contactLines = lines.filter(
    (l) =>
      ["header", "personal"].includes(l.section) &&
      !/\b(?:reference|referee|recruiter|company email|employer contact)\b/i.test(
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
      const words = basic.name.split(" ");
      // Multi-token family names and initials remain unsplit rather than guessed.
      if (
        words.length === 2 &&
        words.every(
          (w) =>
            /^\p{L}[\p{L}'-]*$/u.test(w) &&
            (w.match(/\p{L}/gu) ?? []).length >= 2,
        )
      ) {
        profile.firstName = words[0];
        profile.lastName = words[1];
        proofs.push(
          evidence("profile.firstName", line, ["TWO_TOKEN_NAME"], 0.78),
          evidence("profile.lastName", line, ["TWO_TOKEN_NAME"], 0.78),
        );
      }
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
  const phones = new Map<
    string,
    {
      originalText: string;
      normalizedPhone: string;
      countryCode: string;
    }
  >();
  for (const line of contactLines) {
    for (const value of line.text.match(/\+\d[\d ().-]{7,}\d/g) ?? []) {
      const phone = parsePhoneNumberFromString(value);
      if (phone?.isValid() && phone.number !== basic.normalizedPhone)
        phones.set(phone.number, {
          originalText: value,
          normalizedPhone: phone.number,
          countryCode: "+" + phone.countryCallingCode,
        });
    }
    const location = line.text.match(
      /^(?:location|address|based in)\s*:\s*(.+)$/i,
    );
    if (location) {
      profile.locationText = location[1].slice(0, 500);
      proofs.push(
        evidence("profile.locationText", line, ["EXPLICIT_LABEL"], 0.94),
      );
      // Structured location requires labelled components; commas alone do not identify a state/country.
    }
    // Preserve clearly formatted, unlabelled header locations as text only.
    // Do not guess which comma-separated component is a state or country.
    if (
      !location &&
      !profile.locationText &&
      /^[\p{L} .'-]+,\s*[\p{L} .'-]+(?:,\s*[\p{L} .'-]+)?$/u.test(line.text) &&
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
      for (const [key, value] of [
        ["city", parts[0]],
        ["region", parts[1]],
        ["country", "United States"],
      ])
        if (!profile[key]) {
          profile[key] = value;
          proofs.push(
            evidence(
              "profile." + key,
              line,
              ["HEADER_LOCATION", "RECOGNIZED_COUNTRY_AND_REGION"],
              0.88,
            ),
          );
        }
    }
    for (const [key, label] of [
      ["city", "city"],
      ["region", "state|region"],
      ["country", "country"],
    ]) {
      const m = line.text.match(new RegExp(`^(?:${label})\\s*:\\s*(.+)$`, "i"));
      if (m) {
        profile[key] = m[1].slice(0, 200);
        proofs.push(evidence("profile." + key, line, ["EXPLICIT_LABEL"], 0.96));
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
  if (basic.otherEmails.length) {
    profile.additionalEmails = basic.otherEmails;
    for (const line of eligible.filter((l) =>
      basic.otherEmails.some((e) => l.text.toLowerCase().includes(e)),
    ))
      proofs.push(
        evidence("profile.additionalEmails", line, ["VALIDATED_CONTACT"], 0.98),
      );
  }
  if (phones.size) {
    // Input schema expects original international strings, not machine confidence.
    profile.additionalPhones = [...phones.values()].map((p) => p.originalText);
    for (const line of contactLines.filter((l) =>
      [...phones.values()].some((p) => l.text.includes(p.originalText)),
    ))
      proofs.push(
        evidence("profile.additionalPhones", line, ["VALIDATED_CONTACT"], 0.94),
      );
  }
  return { basic, profile, evidence: proofs };
}
