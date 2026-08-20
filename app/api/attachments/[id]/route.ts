import { NextRequest, NextResponse } from "next/server";
import { getSession, requireTenantsAccess, requireTenant, isCaretaker } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { readAttachment } from "@/app/lib/attachments";

/**
 * The only way an attachment's bytes ever leave Blob storage — the blob
 * itself is private (unreadable by URL alone), and this route re-derives
 * whether the current session actually belongs to this attachment's thread
 * before streaming anything back, the same authorization this app already
 * applies to the thread itself rather than trusting the file's own
 * obscurity.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const attachment = await prisma.messageAttachment.findUnique({
    where: { id },
    include: {
      message: {
        include: { tenant: { select: { propertyId: true, leases: { select: { unit: { select: { propertyId: true } } } } } } },
      },
    },
  });
  if (!attachment) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const sameOrg = attachment.organizationId === s.organizationId;
  let allowed = false;
  if (requireTenant(s)) {
    allowed = sameOrg && attachment.message.tenantId === s.tenantId;
  } else if (requireTenantsAccess(s)) {
    // A caretaker only reaches a TENANT-role thread already scoped to their
    // property elsewhere in the app — mirrored here rather than trusted,
    // since this route has no page-level gate of its own to inherit it from.
    // Matches getTenant()'s own scoping OR in app/lib/data.ts exactly.
    if (isCaretaker(s.role) && s.propertyId) {
      const tenant = attachment.message.tenant;
      const inScope = tenant.propertyId === s.propertyId || tenant.leases.some((l) => l.unit.propertyId === s.propertyId);
      allowed = sameOrg && inScope;
    } else {
      allowed = sameOrg;
    }
  }
  if (!allowed) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const blob = await readAttachment(attachment.pathname);
  if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: "File not found." }, { status: 404 });

  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
      "Content-Length": String(attachment.size),
    },
  });
}
