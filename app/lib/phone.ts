/**
 * Kenyan mobile numbers, normalised to the 2547XXXXXXXX form Safaricom's
 * STK Push API expects.
 *
 * They arrive written every way an office or tenant happens to type them —
 * 0722…, 722…, +254 722…, 254722… — and getting this wrong sends the prompt
 * to the wrong handset (or nowhere), so anything not recognisably a number
 * returns null and the caller refuses rather than guessing.
 */
export function mpesaNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("254") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 10) return `254${d.slice(1)}`;
  if (d.length === 9 && /^[71]/.test(d)) return `254${d}`;
  return null;
}

/** A plain wa.me deep link — no Meta-approved template needed since a person clicks send, this app never pushes a message on its own. Null when the number can't be normalised. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const number = mpesaNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
