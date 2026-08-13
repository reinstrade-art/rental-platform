-- AlterTable
ALTER TABLE "Lease" ADD COLUMN "signatureImage" TEXT;
ALTER TABLE "Lease" ADD COLUMN "signedAt" DATETIME;
ALTER TABLE "Lease" ADD COLUMN "signedByName" TEXT;
ALTER TABLE "Lease" ADD COLUMN "signedIp" TEXT;
ALTER TABLE "Lease" ADD COLUMN "signedUserAgent" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "leaseTermsTemplate" TEXT;

