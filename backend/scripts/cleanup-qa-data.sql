-- =====================================================================================
-- TRINIZE — one-off clean-up of test and seed data on the live database
-- (client QA retest, 27 Nov 2026: B-04, S-03, O-02)
--
-- DO NOT RUN WITHOUT A BACKUP. Steps:
--
--   1. Back up:   pg_dump "$DATABASE_URL" -Fc -f trinize-before-cleanup-$(date +%F).dump
--   2. Edit the settings just below. The first dry run lists possible duplicates (B-04) —
--      fill in keep_issue / duplicate_issues from that list and dry-run again.
--   3. Dry run:   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup-qa-data.sql
--                 It prints what it WOULD change and then ROLLS BACK — nothing is saved.
--   4. Read the output. If it is right, change the last line from ROLLBACK to COMMIT and run it again.
--
-- To undo after a COMMIT: pg_restore --clean -d "$DATABASE_URL" trinize-before-cleanup-<date>.dump
-- =====================================================================================

\set society 'Change me: the society name exactly as in the Operator console'
-- B-04: the test issue to delete (0 = none)
\set test_issue 1048
-- B-04: the issue to keep open, and the numbers to close as its duplicates, e.g. '1050,1053' ('' = none)
\set keep_issue 0
\set duplicate_issues ''
-- O-02: also set the subscription's home count to the homes set up in the app (true / false)
\set fix_homes false

BEGIN;

-- the society this runs on (stops here if the name doesn't match exactly one society)
CREATE TEMP TABLE target ON COMMIT DROP AS
  SELECT id, name FROM associations WHERE name = :'society';
DO $$ BEGIN
  IF (SELECT count(*) FROM target) <> 1 THEN
    RAISE EXCEPTION 'Society name matched % societies — fix the \set society line', (SELECT count(*) FROM target);
  END IF;
END $$;
SELECT 'Society' AS step, name FROM target;

-- -------------------------------------------------------------------------------------
-- B-04 (a): the test issue, e.g. ISS-1048. Its timeline, comments, notes, messages and
-- invoices go with it (on delete cascade); site-visit items and other links are unset.
-- -------------------------------------------------------------------------------------
SELECT 'B-04 test issue to delete' AS step, 'ISS-' || i.number AS ref, i.title, i.status, i.created_at
FROM issues i JOIN target t ON t.id = i.association_id
WHERE i.number = :test_issue;

DELETE FROM issues i USING target t
WHERE i.association_id = t.id AND i.number = :test_issue;

-- -------------------------------------------------------------------------------------
-- B-04 (b): duplicates. First, a list to review: open issues sharing a title, category and
-- location (any flat). Nothing is changed by this list.
-- -------------------------------------------------------------------------------------
SELECT 'B-04 possible duplicates (review)' AS step, string_agg('ISS-' || i.number, ', ' ORDER BY i.created_at) AS issues, min(i.title) AS title, min(i.location) AS location
FROM issues i JOIN target t ON t.id = i.association_id
WHERE i.status NOT IN ('Resolved', 'Closed')
GROUP BY lower(trim(i.title)), i.category, lower(trim(i.location))
HAVING count(*) > 1;

-- Then only the numbers you set above are closed: each is resolved as a duplicate of
-- keep_issue, with a note on its timeline the resident sees. Nothing is deleted.
CREATE TEMP TABLE keep ON COMMIT DROP AS
  SELECT i.id, i.number FROM issues i JOIN target t ON t.id = i.association_id WHERE i.number = :keep_issue;
CREATE TEMP TABLE dupes ON COMMIT DROP AS
  SELECT i.id, i.number FROM issues i JOIN target t ON t.id = i.association_id
  WHERE i.number = ANY (coalesce(string_to_array(nullif(:'duplicate_issues', ''), ',')::int[], '{}'))
    AND i.number <> :keep_issue AND i.status NOT IN ('Resolved', 'Closed');
DO $$ BEGIN
  IF (SELECT count(*) FROM dupes) > 0 AND (SELECT count(*) FROM keep) <> 1 THEN
    RAISE EXCEPTION 'keep_issue was not found in this society — fix the \set keep_issue line';
  END IF;
END $$;

SELECT 'B-04 duplicate to resolve' AS step, 'ISS-' || i.number AS ref, i.title, i.location, i.status, 'duplicate of ISS-' || k.number AS keeps
FROM dupes d JOIN issues i ON i.id = d.id CROSS JOIN keep k ORDER BY i.number;

INSERT INTO issue_events (issue_id, status, note)
  SELECT d.id, 'Resolved', 'Closed as a duplicate of ISS-' || k.number || ' — follow that issue for updates.' FROM dupes d CROSS JOIN keep k;
UPDATE issues i SET status = 'Resolved', last_activity_at = now()
FROM dupes d WHERE i.id = d.id;

-- -------------------------------------------------------------------------------------
-- S-03: made-up counts from the demo seed. Event "going" and poll votes now show only
-- what residents really did in the app.
-- -------------------------------------------------------------------------------------
SELECT 'S-03 event seed counts to clear' AS step, e.title, e.base_going
FROM events e JOIN target t ON t.id = e.association_id WHERE e.base_going <> 0;
UPDATE events e SET base_going = 0 FROM target t WHERE e.association_id = t.id AND e.base_going <> 0;

SELECT 'S-03 poll seed votes to clear' AS step, p.question, o.label, o.base_votes
FROM poll_options o JOIN polls p ON p.id = o.poll_id JOIN target t ON t.id = p.association_id WHERE o.base_votes <> 0;
UPDATE poll_options o SET base_votes = 0
FROM polls p, target t WHERE p.id = o.poll_id AND p.association_id = t.id AND o.base_votes <> 0;

-- -------------------------------------------------------------------------------------
-- O-02 (only when fix_homes is true): the subscription's home count, set to the homes
-- actually set up in the society. It is the figure shown in the Operator console; billing
-- uses the contract amount, not this. Adoption is already computed from real homes.
-- -------------------------------------------------------------------------------------
SELECT 'O-02 homes on subscription' AS step, s.plots AS stored, (SELECT count(*) FROM units u WHERE u.association_id = t.id) AS set_up
FROM subscriptions s JOIN target t ON t.id = s.association_id;
UPDATE subscriptions s SET plots = (SELECT count(*) FROM units u WHERE u.association_id = s.association_id)
FROM target t WHERE s.association_id = t.id AND :fix_homes
  AND (SELECT count(*) FROM units u WHERE u.association_id = t.id) > 0;

-- Dry run by default. Change to COMMIT only after reading the output above.
ROLLBACK;
