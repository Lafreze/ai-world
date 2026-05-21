-- Profession column for agent roles. Goals already exists as jsonb.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS profession TEXT;

-- Reset the default world so the new procedural seed regenerates it on the
-- next boot. seedWorld() in migrate.js only runs when both cells and agents
-- are empty for the world.
UPDATE worlds
   SET grid_size = 32, updated_at = NOW()
 WHERE id = (SELECT MIN(id) FROM worlds);
DELETE FROM cells
 WHERE world_id = (SELECT MIN(id) FROM worlds);
DELETE FROM agents
 WHERE world_id = (SELECT MIN(id) FROM worlds);
