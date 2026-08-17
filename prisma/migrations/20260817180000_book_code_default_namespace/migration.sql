-- Book codes get their own namespace, by default and not only by configuration.
--
-- A library card and a book label are different kinds of thing. The card prefix
-- already carried a kind letter ("LIB-R"); the book prefix did not ("LIB"), so
-- the two namespaces were distinct by accident of shape rather than by rule. A
-- community that configures nothing now gets "LIB-B0001" for a book and
-- "LIB-R0001" for a card: same house style, one letter apart, unable to spell
-- each other.
--
-- This changes a column default only. Defaults apply to rows inserted after
-- this point, so no existing library_settings row is altered and no code
-- already printed on a book or a card changes. Deployments that set their own
-- prefix are unaffected.
--
-- The letter remains for humans. Nothing in the application decides what a code
-- refers to by reading its prefix — see docs/IDENTITY.md section 3.

ALTER TABLE "library_settings" ALTER COLUMN "copy_code_prefix" SET DEFAULT 'LIB-B';
