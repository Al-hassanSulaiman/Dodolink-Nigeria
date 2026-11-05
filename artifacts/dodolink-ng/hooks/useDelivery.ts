import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { customFetch } from "@workspace/api-client-react";

export type DeliveryType = "intrastate" | "interstate" | "both";
export interface DeliveryAgent {
  id: number; name: string; imageUrl: string | null; bio: string | null;
  deliveryType: DeliveryType; homeState: string | null; coveredStates: string[]; nationwide: boolean;
  ratingAverage?: number | null; ratingCount?: number;
}
export interface DeliveryOrder {
  id: number; status: string; amountKobo: number; pickupState: string; dropState: string; description: string | null;
  createdAt: string; paidAt: string | null; deliveredAt: string | null; disputed: boolean;
  rating: { stars: number; comment: string | null } | null;
  code: string | null;
  breakdown: { platformFeeKobo: number; paystackFeeKobo: number; transferFeeKobo: number; youReceiveKobo: number } | null;
  payoutStatus: string | null; needsReview: boolean;
}
export interface DeliveryInboxItem {
  id: number; role: "customer" | "agent"; title: string; imageUrl: string | null;
  deliveryType: DeliveryType | null; lastMessage: string | null; lastMessageAt: string | null; unread: number;
}
export interface DeliveryMessage {
  id: number; body: string; mediaUrl: string | null;
  replyPreview: { id: number; senderId: string; senderName: string; body: string; mediaUrl: string | null } | null;
  senderId: string; senderType: "customer" | "agent" | "support"; senderName: string; mine: boolean; createdAt: string;
}
export interface DeliverySubscription {
  agentId: number; engagementCount: number; amountKobo: number; qualified: boolean; exempt: boolean; paid: boolean;
  dueAt: string | null; lastPaidAt: string | null; graceDaysLeft: number | null; visible: boolean; paymentsLive: boolean;
}
export interface DeliveryThread {
  role: "customer" | "agent"; title: string; agent: DeliveryAgent; messages: DeliveryMessage[];
  orders: DeliveryOrder[]; paymentsEnabled: boolean;
  myRating: { stars: number; comment: string | null } | null; canRate: boolean;
}

export const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export function ratingLine(a: DeliveryAgent): string {
  return a.ratingCount && a.ratingAverage ? `★ ${a.ratingAverage.toFixed(1)} (${a.ratingCount})` : 'New, no ratings yet';
}

/** Same rules the server applies, so a company can preview what it will receive before sending a request. */
export function previewQuote(amountNaira: number) {
  const amount = Math.round(amountNaira * 100);
  const platform = Math.round(amount * 0.1);
  const paystack = Math.min(Math.ceil(amount * 0.015) + (amount >= 250000 ? 10000 : 0), 200000);
  const before = Math.max(amount - platform - paystack, 0);
  const transfer = before <= 500000 ? 1000 : before <= 5000000 ? 2500 : 5000;
  return { platform, paystack, transfer, receive: Math.max(before - transfer, 0) };
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

/** The signed-in person's own delivery company (null when they do not have one). */
export function useMyDeliveryCompany() {
  const { userId, enabled } = useSignedIn();
  return useQuery<DeliveryAgent | null>({
    queryKey: ["delivery", "me", userId],
    enabled,
    queryFn: async () => (await customFetch<{ agent: DeliveryAgent | null }>("/api/delivery/me")).agent,
  });
}

export function useDeliverySubscription(enabledFlag: boolean) {
  const { userId, enabled } = useSignedIn();
  return useQuery<DeliverySubscription>({
    queryKey: ["delivery", "subscription", userId],
    enabled: enabled && enabledFlag,
    queryFn: () => customFetch<DeliverySubscription>("/api/delivery/subscription"),
  });
}
