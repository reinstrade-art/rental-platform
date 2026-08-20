import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * The one allowlist every message body passes through before it's ever
 * stored — nothing else writes to Message.body, so this is the app's whole
 * defense against a tenant or staff member pasting a script tag or an
 * onclick handler into a rich-text reply. No images, iframes, or styles:
 * the editor's own toolbar never produces them, so allowing them here would
 * only widen what a hand-crafted request could get away with.
 */
export function sanitizeMessageBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "a", "blockquote", "code", "pre"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  }).trim();
}
