ALTER TABLE "Message"
ADD COLUMN "gifProvider" VARCHAR(20),
ADD COLUMN "gifExternalId" VARCHAR(100),
ADD COLUMN "gifUrl" VARCHAR(2048),
ADD COLUMN "gifTitle" VARCHAR(180),
ADD COLUMN "gifAltText" VARCHAR(500),
ADD COLUMN "gifUsername" VARCHAR(100),
ADD COLUMN "gifPageUrl" VARCHAR(2048);

CREATE INDEX "Message_gifProvider_gifExternalId_idx"
ON "Message"("gifProvider", "gifExternalId");
