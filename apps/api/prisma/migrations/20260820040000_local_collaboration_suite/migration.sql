CREATE TYPE "SpaceKind" AS ENUM ('COMMUNITY', 'DIRECT', 'GROUP');
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');
CREATE TYPE "MentionKind" AS ENUM ('USER', 'ROLE', 'EVERYONE');

ALTER TABLE "Channel"
ADD COLUMN "categoryId" TEXT,
ADD COLUMN "parentChannelId" TEXT,
ADD COLUMN "starterMessageId" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Membership" ADD COLUMN "timedOutUntil" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "stickerId" TEXT;

ALTER TABLE "Space"
ADD COLUMN "description" VARCHAR(300) NOT NULL DEFAULT '',
ADD COLUMN "dmKey" TEXT,
ADD COLUMN "iconUrl" TEXT,
ADD COLUMN "kind" "SpaceKind" NOT NULL DEFAULT 'COMMUNITY';

ALTER TABLE "User"
ADD COLUMN "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "totpSecret" TEXT;

CREATE TABLE "SpaceCategory" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "name" VARCHAR(50) NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpaceCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageMention" (
  "messageId" TEXT NOT NULL,
  "kind" "MentionKind" NOT NULL,
  "targetId" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "MessageMention_pkey" PRIMARY KEY ("messageId", "kind", "targetId")
);

CREATE TABLE "Friendship" (
  "id" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "addresseeId" TEXT NOT NULL,
  "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserBlock" (
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId")
);

CREATE TABLE "SpaceBan" (
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" VARCHAR(300) NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpaceBan_pkey" PRIMARY KEY ("spaceId", "userId")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" VARCHAR(60) NOT NULL,
  "targetType" VARCHAR(40) NOT NULL,
  "targetId" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SpaceSticker" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "storedName" TEXT NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpaceSticker_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SpaceCategory_spaceId_position_idx" ON "SpaceCategory"("spaceId", "position");
CREATE UNIQUE INDEX "SpaceCategory_spaceId_name_key" ON "SpaceCategory"("spaceId", "name");
CREATE INDEX "MessageMention_kind_targetId_idx" ON "MessageMention"("kind", "targetId");
CREATE INDEX "Friendship_addresseeId_status_idx" ON "Friendship"("addresseeId", "status");
CREATE INDEX "Friendship_requesterId_status_idx" ON "Friendship"("requesterId", "status");
CREATE UNIQUE INDEX "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId");
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");
CREATE INDEX "SpaceBan_userId_idx" ON "SpaceBan"("userId");
CREATE INDEX "AuditLog_spaceId_createdAt_idx" ON "AuditLog"("spaceId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE UNIQUE INDEX "SpaceSticker_storedName_key" ON "SpaceSticker"("storedName");
CREATE INDEX "SpaceSticker_spaceId_createdAt_idx" ON "SpaceSticker"("spaceId", "createdAt");
CREATE UNIQUE INDEX "SpaceSticker_spaceId_name_key" ON "SpaceSticker"("spaceId", "name");
CREATE UNIQUE INDEX "Channel_starterMessageId_key" ON "Channel"("starterMessageId");
CREATE INDEX "Channel_categoryId_position_idx" ON "Channel"("categoryId", "position");
CREATE INDEX "Channel_parentChannelId_createdAt_idx" ON "Channel"("parentChannelId", "createdAt");
CREATE INDEX "Message_stickerId_idx" ON "Message"("stickerId");
CREATE UNIQUE INDEX "Space_dmKey_key" ON "Space"("dmKey");

ALTER TABLE "Channel" ADD CONSTRAINT "Channel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SpaceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_parentChannelId_fkey" FOREIGN KEY ("parentChannelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_starterMessageId_fkey" FOREIGN KEY ("starterMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpaceCategory" ADD CONSTRAINT "SpaceCategory_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_stickerId_fkey" FOREIGN KEY ("stickerId") REFERENCES "SpaceSticker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageMention" ADD CONSTRAINT "MessageMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpaceBan" ADD CONSTRAINT "SpaceBan_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpaceBan" ADD CONSTRAINT "SpaceBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpaceSticker" ADD CONSTRAINT "SpaceSticker_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpaceSticker" ADD CONSTRAINT "SpaceSticker_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
