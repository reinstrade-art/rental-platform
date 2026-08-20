import { NextRequest, NextResponse } from "next/server";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { toCsv, csvResponseHeaders } from "@/app/lib/csv-export";

/** A row per recorded expense — the outgoing side of the ledger (repairs, utilities, management fees, ...). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!requireStaff(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  const expenses = await prisma.expense.findMany({
    where: {
      organizationId: s.organizationId,
      ...(from || to
        ? { paidAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }
        : {}),
    },
    include: { property: true },
    orderBy: { paidAt: "asc" },
  });

  const csv = toCsv(
    ["Date", "Property", "Category", "Description", "Payee", "Amount", "Method", "Reference"],
    expenses.map((e) => [
      e.paidAt.toISOString().slice(0, 10),
      e.property?.name ?? "",
      e.category,
      e.description ?? "",
      e.payee ?? "",
      e.amount,
      e.method ?? "",
      e.reference ?? "",
    ]),
  );

  return new NextResponse(csv, { headers: csvResponseHeaders("expenses.csv") });
}
