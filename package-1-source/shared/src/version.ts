/**
 * Version identifiers for the Mission Runner mission contract.
 *
 * The schema version is part of the mission document itself. Bumping the
 * contract requires a new schema file (e.g. mission.v2.schema.json) and a
 * corresponding addition to this module. Never silently mutate v1.
 */
export const MISSION_SCHEMA_VERSION_V1 = "mission.v1" as const;

/** All supported mission schema versions. */
export const SUPPORTED_MISSION_SCHEMA_VERSIONS = [
  MISSION_SCHEMA_VERSION_V1,
] as const;

export type MissionSchemaVersion =
  (typeof SUPPORTED_MISSION_SCHEMA_VERSIONS)[number];

export function isSupportedMissionSchemaVersion(
  value: unknown,
): value is MissionSchemaVersion {
  return (
    typeof value === "string" &&
    (SUPPORTED_MISSION_SCHEMA_VERSIONS as readonly string[]).includes(value)
  );
}