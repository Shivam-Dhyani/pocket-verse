-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING_CODE', 'PENDING_PASSWORD', 'CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "StorageConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL,
    "phoneMasked" TEXT NOT NULL,
    "wrappedDataKey" TEXT NOT NULL,
    "encryptedSession" TEXT,
    "encryptedPending" TEXT,
    "pendingExpiresAt" TIMESTAMP(3),
    "channelId" TEXT,
    "channelAccessHash" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageConnection_userId_key" ON "StorageConnection"("userId");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "StorageConnection" ADD CONSTRAINT "StorageConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
