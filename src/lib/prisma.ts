import { PrismaClient } from '@prisma/client'
import path from 'path'

function getDbUrl(): string {
  // In production use DATABASE_URL env var directly (Railway sets this)
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('./prisma/dev.db')) {
    return process.env.DATABASE_URL
  }
  // In development use absolute path to avoid CWD issues with Next.js
  return `file:${path.resolve(process.cwd(), 'prisma', 'dev.db')}`
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: getDbUrl() } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
