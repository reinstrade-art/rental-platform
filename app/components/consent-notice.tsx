import { buildConsentNotice, CONSENT_VERSION, type ConsentOrg } from "@/app/lib/consent";

/**
 * The data protection notice, shown where consent is asked for.
 *
 * Folded shut but present on the page rather than behind a link: consent
 * has to be informed, and a notice on another page nobody opens isn't the
 * same as one that was there to read.
 *
 * On the public registration page the specific organization isn't known
 * until the invite code is redeemed server-side, so this renders with
 * generic placeholder wording ("the office") — the legal substance doesn't
 * change, only the display copy. The actual consent recorded at redemption
 * always carries the real organization's own name.
 */
export function ConsentNotice({ org, open = false }: { org: ConsentOrg; open?: boolean }) {
  const sections = buildConsentNotice(org);
  return (
    <details open={open} className="rounded border bg-silver-light text-left text-sm">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-silver-dark">
        How your information is handled — please read
      </summary>
      <div className="max-h-64 space-y-3 overflow-y-auto border-t px-3 py-3">
        {sections.map((s) => (
          <div key={s.heading}>
            <h3 className="text-xs font-semibold text-ink">{s.heading}</h3>
            {s.body.map((p, i) => (
              <p key={i} className="mt-1 text-xs leading-relaxed text-silver-dark">
                {p}
              </p>
            ))}
          </div>
        ))}
        <p className="border-t pt-2 text-[11px] text-silver-dark">
          Notice version {CONSENT_VERSION}. Issued under the Data Protection Act, 2019 (Kenya).
        </p>
      </div>
    </details>
  );
}
