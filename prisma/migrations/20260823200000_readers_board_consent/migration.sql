-- Permission for a child to appear on the readers' board.
--
-- Additive only: a new value on an existing enum. No row is changed, so every
-- child starts with no such consent on record and therefore does not appear.
-- That default is the whole safety property -- a board that fills up because a
-- migration ran would be exactly the wrong outcome.
ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'READERS_BOARD';
