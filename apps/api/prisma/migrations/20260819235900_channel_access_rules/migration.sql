-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "isRestricted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChannelMemberAccess" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ChannelMemberAccess_pkey" PRIMARY KEY ("channelId", "userId")
);

-- CreateTable
CREATE TABLE "ChannelRoleAccess" (
    "channelId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ChannelRoleAccess_pkey" PRIMARY KEY ("channelId", "role")
);

-- CreateIndex
CREATE INDEX "ChannelMemberAccess_userId_idx" ON "ChannelMemberAccess"("userId");

-- AddForeignKey
ALTER TABLE "ChannelMemberAccess" ADD CONSTRAINT "ChannelMemberAccess_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMemberAccess" ADD CONSTRAINT "ChannelMemberAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoleAccess" ADD CONSTRAINT "ChannelRoleAccess_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
