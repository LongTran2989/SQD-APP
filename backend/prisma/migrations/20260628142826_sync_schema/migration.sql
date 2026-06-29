-- AlterTable
ALTER TABLE "FeedPost" ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "hiddenByUserId" INTEGER,
ADD COLUMN     "hiddenReason" TEXT,
ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "pinnedByUserId" INTEGER;

-- CreateTable
CREATE TABLE "FeedPostAcknowledgement" (
    "id" SERIAL NOT NULL,
    "feedPostId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedPostAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedPostAcknowledgement_feedPostId_idx" ON "FeedPostAcknowledgement"("feedPostId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPostAcknowledgement_feedPostId_userId_key" ON "FeedPostAcknowledgement"("feedPostId", "userId");

-- CreateIndex
CREATE INDEX "FeedPost_scope_scopeId_pinnedAt_idx" ON "FeedPost"("scope", "scopeId", "pinnedAt");

-- AddForeignKey
ALTER TABLE "FeedPostAcknowledgement" ADD CONSTRAINT "FeedPostAcknowledgement_feedPostId_fkey" FOREIGN KEY ("feedPostId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostAcknowledgement" ADD CONSTRAINT "FeedPostAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
