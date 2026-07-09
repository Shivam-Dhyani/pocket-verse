import { z } from 'zod';

export const activityEventDtoSchema = z.object({
  id: z.string(),
  type: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});

export const activityPageSchema = z.object({
  events: z.array(activityEventDtoSchema),
  nextCursor: z.string().nullable(),
});

export const statsDtoSchema = z.object({
  files: z.number(),
  folders: z.number(),
  totalBytes: z.number(),
  syncingCount: z.number(),
});

export type ActivityEventDto = z.infer<typeof activityEventDtoSchema>;
export type ActivityPage = z.infer<typeof activityPageSchema>;
export type StatsDto = z.infer<typeof statsDtoSchema>;
