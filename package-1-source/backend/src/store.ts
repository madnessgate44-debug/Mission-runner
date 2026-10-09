import pg from "pg";
import type { MissionV1, MissionApproval, MissionStatus } from "@mission-runner/shared";

const { Pool } = pg;

export interface StoredMission {
  mission: MissionV1;
  contentHash: `sha256:${string}`;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  effectiveRisk: "low" | "medium" | "high";
  approvalRequired: boolean;
  approval?: MissionApproval;
}

export class MissionStore {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS missions (
        mission_id text PRIMARY KEY,
        owner_id text NOT NULL,
        content_hash text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL,
        effective_risk text NOT NULL,
        approval_required boolean NOT NULL,
        approval jsonb,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS missions_owner_created_idx ON missions(owner_id, created_at DESC);
    `);
  }

  async create(ownerId: string, item: StoredMission): Promise<void> {
    await this.pool.query(
      `INSERT INTO missions(mission_id, owner_id, content_hash, payload, status, effective_risk, approval_required, approval, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [item.mission.missionId, ownerId, item.contentHash, JSON.stringify(item.mission), item.status, item.effectiveRisk, item.approvalRequired, item.approval ? JSON.stringify(item.approval) : null, item.createdAt, item.updatedAt]
    );
  }

  async get(ownerId: string, missionId: string): Promise<StoredMission | null> {
    const result = await this.pool.query("SELECT * FROM missions WHERE owner_id=$1 AND mission_id=$2", [ownerId, missionId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      mission: row.payload as MissionV1,
      contentHash: row.content_hash as `sha256:${string}`,
      status: row.status as MissionStatus,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      effectiveRisk: row.effective_risk,
      approvalRequired: row.approval_required,
      ...(row.approval ? { approval: row.approval as MissionApproval } : {})
    };
  }

  async list(ownerId: string, limit = 50): Promise<StoredMission[]> {
    const result = await this.pool.query("SELECT mission_id FROM missions WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2", [ownerId, limit]);
    const items = await Promise.all(result.rows.map(async (row) => this.get(ownerId, row.mission_id)));
    return items.filter((item): item is StoredMission => item !== null);
  }

  async approve(ownerId: string, missionId: string, approval: MissionApproval): Promise<StoredMission | null> {
    const result = await this.pool.query(
      `UPDATE missions SET status='approved', approval=$3, updated_at=now()
       WHERE owner_id=$1 AND mission_id=$2 AND status='awaiting_approval' AND content_hash=$4
       RETURNING mission_id`,
      [ownerId, missionId, JSON.stringify(approval), approval.contentHash]
    );
    if (!result.rowCount) return null;
    return this.get(ownerId, missionId);
  }

  async close(): Promise<void> { await this.pool.end(); }
}
