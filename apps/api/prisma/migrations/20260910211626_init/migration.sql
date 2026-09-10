-- Extensions (spec 002 § 4). Enabled in the initial migration so every database,
-- including a freshly created test or CI one, has them from the first apply.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- username search on the leaderboard
CREATE EXTENSION IF NOT EXISTS "citext";    -- reserved; email is lowercased in app code instead

-- CreateEnum
CREATE TYPE "CaretStyle" AS ENUM ('OFF', 'BLOCK', 'UNDERLINE', 'SMOOTH');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "TestMode" AS ENUM ('TIME', 'WORDS', 'QUOTE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "usernameNormalized" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "acceptedTermsAt" TIMESTAMPTZ(3) NOT NULL,
    "passwordChangedAt" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "usernameChangedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "caretStyle" "CaretStyle" NOT NULL DEFAULT 'SMOOTH',
    "soundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "theme" "Theme" NOT NULL DEFAULT 'SYSTEM',
    "defaultDuration" INTEGER NOT NULL DEFAULT 30,
    "defaultMode" "TestMode" NOT NULL DEFAULT 'TIME',
    "language" TEXT NOT NULL DEFAULT 'en',
    "blindMode" BOOLEAN NOT NULL DEFAULT false,
    "stopOnError" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_usernameNormalized_key" ON "User"("usernameNormalized");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
