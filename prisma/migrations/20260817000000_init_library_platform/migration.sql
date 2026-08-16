-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('STAFF', 'MEMBER', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('CHILD_ACCOUNT_CREATION', 'CHILD_PHOTO_STORAGE', 'GUARDIAN_EMAIL_NOTIFICATIONS');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('GUARDIAN_ONLINE_FORM', 'LIBRARIAN_RECORDED_IN_PERSON');

-- CreateEnum
CREATE TYPE "CatalogueVisibility" AS ENUM ('MEMBER_ONLY', 'PUBLIC');

-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'BORROWED', 'RESERVED', 'LOST', 'DAMAGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CopyCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'WORN');

-- CreateEnum
CREATE TYPE "AcquisitionType" AS ENUM ('RESIDENT_DONATION', 'PURCHASE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "DonorDisplayConsent" AS ENUM ('NAMED', 'APARTMENT_ONLY', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'RETURNED', 'LOST', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "LoanEventType" AS ENUM ('ISSUE', 'RENEW', 'RETURN', 'MARK_LOST', 'MARK_DAMAGED', 'ADJUST_DUE');

-- CreateEnum
CREATE TYPE "RenewalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('ACTIVATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'MEMBERS', 'STAFF');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateTable
CREATE TABLE "community" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address_line" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_settings" (
    "library_id" TEXT NOT NULL,
    "age_min" INTEGER NOT NULL DEFAULT 5,
    "age_max" INTEGER NOT NULL DEFAULT 14,
    "borrowing_period_days" INTEGER NOT NULL DEFAULT 14,
    "max_active_loans" INTEGER NOT NULL DEFAULT 2,
    "max_renewals" INTEGER NOT NULL DEFAULT 1,
    "renewal_period_days" INTEGER NOT NULL DEFAULT 7,
    "renewal_blocked_when_reserved" BOOLEAN NOT NULL DEFAULT true,
    "block_on_overdue_days" INTEGER NOT NULL DEFAULT 7,
    "overdue_reminder_offsets" INTEGER[] DEFAULT ARRAY[-2, 0, 3, 7]::INTEGER[],
    "copy_code_prefix" TEXT NOT NULL DEFAULT 'LIB',
    "copy_code_padding" INTEGER NOT NULL DEFAULT 4,
    "member_code_prefix" TEXT NOT NULL DEFAULT 'LIB-R',
    "member_code_padding" INTEGER NOT NULL DEFAULT 4,
    "catalogue_visibility" "CatalogueVisibility" NOT NULL DEFAULT 'MEMBER_ONLY',
    "donor_display_default" "DonorDisplayConsent" NOT NULL DEFAULT 'NAMED',
    "logo_url" TEXT,
    "favicon_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#1F6F5C',
    "secondary_color" TEXT NOT NULL DEFAULT '#E4572E',
    "welcome_message" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "rules_markdown" TEXT,
    "donation_policy_markdown" TEXT,
    "consent_version" TEXT NOT NULL DEFAULT '2026-08-v1',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "date_format" TEXT NOT NULL DEFAULT 'd MMM yyyy',
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "overdue_reminders_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by_id" TEXT,

    CONSTRAINT "library_settings_pkey" PRIMARY KEY ("library_id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "kind" "UserKind" NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "must_set_password" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" TEXT,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" TEXT NOT NULL,
    "library_id" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "is_assignable" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "user_role" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "granted_by_id" TEXT,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "member_profile" (
    "user_id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "member_code" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "apartment" TEXT NOT NULL,
    "avatar_key" TEXT,
    "photo_media_id" TEXT,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staff_notes" TEXT,

    CONSTRAINT "member_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "guardian" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "apartment" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_member" (
    "guardian_id" TEXT NOT NULL,
    "member_user_id" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'guardian',
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_member_pkey" PRIMARY KEY ("guardian_id","member_user_id")
);

-- CreateTable
CREATE TABLE "registration_request" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "child_name" TEXT NOT NULL,
    "child_dob" DATE NOT NULL,
    "apartment" TEXT NOT NULL,
    "guardian_name" TEXT NOT NULL,
    "guardian_email" TEXT NOT NULL,
    "guardian_phone" TEXT NOT NULL,
    "avatar_key" TEXT,
    "photo_media_id" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by_id" TEXT,
    "review_note" TEXT,
    "created_member_user_id" TEXT,
    "submitted_ip_hash" TEXT,

    CONSTRAINT "registration_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_record" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "method" "ConsentMethod" NOT NULL DEFAULT 'GUARDIAN_ONLINE_FORM',
    "consent_version" TEXT NOT NULL,
    "consent_text_snapshot" TEXT NOT NULL,
    "guardian_id" TEXT,
    "member_user_id" TEXT,
    "registration_request_id" TEXT,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ(6),
    "recorded_by_id" TEXT,
    "ip_hash" TEXT,
    "user_agent_hash" TEXT,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_category" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "book_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_title" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[],
    "publisher" TEXT,
    "isbn13" TEXT,
    "isbn10" TEXT,
    "language" TEXT NOT NULL DEFAULT 'English',
    "description" TEXT,
    "age_min" INTEGER,
    "age_max" INTEGER,
    "category_id" TEXT,
    "cover_media_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by_id" TEXT,

    CONSTRAINT "book_title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_copy" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "title_id" TEXT NOT NULL,
    "copy_code" TEXT NOT NULL,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "CopyCondition" NOT NULL DEFAULT 'GOOD',
    "acquisition_type" "AcquisitionType" NOT NULL DEFAULT 'RESIDENT_DONATION',
    "shelf_location" TEXT,
    "acquired_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "book_copy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "copy_id" TEXT NOT NULL,
    "donor_name" TEXT NOT NULL,
    "donor_apartment" TEXT,
    "donor_user_id" TEXT,
    "display_consent" "DonorDisplayConsent" NOT NULL DEFAULT 'NAMED',
    "donated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "copy_id" TEXT NOT NULL,
    "member_user_id" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_id" TEXT,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "returned_at" TIMESTAMPTZ(6),
    "returned_by_id" TEXT,
    "renewal_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_event" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "type" "LoanEventType" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" TEXT,
    "previous_due_at" TIMESTAMPTZ(6),
    "new_due_at" TIMESTAMPTZ(6),
    "note" TEXT,

    CONSTRAINT "loan_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_request" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "status" "RenewalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,

    CONSTRAINT "renewal_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_sequence" (
    "library_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "code_sequence_pkey" PRIMARY KEY ("library_id","kind")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent_hash" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_token" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "auth_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt" (
    "id" TEXT NOT NULL,
    "library_id" TEXT,
    "identifier_hash" TEXT NOT NULL,
    "ip_hash" TEXT,
    "succeeded" BOOLEAN NOT NULL,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip_hash" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
    "published_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_event" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "error" TEXT,
    "related_entity_type" TEXT,
    "related_entity_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "email_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_object" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "visibility" "MediaVisibility" NOT NULL DEFAULT 'PRIVATE',
    "storage_key" TEXT NOT NULL,
    "public_url" TEXT,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum_sha256" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_object_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_slug_key" ON "community"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "library_slug_key" ON "library"("slug");

-- CreateIndex
CREATE INDEX "library_community_id_idx" ON "library"("community_id");

-- CreateIndex
CREATE INDEX "app_user_library_id_kind_status_idx" ON "app_user"("library_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_library_email_key" ON "app_user"("library_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_library_username_key" ON "app_user"("library_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "role_library_key_key" ON "role"("library_id", "key");

-- CreateIndex
CREATE INDEX "user_role_role_id_idx" ON "user_role"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_profile_photo_media_id_key" ON "member_profile"("photo_media_id");

-- CreateIndex
CREATE INDEX "member_profile_library_id_apartment_idx" ON "member_profile"("library_id", "apartment");

-- CreateIndex
CREATE UNIQUE INDEX "member_profile_library_code_key" ON "member_profile"("library_id", "member_code");

-- CreateIndex
CREATE INDEX "guardian_library_id_apartment_idx" ON "guardian"("library_id", "apartment");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_library_email_key" ON "guardian"("library_id", "email");

-- CreateIndex
CREATE INDEX "guardian_member_member_user_id_idx" ON "guardian_member"("member_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_request_created_member_user_id_key" ON "registration_request"("created_member_user_id");

-- CreateIndex
CREATE INDEX "registration_request_library_id_status_submitted_at_idx" ON "registration_request"("library_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "consent_record_library_id_type_status_idx" ON "consent_record"("library_id", "type", "status");

-- CreateIndex
CREATE INDEX "consent_record_member_user_id_idx" ON "consent_record"("member_user_id");

-- CreateIndex
CREATE INDEX "consent_record_guardian_id_idx" ON "consent_record"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_category_library_slug_key" ON "book_category"("library_id", "slug");

-- CreateIndex
CREATE INDEX "book_title_library_id_category_id_idx" ON "book_title"("library_id", "category_id");

-- CreateIndex
CREATE INDEX "book_title_library_id_isbn13_idx" ON "book_title"("library_id", "isbn13");

-- CreateIndex
CREATE INDEX "book_copy_library_id_status_idx" ON "book_copy"("library_id", "status");

-- CreateIndex
CREATE INDEX "book_copy_title_id_idx" ON "book_copy"("title_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_copy_library_code_key" ON "book_copy"("library_id", "copy_code");

-- CreateIndex
CREATE UNIQUE INDEX "donation_copy_id_key" ON "donation"("copy_id");

-- CreateIndex
CREATE INDEX "donation_library_id_donated_at_idx" ON "donation"("library_id", "donated_at");

-- CreateIndex
CREATE INDEX "loan_library_id_status_due_at_idx" ON "loan"("library_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "loan_member_user_id_status_idx" ON "loan"("member_user_id", "status");

-- CreateIndex
CREATE INDEX "loan_copy_id_idx" ON "loan"("copy_id");

-- CreateIndex
CREATE INDEX "loan_event_loan_id_occurred_at_idx" ON "loan_event"("loan_id", "occurred_at");

-- CreateIndex
CREATE INDEX "renewal_request_loan_id_status_idx" ON "renewal_request"("loan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_token_token_hash_key" ON "auth_token"("token_hash");

-- CreateIndex
CREATE INDEX "auth_token_user_id_type_idx" ON "auth_token"("user_id", "type");

-- CreateIndex
CREATE INDEX "auth_token_expires_at_idx" ON "auth_token"("expires_at");

-- CreateIndex
CREATE INDEX "login_attempt_identifier_hash_attempted_at_idx" ON "login_attempt"("identifier_hash", "attempted_at");

-- CreateIndex
CREATE INDEX "login_attempt_ip_hash_attempted_at_idx" ON "login_attempt"("ip_hash", "attempted_at");

-- CreateIndex
CREATE INDEX "audit_log_library_id_occurred_at_idx" ON "audit_log"("library_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_library_id_entity_type_entity_id_idx" ON "audit_log"("library_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- CreateIndex
CREATE INDEX "announcement_library_id_audience_published_at_idx" ON "announcement"("library_id", "audience", "published_at");

-- CreateIndex
CREATE INDEX "email_event_library_id_created_at_idx" ON "email_event"("library_id", "created_at");

-- CreateIndex
CREATE INDEX "email_event_related_entity_type_related_entity_id_idx" ON "email_event"("related_entity_type", "related_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_object_storage_key_key" ON "media_object"("storage_key");

-- CreateIndex
CREATE INDEX "media_object_library_id_purpose_idx" ON "media_object"("library_id", "purpose");

-- AddForeignKey
ALTER TABLE "library" ADD CONSTRAINT "library_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_settings" ADD CONSTRAINT "library_settings_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profile" ADD CONSTRAINT "member_profile_photo_media_id_fkey" FOREIGN KEY ("photo_media_id") REFERENCES "media_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_member" ADD CONSTRAINT "guardian_member_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_member" ADD CONSTRAINT "guardian_member_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_request" ADD CONSTRAINT "registration_request_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_request" ADD CONSTRAINT "registration_request_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_request" ADD CONSTRAINT "registration_request_photo_media_id_fkey" FOREIGN KEY ("photo_media_id") REFERENCES "media_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_registration_request_id_fkey" FOREIGN KEY ("registration_request_id") REFERENCES "registration_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_category" ADD CONSTRAINT "book_category_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_title" ADD CONSTRAINT "book_title_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_title" ADD CONSTRAINT "book_title_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "book_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_title" ADD CONSTRAINT "book_title_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media_object"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copy" ADD CONSTRAINT "book_copy_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copy" ADD CONSTRAINT "book_copy_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "book_title"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation" ADD CONSTRAINT "donation_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation" ADD CONSTRAINT "donation_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "book_copy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation" ADD CONSTRAINT "donation_donor_user_id_fkey" FOREIGN KEY ("donor_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donation" ADD CONSTRAINT "donation_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "book_copy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_returned_by_id_fkey" FOREIGN KEY ("returned_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_request" ADD CONSTRAINT "renewal_request_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_request" ADD CONSTRAINT "renewal_request_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_request" ADD CONSTRAINT "renewal_request_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_sequence" ADD CONSTRAINT "code_sequence_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_event" ADD CONSTRAINT "email_event_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_object" ADD CONSTRAINT "media_object_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_object" ADD CONSTRAINT "media_object_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- ===========================================================================
-- Hand-written guarantees that Prisma's schema language cannot express.
-- These are the database's own defences: they hold even if application code
-- is wrong, raced, or bypassed entirely.
-- ===========================================================================

-- Fuzzy title search for readers who are still learning to spell.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. A physical copy can be on loan to exactly one reader at a time.
--    This is the final line of defence against a double issue; disabling a
--    button in the browser is not a guarantee of anything.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX one_active_loan_per_copy
  ON loan (copy_id)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 2. The same child in the same flat cannot sit in the queue twice.
--    Case- and whitespace-insensitive so "Aarav " and "aarav" collide.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX one_open_registration_per_child
  ON registration_request (library_id, lower(btrim(child_name)), lower(btrim(apartment)))
  WHERE status IN ('PENDING', 'UNDER_REVIEW');

-- ---------------------------------------------------------------------------
-- 3. Login identifiers are stored normalised, so uniqueness cannot be defeated
--    by changing case. The service layer lowercases; the database insists.
-- ---------------------------------------------------------------------------
ALTER TABLE app_user
  ADD CONSTRAINT app_user_email_is_normalised
    CHECK (email IS NULL OR email = lower(btrim(email))),
  ADD CONSTRAINT app_user_username_is_normalised
    CHECK (username IS NULL OR username = lower(btrim(username))),
  ADD CONSTRAINT app_user_username_shape
    CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9-]{2,19}$'),
  ADD CONSTRAINT app_user_failed_login_count_non_negative
    CHECK (failed_login_count >= 0);

ALTER TABLE guardian
  ADD CONSTRAINT guardian_email_is_normalised
    CHECK (email = lower(btrim(email)));

-- ---------------------------------------------------------------------------
-- 4. Loans must be coherent in time.
-- ---------------------------------------------------------------------------
ALTER TABLE loan
  ADD CONSTRAINT loan_due_after_issue
    CHECK (due_at > issued_at),
  ADD CONSTRAINT loan_returned_after_issue
    CHECK (returned_at IS NULL OR returned_at >= issued_at),
  ADD CONSTRAINT loan_renewal_count_non_negative
    CHECK (renewal_count >= 0),
  -- A RETURNED loan must record when; an ACTIVE loan must not.
  ADD CONSTRAINT loan_return_fields_match_status
    CHECK (
      (status = 'RETURNED' AND returned_at IS NOT NULL)
      OR (status = 'ACTIVE' AND returned_at IS NULL)
      OR status IN ('LOST', 'WRITTEN_OFF')
    );

-- ---------------------------------------------------------------------------
-- 5. Configuration cannot be saved in a state that breaks the library.
--    Every one of these is a rule an admin could otherwise typo into chaos.
-- ---------------------------------------------------------------------------
ALTER TABLE library_settings
  ADD CONSTRAINT library_settings_sane_age_range
    CHECK (age_min >= 0 AND age_max > age_min AND age_max <= 25),
  ADD CONSTRAINT library_settings_positive_borrowing_period
    CHECK (borrowing_period_days BETWEEN 1 AND 365),
  ADD CONSTRAINT library_settings_positive_renewal_period
    CHECK (renewal_period_days BETWEEN 1 AND 365),
  ADD CONSTRAINT library_settings_sane_limits
    CHECK (max_active_loans BETWEEN 1 AND 50 AND max_renewals BETWEEN 0 AND 20),
  ADD CONSTRAINT library_settings_non_negative_overdue_block
    CHECK (block_on_overdue_days >= 0),
  ADD CONSTRAINT library_settings_code_padding
    CHECK (copy_code_padding BETWEEN 1 AND 10 AND member_code_padding BETWEEN 1 AND 10),
  ADD CONSTRAINT library_settings_prefixes_present
    CHECK (btrim(copy_code_prefix) <> '' AND btrim(member_code_prefix) <> ''),
  -- Branding colours must be real hex so a bad value cannot break every page.
  ADD CONSTRAINT library_settings_colour_format
    CHECK (primary_color ~* '^#[0-9a-f]{6}$' AND secondary_color ~* '^#[0-9a-f]{6}$');

-- ---------------------------------------------------------------------------
-- 6. Consent is evidence. A withdrawal must say when it happened, and a grant
--    must always carry the wording that was actually shown.
-- ---------------------------------------------------------------------------
ALTER TABLE consent_record
  ADD CONSTRAINT consent_withdrawal_has_timestamp
    CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
  ADD CONSTRAINT consent_text_snapshot_present
    CHECK (btrim(consent_text_snapshot) <> '' AND btrim(consent_version) <> ''),
  -- Consent must attach to something it is consent *for*.
  ADD CONSTRAINT consent_has_subject
    CHECK (member_user_id IS NOT NULL OR registration_request_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 7. A named donor credit must actually have a name to show.
-- ---------------------------------------------------------------------------
ALTER TABLE donation
  ADD CONSTRAINT donation_named_credit_has_name
    CHECK (display_consent <> 'NAMED' OR btrim(donor_name) <> ''),
  ADD CONSTRAINT donation_apartment_credit_has_apartment
    CHECK (display_consent <> 'APARTMENT_ONLY' OR btrim(coalesce(donor_apartment, '')) <> '');

-- ---------------------------------------------------------------------------
-- 8. Members are people with plausible birthdays and real card codes.
-- ---------------------------------------------------------------------------
ALTER TABLE member_profile
  ADD CONSTRAINT member_dob_in_past
    CHECK (date_of_birth < CURRENT_DATE),
  ADD CONSTRAINT member_code_present
    CHECK (btrim(member_code) <> '');

ALTER TABLE registration_request
  ADD CONSTRAINT registration_child_dob_in_past
    CHECK (child_dob < CURRENT_DATE);

-- ---------------------------------------------------------------------------
-- 9. Sessions cannot be created already dead, and idle expiry can never
--    outlive absolute expiry.
-- ---------------------------------------------------------------------------
ALTER TABLE "session"
  ADD CONSTRAINT session_idle_within_absolute
    CHECK (idle_expires_at <= expires_at),
  ADD CONSTRAINT session_expires_after_creation
    CHECK (expires_at > created_at);

ALTER TABLE auth_token
  ADD CONSTRAINT auth_token_expires_after_creation
    CHECK (expires_at > created_at);

-- ---------------------------------------------------------------------------
-- 10. Uploaded objects: private things must not carry a public URL.
-- ---------------------------------------------------------------------------
ALTER TABLE media_object
  ADD CONSTRAINT media_private_has_no_public_url
    CHECK (visibility <> 'PRIVATE' OR public_url IS NULL),
  ADD CONSTRAINT media_public_has_public_url
    CHECK (visibility <> 'PUBLIC' OR public_url IS NOT NULL),
  ADD CONSTRAINT media_byte_size_positive
    CHECK (byte_size > 0);

-- ---------------------------------------------------------------------------
-- 11. Search indexes. Full text for real queries, trigram for misspellings.
-- ---------------------------------------------------------------------------
-- array_to_string() is only STABLE, so it cannot appear directly in an index
-- expression. Wrapping it in a function we declare IMMUTABLE is the standard
-- workaround: with a constant separator over text[], the result really is
-- deterministic. Keep this function and the index definition in step.
CREATE OR REPLACE FUNCTION book_title_search_vector(p_title text, p_authors text[])
  RETURNS tsvector
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
  SELECT to_tsvector(
    'simple',
    coalesce(p_title, '') || ' ' || coalesce(array_to_string(p_authors, ' '), '')
  );
$$;

CREATE INDEX book_title_fulltext_idx
  ON book_title
  USING gin (book_title_search_vector(title, authors));

-- NOTE: this is deliberately an *expression* index on lower(title), not a plain
-- column index. `prisma migrate dev` drops raw indexes it can introspect but
-- does not find in schema.prisma; expression indexes are invisible to it and
-- therefore survive. Query it as: WHERE lower(title) % lower($1).
CREATE INDEX book_title_trgm_idx
  ON book_title
  USING gin (lower(title) gin_trgm_ops);

-- Case-insensitive lookup of a member by card code, used on every issue.
CREATE INDEX member_profile_code_lower_idx
  ON member_profile (library_id, lower(member_code));

CREATE INDEX book_copy_code_lower_idx
  ON book_copy (library_id, lower(copy_code));
