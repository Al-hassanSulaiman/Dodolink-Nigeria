import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListSupportThreads,
  getAdminListSupportThreadsQueryKey,
  useAdminListSupportMessages,
  getAdminListSupportMessagesQueryKey,
  useAdminReplySupport,
  adminMarkSupportRead,
} from "@workspace/api-client-react";
import type { SupportThread, SupportMessage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Headphones, Send } from "lucide-react";
import { toast } from "sonner";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function SupportPage() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: threads, isLoading: threadsLoading } = useAdminListSupportThreads({
    query: {
      queryKey: getAdminListSupportThreadsQueryKey(),
      refetchInterval: 15000,
    },
  });

  const { data: messages } = useAdminListSupportMessages(selectedUserId ?? "", {
    query: {
      enabled: !!selectedUserId,
      queryKey: getAdminListSupportMessagesQueryKey(selectedUserId ?? ""),
      refetchInterval: selectedUserId ? 15000 : false,
    },
  });

  const selectedThread = threads?.find((t) => t.userId === selectedUserId) ?? null;

  // Mark the selected thread as read and refresh the thread list badge counts
  useEffect(() => {
    if (!selectedUserId) return;
    adminMarkSupportRead(selectedUserId)
      .then(() => queryClient.invalidateQueries({ queryKey: getAdminListSupportThreadsQueryKey() }))
      .catch(() => {});
  }, [selectedUserId, messages?.length, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages?.length, selectedUserId]);

  const replyMutation = useAdminReplySupport({
    mutation: {
      onSuccess: () => {
        setReply("");
        if (selectedUserId) {
          queryClient.invalidateQueries({ queryKey: getAdminListSupportMessagesQueryKey(selectedUserId) });
        }
        queryClient.invalidateQueries({ queryKey: getAdminListSupportThreadsQueryKey() });
      },
      onError: () => {
        toast.error("Could not send the reply. Please try again.");
      },
    },
  });

  const handleSend = () => {
    const body = reply.trim();
    if (!body || !selectedUserId || replyMutation.isPending) return;
    replyMutation.mutate({ userId: selectedUserId, data: { body } });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Support</h1>
        <p className="text-sm text-gray-500 mt-1">Messages from customers and retailers</p>
      </div>

      <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ height: "calc(100vh - 180px)" }}>
        {/* Thread list */}
        <div className="w-72 border-r border-gray-200 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">
            Conversations
          </div>
          <div className="flex-1 overflow-y-auto">
            {threadsLoading ? (
              <p className="p-4 text-sm text-gray-400">Loading…</p>
            ) : !threads || threads.length === 0 ? (
              <div className="p-6 text-center">
                <Headphones className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No support messages yet</p>
              </div>
            ) : (
              threads.map((t: SupportThread) => (
                <button
                  key={t.userId}
                  onClick={() => setSelectedUserId(t.userId)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    selectedUserId === t.userId ? "bg-green-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{t.userName}</p>
                    {t.unreadCount > 0 && (
                      <Badge className="bg-red-500 text-white hover:bg-red-500">{t.unreadCount}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{t.lastMessage}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{formatTime(t.lastMessageAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedThread ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Headphones className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">Select a conversation to view and reply</p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">{selectedThread.userName}</p>
                {selectedThread.userEmail && (
                  <p className="text-xs text-gray-500">{selectedThread.userEmail}</p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-gray-50/50">
                {(messages ?? []).map((m: SupportMessage) => {
                  const isAdmin = m.senderRole === "admin";
                  return (
                    <div key={m.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                          isAdmin
                            ? "bg-[#1B5E20] text-white rounded-br-md"
                            : "bg-white border border-gray-200 text-gray-900 rounded-bl-md"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                        <p className={`text-[10px] mt-1 ${isAdmin ? "text-green-200" : "text-gray-400"}`}>
                          {formatTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <div className="px-4 py-3 border-t border-gray-100 flex items-end gap-2">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
                  maxLength={2000}
                  className="min-h-[44px] max-h-32 resize-none"
                  rows={1}
                />
                <Button
                  onClick={handleSend}
                  disabled={!reply.trim() || replyMutation.isPending}
                  className="bg-[#1B5E20] hover:bg-[#164a19] h-[44px] px-4"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
