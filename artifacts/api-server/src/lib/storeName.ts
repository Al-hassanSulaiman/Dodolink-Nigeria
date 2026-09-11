import { and, eq, ne } from "drizzle-orm";
import { db, storesTable } from "@workspace/db";

export const STORE_NAME_ALREADY_EXISTS = {
  code: "STORE_NAME_ALREADY_EXISTS",
  error: "A verified store with this name already exists",
} as const;

export function normalizeStoreName(name: string): string {
  return name.trim().replace(/[ \t\n\r\f\v]+/g, " ").toLocaleLowerCase("en-US");
}

export async function findVerifiedStoreNameConflict(
  name: string,
  excludeStoreId?: number,
): Promise<number | null> {
  const normalizedName = normalizeStoreName(name);
  const conditions = [
    eq(storesTable.verificationStatus, "verified"),
    eq(storesTable.normalizedName, normalizedName),
  ];

  if (excludeStoreId !== undefined) {
    conditions.push(ne(storesTable.id, excludeStoreId));
  }

  const [conflict] = await db
    .select({ id: storesTable.id })
    .from(storesTable)
    .where(and(...conditions))
    .limit(1);

  return conflict?.id ?? null;
}

export function isVerifiedStoreNameUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "23505" &&
      candidate.constraint === "stores_verified_name_unique"
    ) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}