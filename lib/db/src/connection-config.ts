import type { PoolConfig } from "pg";

type Environment = Readonly<Record<string, string | undefined>>;

export function isMigrationStaging(env: Environment): boolean {
  const value = env.MIGRATION_STAGING;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("MIGRATION_STAGING must be true or false.");
}

export type DatabaseSettings =
  | { mode: "url"; connectionString: string; readOnly: boolean }
  | {
      mode: "cloud-sql-iam";
      instanceConnectionName: string;
      user: string;
      database: string;
      readOnly: boolean;
    };

export function readDatabaseSettings(env: Environment): DatabaseSettings {
  const mode = env.DATABASE_CONNECTION_MODE ?? "url";
  const readOnly = isMigrationStaging(env);
  if (mode === "url") {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for URL database connections.");
    }
    let connectionString = env.DATABASE_URL;
    if (readOnly) {
      // node-postgres lets URL parameters override Pool options. Pin the
      // read-only setting in the URL too, so inherited options cannot undo it.
      try {
        const url = new URL(connectionString);
        if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
        url.searchParams.set("options", "-c default_transaction_read_only=on");
        connectionString = url.toString();
      } catch {
        throw new Error("Staging DATABASE_URL must be a valid PostgreSQL URL.");
      }
    }
    return { mode, connectionString, readOnly };
  }
  if (mode !== "cloud-sql-iam") {
    throw new Error("Unsupported DATABASE_CONNECTION_MODE.");
  }
  if (env.MIGRATION_STAGING === undefined) {
    throw new Error("Cloud SQL IAM requires an explicit MIGRATION_STAGING=true or false.");
  }
  const instanceConnectionName = env.CLOUD_SQL_INSTANCE_CONNECTION_NAME;
  const user = env.CLOUD_SQL_IAM_USER;
  const database = env.CLOUD_SQL_DATABASE;
  if (!instanceConnectionName || !user || !database) {
    throw new Error(
      "Cloud SQL IAM requires CLOUD_SQL_INSTANCE_CONNECTION_NAME, CLOUD_SQL_IAM_USER, and CLOUD_SQL_DATABASE.",
    );
  }
  if (!/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(instanceConnectionName)) {
    throw new Error("CLOUD_SQL_INSTANCE_CONNECTION_NAME must identify a project, region, and instance.");
  }
  if (user.endsWith(".gserviceaccount.com")) {
    throw new Error("CLOUD_SQL_IAM_USER must omit the .gserviceaccount.com suffix.");
  }
  return { mode, instanceConnectionName, user, database, readOnly };
}

export type IamDatabaseSettings = Extract<DatabaseSettings, { mode: "cloud-sql-iam" }>;

/** Inject the credential boundary so configuration tests never call Google. */
export async function createPoolOptions(
  settings: DatabaseSettings,
  getIamOptions: (settings: IamDatabaseSettings) => Promise<PoolConfig>,
): Promise<PoolConfig> {
  const readOnlyOptions = settings.readOnly
    ? { options: "-c default_transaction_read_only=on" }
    : {};
  if (settings.mode === "url") {
    return { connectionString: settings.connectionString, ...readOnlyOptions };
  }
  return {
    ...await getIamOptions(settings),
    user: settings.user,
    database: settings.database,
    max: 5,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
    ...readOnlyOptions,
  };
}
