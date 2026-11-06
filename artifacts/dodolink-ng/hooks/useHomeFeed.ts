import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  getHomeStores,
  getHomeProducts,
  getStoreFollow,
  followStore,
  unfollowStore,
  type HomeStore,
  type HomeProduct,
  type StoreFollowStatus,
} from "@workspace/api-client-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";

export const STORE_PAGE = 20;
export const PRODUCT_PAGE = 20;

/** Identity-scoped roots. Everything personalised lives under these. */
export const homeRootKey = ["dodolink-home"] as const;
export const followRootKey = ["dodolink-store-follow"] as const;

const identity = (userId: string | null | undefined) => userId ?? "guest";

export const homeStoresKey = (userId: string | null | undefined, seed: string) =>
  [...homeRootKey, identity(userId), "stores", seed] as const;
export const homeProductsKey = (userId: string | null | undefined, seed: string) =>
  [...homeRootKey, identity(userId), "products", seed] as const;
export const storeFollowKey = (userId: string | null | undefined, storeId: number) =>
  [...followRootKey, identity(userId), storeId] as const;

export const newSeed = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function nextFrom(page: { nextOffset: number | null }) {
  return page.nextOffset ?? undefined;
}

function dedupe<T extends { id: number }>(pages: T[][]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const p of pages) for (const it of p) if (!seen.has(it.id)) { seen.add(it.id); out.push(it); }
  return out;
}

export function useHomeFeed() {
  const { userId, isLoaded } = useAuth();
  const [seed, setSeed] = useState(newSeed);
  const queryClient = useQueryClient();

  // Show what was on screen last time straight away while fresh data loads,
  // so opening the app never starts with an empty page.
  const cacheKey = `dodolink.home.v1.${identity(userId)}`;
  const [cached, setCached] = useState<{ stores?: HomeStore[]; products?: HomeProduct[] } | null>(null);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(cacheKey)
      .then((v) => { if (live) setCached(v ? JSON.parse(v) : null); })
      .catch(() => { if (live) setCached(null); });
    return () => { live = false; };
  }, [cacheKey]);
  const asPages = <T,>(items?: T[]) =>
    items?.length ? { pages: [{ items, next: undefined as number | undefined }], pageParams: [0] } : undefined;

  const stores = useInfiniteQuery({
    queryKey: homeStoresKey(userId, seed),
    enabled: isLoaded,
    placeholderData: asPages(cached?.stores),
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const page = await getHomeStores({ seed, offset: pageParam, limit: STORE_PAGE }, { signal });
      return { items: page.items, next: nextFrom(page) };
    },
    getNextPageParam: (last) => last.next,
  });

  const products = useInfiniteQuery({
    queryKey: homeProductsKey(userId, seed),
    enabled: isLoaded,
    placeholderData: asPages(cached?.products),
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const page = await getHomeProducts({ seed, offset: pageParam, limit: PRODUCT_PAGE }, { signal });
      return { items: page.items, next: nextFrom(page) };
    },
    getNextPageParam: (last) => last.next,
  });

  const storeItems = useMemo<HomeStore[]>(() => dedupe((stores.data?.pages ?? []).map((p) => p.items)), [stores.data]);
  const productItems = useMemo<HomeProduct[]>(() => dedupe((products.data?.pages ?? []).map((p) => p.items)), [products.data]);

  useEffect(() => {
    if (stores.isPlaceholderData || products.isPlaceholderData || !stores.data || !products.data) return;
    const first = { stores: stores.data.pages[0]?.items ?? [], products: products.data.pages[0]?.items ?? [] };
    AsyncStorage.setItem(cacheKey, JSON.stringify(first)).catch(() => {});
  }, [stores.data, products.data, stores.isPlaceholderData, products.isPlaceholderData, cacheKey]);

  /** New seed => new keys => fresh first pages. Old seeds are dropped. */
  const refresh = useCallback(() => {
    queryClient.removeQueries({ queryKey: [...homeRootKey, identity(userId)] });
    setSeed(newSeed());
  }, [queryClient, userId]);

  return { seed, stores, products, storeItems, productItems, refresh, userId };
}

export function useStoreFollowStatus(storeId: number, enabled = true) {
  const { userId, isLoaded } = useAuth();
  return useQuery<StoreFollowStatus>({
    queryKey: storeFollowKey(userId, storeId),
    queryFn: ({ signal }) => getStoreFollow(storeId, { signal }),
    enabled: isLoaded && enabled && !!storeId,
  });
}

export function useToggleFollow() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, follow }: { storeId: number; follow: boolean }) =>
      follow ? followStore(storeId) : unfollowStore(storeId),
    onSuccess: (status) => {
      queryClient.setQueryData(storeFollowKey(userId, status.storeId), status);
      queryClient.invalidateQueries({ queryKey: homeRootKey });
      queryClient.invalidateQueries({ queryKey: followRootKey });
    },
  });
}
