import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { ActivityPage } from '@pocketverse/shared';
import type { JwtHelpers } from '../../lib/jwt.js';
import { requireAuth } from '../../middleware/auth.js';

const PAGE_SIZE = 20;

/** The user-visible activity log: everything the audit trail recorded. */
export function createActivityRouter(prisma: PrismaClient, jwt: JwtHelpers): Router {
  const router = Router();
  router.use(requireAuth(jwt));

  router.get('/', async (req, res) => {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const events = await prisma.auditEvent.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = events.length > PAGE_SIZE;
    const page = hasMore ? events.slice(0, PAGE_SIZE) : events;
    const body: ActivityPage = {
      events: page.map((event) => ({
        id: event.id,
        type: event.type,
        metadata: (event.metadata as Record<string, unknown> | null) ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
    res.json(body);
  });

  return router;
}

/** Aggregate storage numbers for the header chip. */
export function createStatsRouter(prisma: PrismaClient, jwt: JwtHelpers): Router {
  const router = Router();
  router.use(requireAuth(jwt));

  router.get('/', async (req, res) => {
    const userId = req.user!.id;
    const [aggregate, folders, syncingCount] = await Promise.all([
      prisma.file.aggregate({ where: { ownerId: userId }, _count: true, _sum: { size: true } }),
      prisma.folder.count({ where: { ownerId: userId } }),
      prisma.file.count({ where: { ownerId: userId, status: 'UPLOADING' } }),
    ]);
    res.json({
      files: aggregate._count,
      folders,
      totalBytes: Number(aggregate._sum.size ?? 0n),
      syncingCount,
    });
  });

  return router;
}
