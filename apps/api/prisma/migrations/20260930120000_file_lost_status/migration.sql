-- A file whose data was deleted inside the user's storage after a successful
-- upload. Distinct from ERROR (the upload itself failed): different copy,
-- badge, and recovery path. See files.service `markFileLost`.
ALTER TYPE "FileStatus" ADD VALUE 'LOST';
