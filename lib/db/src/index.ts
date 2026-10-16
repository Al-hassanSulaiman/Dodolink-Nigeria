import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { createPoolOptions, readDatabaseSettings, type IamDatabaseSettings } from "./connection-config";

const { Pool } = pg;
const settings = readDatabaseSettings(process.env);

async function iamConnectionOptions(settings: IamDatabaseSettings): Promise<pg.PoolConfig> {
  // Explicit opt-in: never fall back to the workspace's development URL.
  // Cloud Run obtains short-lived IAM credentials from its attached identity.
  const { Connector, AuthTypes, IpAddressTypes } = await import(
    "@google-cloud/cloud-sql-connector"
  );
  const connector = new Connector();
  try {
    const connectionOptions = await connector.getOptions({
      instanceConnectionName: settings.instanceConnectionName,
      ipType: IpAddressTypes.PUBLIC,
      authType: AuthTypes.IAM,
    });
    process.once("exit", () => connector.close());
    return connectionOptions;
  } catch (error) {
    connector.close();
    throw error;
  }
}

export const pool = new Pool(await createPoolOptions(settings, iamConnectionOptions));
export const db = drizzle(pool, { schema });

export * from "./schema";
