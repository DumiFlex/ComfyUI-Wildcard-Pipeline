-- Add snapshot_fingerprint to the modules table.
-- Computed on next write via ModuleRepository.create() / update().
-- Existing rows from before this migration keep NULL until next write —
-- Task 8 (collision detection) treats NULL as "no collision" so legacy
-- rows never block imports.

ALTER TABLE modules ADD COLUMN snapshot_fingerprint TEXT;
