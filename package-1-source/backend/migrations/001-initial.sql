CREATE TABLE IF NOT EXISTS missions (
  mission_id text PRIMARY KEY,
  owner_id text NOT NULL,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','validated','awaiting_approval','approved','running','succeeded','failed','cancelled','expired')),
  effective_risk text NOT NULL CHECK (effective_risk IN ('low','medium','high')),
  approval_required boolean NOT NULL,
  approval jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS missions_owner_created_idx ON missions(owner_id, created_at DESC);