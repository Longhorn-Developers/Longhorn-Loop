-- Migration 0010: organization verification columns (LOOP-185)
--
-- Backs the president-email check and the review-pending state behind the
-- "Thank you for verifying!" screen.

-- The president on file, against which a claimant's entered email is checked.
-- NULL means we have nobody on record: the route treats that as a mismatch
-- rather than waving the claim through, since approving an unverifiable claim
-- is the worse failure.
ALTER TABLE organizations ADD COLUMN president_email TEXT;

-- Where the org sits in the verification pipeline. Distinct from the existing
-- `verified` flag, which stays 0 until a human approves -- the success screen
-- promises "our team will review", so code verification alone must not flip it.
--   unverified     -- nobody has claimed it
--   pending_review -- code confirmed, waiting on the Longhorn Loop team
--   rejected       -- reviewed and turned down
ALTER TABLE organizations ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified';
