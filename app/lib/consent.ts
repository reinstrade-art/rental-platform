/**
 * The data protection notice shown when someone registers via an invite.
 *
 * Written against Kenya's Data Protection Act, 2019, which requires consent
 * to be express, informed, specific and freely given, and requires the
 * controller to say who they are, what they collect, why, on what lawful
 * basis, who sees it, where it goes and how long it is kept.
 *
 * NOT LEGAL ADVICE. This is a working notice drafted from the Act's
 * structure and ordinary letting practice; each organization should have it
 * reviewed by an advocate before relying on it, and may need to register
 * with the Office of the Data Protection Commissioner. Every landlord
 * customer on this platform is its own data controller — this notice is
 * templated with THAT organization's own name and contact details, never a
 * platform default, because the platform operator is not the controller of
 * a tenant's personal data, the landlord organization is.
 *
 * The version is stored alongside each person's consent. Change the
 * wording in a way that alters what someone is agreeing to and
 * CONSENT_VERSION MUST be bumped — consent to an earlier notice is not
 * consent to a later one.
 */
export const CONSENT_VERSION = "2026-08-v1";

export type ConsentOrg = {
  name: string;
  letterheadName: string | null;
  letterheadAddress: string | null;
  letterheadPhone: string | null;
  letterheadEmail: string | null;
};

export type ConsentSection = { heading: string; body: string[] };

export function buildConsentNotice(org: ConsentOrg): ConsentSection[] {
  const name = org.letterheadName || org.name;
  const contact = [org.letterheadPhone, org.letterheadEmail].filter(Boolean).join(" or ") || "the office";
  const address = org.letterheadAddress || "the address on file";

  return [
    {
      heading: "Who holds your information",
      body: [`${name} of ${address} is the data controller. You can reach them on ${contact}.`],
    },
    {
      heading: "What is collected",
      body: [
        "Your name, national ID or passport number, phone number, email address, and the unit you rent (or the trade you work for this office).",
        "Your account: what you have been charged, what you have paid, the M-Pesa or bank reference for each payment, and any balance outstanding.",
        "Repairs you report or are assigned, messages you send, and your tenancy agreement or work orders.",
      ],
    },
    {
      heading: "Why it's needed, and on what basis",
      body: [
        "To run your tenancy or engagement — billing, matching payments, issuing receipts and invoices, and answering you. This is necessary to perform the agreement between you and the office.",
        "To meet obligations the law places on the office, including keeping accounting records for the Kenya Revenue Authority.",
        "An ID number is collected to confirm who you are and to identify you in any dispute. Giving it is a condition of the tenancy or engagement.",
      ],
    },
    {
      heading: "Who else sees it",
      body: [
        "Nobody outside this office, except where necessary: a bank or M-Pesa in order to match payments; a contractor attending a repair, told only what the job requires; the office's advocate or auditor where a matter requires it; and any authority entitled to it by law.",
        "Your information is not sold, and is not used for marketing.",
      ],
    },
    {
      heading: "How long it's kept",
      body: [
        "For as long as the tenancy or engagement lasts, and afterwards for seven years, the period accounting and tax records must be kept. After that it is deleted.",
        "A login is closed when a tenancy ends. Statements and receipts remain the office's records and can be requested at any time.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        "You may ask to see the information held about you, have anything wrong corrected, ask for deletion of what is no longer needed, object to how it is used, or ask for a copy in a portable form.",
        "You may withdraw consent at any time by writing to the office. Withdrawing it does not undo what was done while it was in force, and the office may still keep what the law requires it to keep.",
        "If you are not satisfied with how your information has been handled, you may complain to the Office of the Data Protection Commissioner.",
      ],
    },
  ];
}

export function consentStatement(org: ConsentOrg): string {
  const name = org.letterheadName || org.name;
  return `I have read the notice above and I agree to ${name} collecting and using my personal information for the purposes described in it.`;
}
