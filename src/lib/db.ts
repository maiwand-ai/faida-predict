import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Query logging aids dev-server debugging (dev.log); CLI probes (smokes,
    // fixtures recorders) set PRISMA_QUIET=1 to keep their output readable.
    log: process.env.PRISMA_QUIET === "1" ? [] : ["query"],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db