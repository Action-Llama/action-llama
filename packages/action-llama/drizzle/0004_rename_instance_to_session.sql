-- Migration: rename instance_id to session_id, caller_instance to caller_session, target_instance to target_session
-- This migration is applied conditionally in code (see migrate.ts) to handle both fresh DBs (already using
-- new names from migration 0000) and existing DBs (still using old names). The SQL here is a no-op placeholder.
SELECT 1;
