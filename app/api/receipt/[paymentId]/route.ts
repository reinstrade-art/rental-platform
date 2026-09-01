import { NextResponse } from "next/server";
import { allowPaymentDoc } from "@/app/lib/auth";
import { buildReceiptPdfForPayment } from "@/app/lib/receipt";

export async function GET(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const s = await allowPaymentDoc(paymentId);
  if (!s) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { pdf, payment } = await buildReceiptPdfForPayment(paymentId);

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${payment.id.slice(-8)}.pdf"`,
    },
  });
}
