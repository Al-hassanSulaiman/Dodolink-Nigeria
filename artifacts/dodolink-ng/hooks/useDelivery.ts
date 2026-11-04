import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { customFetch } from "@workspace/api-client-react";

export type DeliveryType = "intrastate" | "interstate" | "both";
export interface DeliveryAgent {
  id: number; name: string; imageUrl: string | null; bio: string | null;
  deliveryType: DeliveryType; homeState: string | null; coveredStates: string[]; nationwide: boolean;
}
export interface DeliveryInboxItem {
  id: number; role: "customer" | "agent"; title: string; imageUrl: string | null;
  deliveryType: DeliveryType | null; lastMessage: string | null; lastMessageAt: string | null; unread: number;
}
export interface DeliveryMessage {
  id: number; body: string; senderType: "customer" | "agent"; senderName: string; mine: boolean; createdAt: string;
}
export interface DeliveryThread {
  role: "customer" | "agent"; title: string; agent: DeliveryAgent; messages: DeliveryMessage[];
}

export const deliveryTypeLabel: Record<DeliveryType, string> = {
  intrastate: "Intrastate", interstate: "Interstate", both: "Interstate + Intrastate",
};

/** One line saying where he delivers, e.g. "Kano" or "Kano · Kaduna, Abuja" or "Nationwide". */
export function coverageLine(a: DeliveryAgent): string {
  const parts: string[] = [];
  if (a.deliveryType !== "interstate" && a.homeState) parts.push(a.homeState);
  if (a.deliveryType !== "intrastate") parts.push(a.nationwide ? "Nationwide" : a.coveredStates.join(", "));
  return parts.filter(Boolean).join(" · ");
}

function useSignedIn() {
  const { userId, isLoaded } = useAuth();
  return { userId, enabled: isLoaded && !!userId };
}

export function useDeliveryAgents(type: "" | "intrastate" | "interstate", state: string) {
  const { userId, enabled } = useSignedIn();
  return useQuery<DeliveryAgent[]>({
    queryKey: ["delivery", "agents", userId, type, state],
    enabled,
    placeholderData: previous => previous,
    queryFn: () => customFetch<DeliveryAgent[]>(
      `/api/delivery/agents?type=${encodeURIComponent(type)}&state=${encodeURIComponent(state)}`),
  });
}

export function useDeliveryStates() {
  const { userId, enabled } = useSignedIn();
  return useQuery<string[]>({
    queryKey: ["delivery", "states", userId],
    enabled,
    staleTime: Infinity,
    queryFn: async () => (await customFetch<{ states: string[] }>("/api/delivery/meta")).states,
  });
}

export function useDeliveryInbox(refetchInterval: number | false) {
  const { userId, enabled } = useSignedIn();
  return useQuery<DeliveryInboxItem[]>({
    queryKey: ["delivery", "inbox", userId],
    enabled,
    refetchInterval,
    queryFn: () => customFetch<DeliveryInboxItem[]>("/api/delivery/conversations"),
  });
}

export function useDeliveryThread(id: number | null, refetchInterval: number | false) {
  const { userId, enabled } = useSignedIn();
  return useQuery<DeliveryThread>({
    queryKey: ["delivery", "thread", userId, id],
    enabled: enabled && id !== null,
    refetchInterval,
    queryFn: () => customFetch<DeliveryThread>(`/api/delivery/conversations/${id}/messages`),
  });
}
