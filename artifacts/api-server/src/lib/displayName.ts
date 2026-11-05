import { eq, inArray } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, storesTable, deliveryAgentsTable } from "@workspace/db";

/** "abc@gmail.com" becomes "abc". Anything that is not an email is left alone. */
export function friendlyName(value: string): string {
  const at = value.indexOf("@");
  return at > 0 && !/\s/.test(value) ? value.slice(0, at) : value;
}

/** Name shown for a person in chats: store name, else delivery company name, else email without the domain. */
export async function userDisplayName(userId: string): Promise<string> {
  const [store] = await db.select({ name: storesTable.name }).from(storesTable)
    .where(eq(storesTable.ownerUserId, userId)).orderBy(storesTable.id).limit(1);
  if (store?.name) return store.name;
  const [company] = await db.select({ name: deliveryAgentsTable.name }).from(deliveryAgentsTable)
    .where(eq(deliveryAgentsTable.linkedUserId, userId)).limit(1);
  if (company?.name) return company.name;
  try {
    const user = await clerkClient.users.getUser(userId);
    const emails = user.emailAddresses ?? [];
    const email = emails.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ?? emails[0]?.emailAddress;
    if (email) return friendlyName(email);
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return full || user.username || "Dodolink user";
  } catch {
    return "Dodolink user";
  }
}

/** Delivery company names for a set of users (used to label chat partners in bulk). */
export async function companyNames(userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await db.select({ id: deliveryAgentsTable.linkedUserId, name: deliveryAgentsTable.name })
    .from(deliveryAgentsTable).where(inArray(deliveryAgentsTable.linkedUserId, [...new Set(userIds)]));
  return new Map(rows.flatMap(r => (r.id ? [[r.id, r.name] as [string, string]] : [])));
}
