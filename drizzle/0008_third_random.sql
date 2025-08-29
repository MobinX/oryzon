CREATE TYPE "public"."message_status" AS ENUM('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."chat_status" ADD VALUE 'PROCESSING' BEFORE 'CLOSED_BY_BOT';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "status" "message_status" DEFAULT 'PENDING' NOT NULL;