import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { customFetch } from "@workspace/api-client-react";
import { followRootKey } from "@/hooks/useHomeFeed";

/** Who follows a store, and which stores a user follows (Instagram-style lists). */
export type FollowListKind = "store-followers" | "store-following" | "my-following";

export interface FollowerItem { name: string; imageUrl: string | null; storeId: number | null }
export interface FollowingItem { id: number; name: string; category: string; imageUrl: string | null; verificationStatus: string }
export type FollowListItem = FollowerItem | FollowingItem;
export interface FollowListPage { total: number; items: FollowListItem[]; nextOffset: number | null }

const PAGE = 30;

function listUrl(kind: FollowListKind, storeId: number | undefined, offset: number, limit: number) {
  const query = `limit=${limit}&offset=${offset}`;
  if (kind === "my-following") return `/api/me/following?${query}`;
  return `/api/stores/${storeId}/${kind === "store-followers" ? "followers" : "following"}?${query}`;
}

/** Full list, loaded a page at a time. */
export function useFollowList(kind: FollowListKind, storeId?: number) {
  const { userId, isLoaded } = useAuth();
  return useInfiniteQuery<FollowListPage>({
    queryKey: [...followRootKey, "list", userId ?? "anonymous", kind, storeId ?? 0],
    queryFn: ({ pageParam, signal }) =>
      customFetch<FollowListPage>(listUrl(kind, storeId, Number(pageParam), PAGE), { method: "GET", signal }),
    initialPageParam: 0,
    getNextPageParam: last => last.nextOffset ?? undefined,
    enabled: isLoaded && !!userId && (kind === "my-following" || !!storeId),
  });
}

/** Just the number, for the profile header. Signed-out visitors see no number. */
export function useFollowTotal(kind: FollowListKind, storeId?: number) {
  const { userId, isLoaded } = useAuth();
  return useQuery<number>({
    queryKey: [...followRootKey, "total", userId ?? "anonymous", kind, storeId ?? 0],
    queryFn: async ({ signal }) =>
      (await customFetch<FollowListPage>(listUrl(kind, storeId, 0, 1), { method: "GET", signal })).total,
    enabled: isLoaded && !!userId && (kind === "my-following" || !!storeId),
  });
}
