import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// Prisma 7 connects through a driver adapter. The same libsql adapter serves
// both worlds: a local SQLite file in development, and a hosted Turso database
// in production (libsql://… plus an auth token). No schema change either way.
const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// Reuse a single client across hot-reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
