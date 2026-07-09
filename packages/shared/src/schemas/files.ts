import { z } from 'zod';

/** File/folder names: visible characters only, no path separators. */
export const entryNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(255, 'Use at most 255 characters')
  .refine(
    (name) => !/[/\\\u0000-\u001f]/.test(name),
    'Names cannot contain / \\ or control characters',
  )
  .refine((name) => name !== '.' && name !== '..', 'That name is reserved');

export const createUploadSchema = z.object({
  name: entryNameSchema,
  size: z
    .number()
    .int()
    .min(1, 'Empty files cannot be stored')
    .max(4 * 1024 ** 4, 'Files over 4TB are not supported'),
  mimeType: z.string().trim().min(1).max(255).default('application/octet-stream'),
  folderId: z.string().nullish(),
});

export const updateFileSchema = z
  .object({
    name: entryNameSchema.optional(),
    // null = move to the root
    folderId: z.string().nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.folderId !== undefined,
    'Provide a new name or a destination folder',
  );

export const createFolderSchema = z.object({
  name: entryNameSchema,
  parentId: z.string().nullish(),
});

export const updateFolderSchema = z
  .object({
    name: entryNameSchema.optional(),
    parentId: z.string().nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.parentId !== undefined,
    'Provide a new name or a destination folder',
  );

export const fileStatusValues = ['uploading', 'ready', 'error'] as const;

export const fileDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  mimeType: z.string(),
  status: z.enum(fileStatusValues),
  checksum: z.string().nullable(),
  folderId: z.string().nullable(),
  /** 0-100 while syncing to storage; null once ready/failed or when unknown. */
  syncProgress: z.number().min(0).max(100).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const folderDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const breadcrumbSchema = z.array(z.object({ id: z.string(), name: z.string() }));

export const driveListingSchema = z.object({
  breadcrumb: breadcrumbSchema,
  folders: z.array(folderDtoSchema),
  files: z.array(fileDtoSchema),
});

export const searchResultDtoSchema = fileDtoSchema.extend({
  /** Name of the containing folder, or null when the file sits at the root. */
  folderName: z.string().nullable(),
});

export const uploadSessionDtoSchema = z.object({
  uploadId: z.string(),
  fileId: z.string(),
  partSize: z.number(),
  totalParts: z.number(),
  nextPart: z.number(),
  fileStatus: z.enum(fileStatusValues),
});

export type CreateUploadInput = z.infer<typeof createUploadSchema>;
export type UpdateFileInput = z.infer<typeof updateFileSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type FileDto = z.infer<typeof fileDtoSchema>;
export type SearchResultDto = z.infer<typeof searchResultDtoSchema>;
export type FolderDto = z.infer<typeof folderDtoSchema>;
export type DriveListing = z.infer<typeof driveListingSchema>;
export type UploadSessionDto = z.infer<typeof uploadSessionDtoSchema>;
export type FileStatusValue = (typeof fileStatusValues)[number];
