import { NextRequest, NextResponse } from "next/server";
import { getSession, requireStaff, canViewTenantPII } from "@/app/lib/auth";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { prisma } from "@/app/lib/prisma";
import { getReportData } from "@/app/lib/reports";
import { buildReportPdf } from "@/app/lib/report-doc";
import { maskReportData } from "@/app/lib/tenant-privacy";

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!requireStaff(s)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  if (!hasFeature(await getOrgTier(s.organizationId), "REPORTS")) {
    return NextResponse.json({ error: "Not included in your plan." }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const period = sp.get("period") ?? "";
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const through = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const propertyId = sp.get("property") || undefined;

  if (propertyId) {
    const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  const [org, rawData] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } }),
    getReportData(s.organizationId, year, through, propertyId),
  ]);
  const data = maskReportData(rawData, canViewTenantPII(s.role));

  const pdf = await buildReportPdf(org, data);

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="report-${year}-${String(through + 1).padStart(2, "0")}.pdf"`,
    },
  });
}
