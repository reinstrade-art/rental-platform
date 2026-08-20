import "server-only";
import { put, get, del } from "@vercel/blob";
import { prisma } from "./prisma";

const MAX_SIZE = 15 * 1024 * 1024; // 15MB
const MAX_FILES = 5;

// Images, PDFs, and the common office document formats — "various types of
// documents" per the request, deliberately excluding anything executable
// (.exe, .sh, .js, ...) a message thread has no legitimate reason to carry.
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

export type AttachmentUploadError = { file: string; reason: string };

/** Validates and uploads every file in a FormData's `attachments` field, creating MessageAttachment rows for a Message that already exists. */
export async function attachFilesToMessage(
  organizationId: string,
  messageId: string,
  formData: FormData,
): Promise<AttachmentUploadError[]> {
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return [];

  const errors: AttachmentUploadError[] = [];
  const toUpload = files.slice(0, MAX_FILES);
  if (files.length > MAX_FILES) errors.push({ file: "", reason: `Only the first ${MAX_FILES} files were attached.` });

  for (const file of toUpload) {
    if (file.size > MAX_SIZE) {
      errors.push({ file: file.name, reason: "Larger than 15MB — not attached." });
      continue;
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      errors.push({ file: file.name, reason: "That file type isn't supported — not attached." });
      continue;
    }

    const blob = await put(`messages/${organizationId}/${messageId}/${Date.now()}-${file.name}`, file, {
      access: "private",
      addRandomSuffix: true,
    });

    await prisma.messageAttachment.create({
      data: {
        organizationId,
        messageId,
        pathname: blob.pathname,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      },
    });
  }

  return errors;
}

/** Fetches an attachment's content for the authenticated proxy route — see app/api/attachments/[id]. */
export async function readAttachment(pathname: string) {
  return get(pathname, { access: "private" });
}

export async function deleteAttachmentBlob(pathname: string) {
  await del(pathname).catch(() => {});
}
