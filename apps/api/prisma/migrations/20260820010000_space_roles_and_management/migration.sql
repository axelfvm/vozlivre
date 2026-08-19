-- CreateTable
CREATE TABLE "SpaceRole" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#87909f',
    "position" INTEGER NOT NULL DEFAULT 0,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpaceRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipRole" (
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("userId", "spaceId", "roleId")
);

CREATE UNIQUE INDEX "SpaceRole_spaceId_name_key" ON "SpaceRole"("spaceId", "name");
CREATE INDEX "SpaceRole_spaceId_position_idx" ON "SpaceRole"("spaceId", "position");
CREATE INDEX "MembershipRole_roleId_idx" ON "MembershipRole"("roleId");

ALTER TABLE "SpaceRole" ADD CONSTRAINT "SpaceRole_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_userId_spaceId_fkey" FOREIGN KEY ("userId", "spaceId") REFERENCES "Membership"("userId", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "SpaceRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
