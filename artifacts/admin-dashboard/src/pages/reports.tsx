import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Flag } from "lucide-react";

type Report = {
  id: number; kind: "store" | "delivery"; conversationId: number; reporterName: string; otherPartyName: string;
  reason: string; status: "open" | "resolved"; adminNote: string | null; createdAt: string;
};
type ContentReport = {
  id: number; kind: "store" | "product" | "review" | "user" | "block"; targetId: string; targetLabel: string | null;
  reporterName: string | null; reason: string; status: "open" | "resolved"; action: string | null; adminNote: string | null; createdAt: string;
};
type Msg = { id: number; senderName: string; senderType: string; body: string; mediaUrl: string | null; createdAt: string };

const when = (v: string) => new Date(v).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const errorMessage = (err: unknown) => (err as { data?: { error?: string }; message?: string })?.data?.error ?? (err as Error)?.message ?? "Something went wrong";

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Report | null>(null);
  const [note, setNote] = useState("");
  const reports = useQuery({ queryKey: ["admin-reports"], queryFn: () => customFetch<Report[]>("/api/admin/reports") });
  const chat = useQuery({
    queryKey: ["admin-report-chat", open?.id], enabled: !!open,
    queryFn: () => customFetch<{ messages: Msg[] }>(`/api/admin/reports/${open!.id}/chat`),
  });
  const resolve = useMutation({
    mutationFn: () => customFetch(`/api/admin/reports/${open!.id}/resolve`, { method: "POST", body: JSON.stringify({ note }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-reports"] }); toast.success("Report closed"); setOpen(null); setNote(""); },
    onError: err => toast.error(errorMessage(err)),
  });

  const [cNote, setCNote] = useState<Record<number, string>>({});
  const contentReports = useQuery({ queryKey: ["admin-content-reports"], queryFn: () => customFetch<ContentReport[]>("/api/admin/content-reports") });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "dismiss" | "remove" | "ban" }) =>
      customFetch(`/api/admin/content-reports/${id}/resolve`, { method: "POST", body: JSON.stringify({ action, note: cNote[id] ?? "" }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-content-reports"] }); toast.success("Done"); },
    onError: err => toast.error(errorMessage(err)),
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-600">Problems reported from store chats and delivery chats. You can read a chat only after someone reports it.</p>
      </div>
      {reports.isLoading ? <Skeleton className="h-16 w-full" /> : (
        <div className="space-y-3">
          {(reports.data ?? []).map(r => (
            <Card key={r.id}>
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    <Flag className="inline w-4 h-4 mr-1 text-amber-600" />
                    {r.reporterName} reported {r.otherPartyName}
                    <span className="ml-2 text-xs rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{r.kind === "store" ? "Store chat" : "Delivery chat"}</span>
                    {r.status === "resolved" && <span className="ml-2 text-xs rounded-full bg-green-100 px-2 py-0.5 text-green-800">Closed</span>}
                  </p>
                  <p className="text-xs text-gray-600 truncate">{when(r.createdAt)} · {r.reason}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setOpen(r); setNote(r.adminNote ?? ""); }}>Read chat</Button>
              </CardContent>
            </Card>
          ))}
          {(reports.data ?? []).length === 0 && <p className="text-sm text-gray-600">No reports.</p>}
        </div>
      )}

      <div>
        <h2 className="text-xl font-bold text-gray-900">Content and user reports</h2>
        <p className="text-sm text-gray-600">Flags and blocks from the app. Act within 24 hours: remove the content, or remove the person from the app.</p>
      </div>
      {contentReports.isLoading ? <Skeleton className="h-16 w-full" /> : (
        <div className="space-y-3">
          {(contentReports.data ?? []).map(r => (
            <Card key={r.id}>
              <CardContent className="py-4 space-y-2">
                <p className="text-sm font-medium text-gray-900">
                  <Flag className="inline w-4 h-4 mr-1 text-amber-600" />
                  {r.kind === "block" ? "Block" : `Reported ${r.kind}`}: {r.targetLabel ?? r.targetId}
                  {r.status === "resolved" && <span className="ml-2 text-xs rounded-full bg-green-100 px-2 py-0.5 text-green-800">Closed{r.action ? ` · ${r.action}` : ""}</span>}
                </p>
                <p className="text-xs text-gray-600">{when(r.createdAt)} · by {r.reporterName ?? "someone"} · {r.reason}</p>
                {r.status === "open" ? (
                  <div className="flex flex-wrap gap-2">
                    <Input className="max-w-xs" placeholder="Your note" value={cNote[r.id] ?? ""} onChange={e => setCNote({ ...cNote, [r.id]: e.target.value })} maxLength={1000} />
                    <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: "dismiss" })}>Dismiss</Button>
                    {r.kind !== "user" && r.kind !== "block" && <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => { if (confirm("Remove this content?")) act.mutate({ id: r.id, action: "remove" }); }}>Remove content</Button>}
                    <Button variant="destructive" size="sm" disabled={act.isPending} onClick={() => { if (confirm("Remove this person from the app?")) act.mutate({ id: r.id, action: "ban" }); }}>Remove person</Button>
                  </div>
                ) : r.adminNote ? <p className="text-sm text-gray-700">Note: {r.adminNote}</p> : null}
              </CardContent>
            </Card>
          ))}
          {(contentReports.data ?? []).length === 0 && <p className="text-sm text-gray-600">No content reports.</p>}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={v => !v && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open?.reporterName} and {open?.otherPartyName}</DialogTitle>
            <DialogDescription>Reason given: {open?.reason}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto rounded-md border border-gray-200 p-2">
            {chat.isLoading && <p className="text-sm text-gray-600">Loading…</p>}
            {chat.isError && <p className="text-sm text-red-600">Could not load this chat.</p>}
            {(chat.data?.messages ?? []).map(m => (
              <div key={m.id} className="text-sm rounded-md bg-gray-50 px-2 py-1 text-gray-900">
                <span className="font-semibold">{m.senderName}</span>
                <span className="text-xs text-gray-500"> · {when(m.createdAt)}</span>
                {m.mediaUrl && <p className="text-xs text-gray-600">[photo or video sent]</p>}
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
              </div>
            ))}
          </div>
          {open?.status === "open" ? (
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); resolve.mutate(); }}>
              <Input placeholder="Your note (what you decided)" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
              <Button type="submit" disabled={resolve.isPending}>Close report</Button>
            </form>
          ) : open?.adminNote ? <p className="text-sm text-gray-700">Note: {open.adminNote}</p> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
