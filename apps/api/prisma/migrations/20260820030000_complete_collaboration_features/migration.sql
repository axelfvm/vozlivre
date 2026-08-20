ALTER TABLE "User"
ADD COLUMN "bio" VARCHAR(190) NOT NULL DEFAULT '',
ADD COLUMN "status" VARCHAR(80) NOT NULL DEFAULT '',
ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "Channel"
ADD COLUMN "topic" VARCHAR(1024) NOT NULL DEFAULT '';

ALTER TABLE "SpaceInvite"
ADD COLUMN "maxUses" INTEGER,
ADD COLUMN "revokedAt" TIMESTAMP(3);

ALTER TABLE "Message"
ADD COLUMN "pinnedAt" TIMESTAMP(3);

CREATE TABLE "MessageAttachment" (
  "id" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "messageId" TEXT,
  "originalName" VARCHAR(255) NOT NULL,
  "storedName" TEXT NOT NULL,
  "mimeType" VARCHAR(120) NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelReadState" (
  "userId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChannelReadState_pkey" PRIMARY KEY ("userId", "channelId")
);

CREATE UNIQUE INDEX "MessageAttachment_storedName_key" ON "MessageAttachment"("storedName");
CREATE INDEX "MessageAttachment_uploaderId_createdAt_idx" ON "MessageAttachment"("uploaderId", "createdAt");
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");
CREATE INDEX "ChannelReadState_channelId_lastReadAt_idx" ON "ChannelReadState"("channelId", "lastReadAt");

ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_uploaderId_fkey"
FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelReadState" ADD CONSTRAINT "ChannelReadState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelReadState" ADD CONSTRAINT "ChannelReadState_channelId_fkey"
FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
