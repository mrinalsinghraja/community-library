-- ===========================================================================
-- Version 1 — permanent deletion becomes a permission of its own.
--
-- Until now the only way to remove a record was `book.delete`, and there was no
-- way at all to remove an account. Closing an account (`member.deactivate`) and
-- erasing one are different acts: the first keeps the record and the history,
-- the second removes the row. Reaching both through one grant would mean a
-- future edit to a role could hand out the second while intending the first.
--
-- So `user.delete` is its own key, granted to SUPER_ADMIN and to nobody else.
-- It permits an *attempt*. The services behind it refuse any account that has
-- borrowed a book, asked for one, been photographed, signed in, or acted at the
-- desk, and they refuse the last active Super Admin outright. Every deletion
-- that does go ahead writes an audit row inside the same transaction, so the
-- library keeps a record of the account it no longer has.
--
-- This migration adds one permission row and one grant. It deletes nothing,
-- alters no table and changes no existing behaviour.
-- ===========================================================================

INSERT INTO "permission" ("key", "category", "description")
VALUES (
  'user.delete',
  'administration',
  'Permanently delete an account that has no library history'
)
ON CONFLICT ("key") DO NOTHING;

-- SUPER_ADMIN only. The WHERE clause names the one role deliberately rather
-- than granting by category, so widening this later has to be written down.
INSERT INTO "role_permission" ("role_id", "permission_key")
SELECT r."id", 'user.delete'
  FROM "role" r
 WHERE r."key" = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;
