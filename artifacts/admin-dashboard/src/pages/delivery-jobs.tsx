import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { PackageCheck } from "lucide-react";

type Dispute = { id: number; openedByRole: string; reason: string; status: string; resolution: string | null; createdAt: string };
type ChatMsg = { id: number; senderType: string; senderName: string; body: string; createdAt: string };
type Job = {
  id: number; company: string; status: string; payoutStatus: string; amountKobo: number;
  platformFeeKobo: number; companyReceivesKobo: number; refundedKobo: number;
  pickupState: string; dropState: string; description: string | null;
  paidAt: string | null; deliveredAt: string | null; createdAt: string; payoutNote: string | null;
  needsReview: boolean; disputes: Dispute[];
};

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const date = (v: string | null) => (v ? new Date(v).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const STATUS: Record<string, string> = {
  requested: "Waiting for payment", paid: "Paid, not delivered", delivered: "Delivered", disputed: "Problem raised",
  refunded: "Refunded", cancelled: "Cancelled", review: "Check payment",
};
const PAYOUT: Record<string, string> = {
  none: "", pending: "Ready to pay out", starting: "Unclear result, check Paystack", awaiting_otp: "Waiting for your code",
  processing: "Paystack is sending it", paid: "Paid out", failed: "Failed", held: "On hold",
};

function errorMessage(err: unknown): string {
  const e = err as { data?: { error?: string }; message?: string } | undefined;
  return e?.data?.error ?? e?.message ?? "Something went wrong";
}

export default function DeliveryJobsPage() {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ["admin-delivery-jobs"],
    queryFn: () => customFetch<Job[]>("/api/admin/delivery-orders"),
    refetchInterval: 30_000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-delivery-jobs"] });
  const post = (path: string, body: unknown = {}) => customFetch<{ message?: string }>(`/api/admin/delivery-orders/${path}`, { method: "POST", body: JSON.stringify(body) });

  const [otpFor, setOtpFor] = useState<Job | null>(null);
  const [otp, setOtp] = useState("");
  const [resolving, setResolving] = useState<Job | null>(null);
  const [action, setAction] = useState<"pay_agent" | "refund_customer" | "split">("pay_agent");
  const [refundNaira, setRefundNaira] = useState("");
  const [note, setNote] = useState("");

  const payout = useMutation({
    mutationFn: (job: Job) => post(`${job.id}/payout`),
    onSuccess: (res, job) => { toast.success(res.message ?? "Started"); refresh(); if (res.message?.includes("code")) { setOtp(""); setOtpFor(job); } },
    onError: err => { toast.error(errorMessage(err)); refresh(); },
  });
  const finalize = useMutation({
    mutationFn: () => post(`${otpFor!.id}/payout/otp`, { otp }),
    onSuccess: () => { toast.success("Code accepted. The payout is on its way."); setOtpFor(null); refresh(); },
    onError: err => toast.error(errorMessage(err)),
  });
  const resend = useMutation({
    mutationFn: () => post(`${otpFor!.id}/payout/resend-otp`),
    onSuccess: () => toast.success("A new code was sent."),
    onError: err => toast.error(errorMessage(err)),
  });
  const mark = useMutation({
    mutationFn: (v: { job: Job; outcome: "paid" | "failed" }) => post(`${v.job.id}/payout/mark`, { outcome: v.outcome }),
    onSuccess: () => { toast.success("Recorded"); refresh(); },
    onError: err => toast.error(errorMessage(err)),
  });
  const [chatFor, setChatFor] = useState<Job | null>(null);
  const [support, setSupport] = useState("");
  const chat = useQuery({
    queryKey: ["admin-delivery-chat", chatFor?.id],
    enabled: !!chatFor,
    refetchInterval: 15_000,
    queryFn: () => customFetch<{ customerName: string; messages: ChatMsg[] }>(`/api/admin/delivery-orders/${chatFor!.id}/chat`),
  });
  const sendSupport = useMutation({
    mutationFn: () => post(`${chatFor!.id}/message`, { body: support }),
    onSuccess: () => { setSupport(""); queryClient.invalidateQueries({ queryKey: ["admin-delivery-chat", chatFor?.id] }); toast.success("Sent to both the customer and the company"); },
    onError: err => toast.error(errorMessage(err)),
  });

  const resolve = useMutation({
    mutationFn: () => post(`${resolving!.id}/resolve`, { action, note, refundNaira: action === "split" ? Number(refundNaira) : undefined }),
    onSuccess: () => { toast.success("Decision saved"); setResolving(null); setNote(""); setRefundNaira(""); refresh(); },
    onError: err => toast.error(errorMessage(err)),
  });

  const list = jobs.data ?? [];
  const attention = list.filter(j => j.status === "disputed" || j.needsReview || j.payoutStatus === "starting");

  const JobCard = ({ job }: { job: Job }) => {
    const open = job.disputes.find(d => d.status === "open");
    return (
      <Card className={job.status === "disputed" || job.needsReview ? "border-amber-400" : undefined}>
        <CardContent className="py-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">
              Job #{job.id} · {job.company} · {job.pickupState} to {job.dropState}
            </p>
            <p className="text-sm font-semibold text-gray-900">{naira(job.amountKobo)}</p>
          </div>
          <p className="text-sm text-gray-700">
            <span className="font-medium">{STATUS[job.status] ?? job.status}</span>
            {PAYOUT[job.payoutStatus] ? ` · Payout: ${PAYOUT[job.payoutStatus]}` : ""}
            {job.needsReview ? " · Paid over 3 days ago and not confirmed. Please review." : ""}
          </p>
          <p className="text-xs text-gray-600">
            DodoLink keeps {naira(job.platformFeeKobo)} · Company receives about {naira(job.companyReceivesKobo)} after Paystack fees
            {job.refundedKobo > 0 ? ` · Refunded ${naira(job.refundedKobo)}` : ""}
            {job.paidAt ? ` · Paid ${date(job.paidAt)}` : ""}{job.deliveredAt ? ` · Delivered ${date(job.deliveredAt)}` : ""}
          </p>
          {job.description && <p className="text-xs text-gray-600">Goods: {job.description}</p>}
          {job.payoutNote && <p className="text-xs text-amber-700">{job.payoutNote}</p>}
          {open && (
            <p className="text-sm text-amber-800 bg-amber-50 rounded-md p-2">
              Problem raised by the {open.openedByRole}: {open.reason}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {job.status === "delivered" && (job.payoutStatus === "pending" || job.payoutStatus === "failed") && (
              <Button size="sm" disabled={payout.isPending} onClick={() => payout.mutate(job)}>Pay out {naira(job.companyReceivesKobo)}</Button>
            )}
            {job.payoutStatus === "awaiting_otp" && (
              <Button size="sm" onClick={() => { setOtp(""); setOtpFor(job); }}>Enter the code Paystack sent</Button>
            )}
            {job.payoutStatus === "starting" && (
              <>
                <Button size="sm" variant="outline" onClick={() => mark.mutate({ job, outcome: "paid" })}>I checked: it was paid</Button>
                <Button size="sm" variant="outline" onClick={() => mark.mutate({ job, outcome: "failed" })}>I checked: it did not go</Button>
              </>
            )}
            {job.disputes.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => { setSupport(""); setChatFor(job); }}>Read chat and message them</Button>
            )}
            {job.status === "disputed" && (
              <Button size="sm" variant="outline" onClick={() => { setAction("pay_agent"); setResolving(job); }}>Decide this problem</Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Delivery jobs and payouts</h1>
        <p className="text-sm text-gray-600 mt-1">
          Customers pay DodoLink first. After delivery is confirmed, press Pay out, then type the code Paystack sends you. DodoLink keeps 10%, and Paystack fees come out of the company's share.
        </p>
      </div>

      {jobs.isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-600 flex items-center gap-2"><PackageCheck className="w-4 h-4" />No delivery jobs yet.</p>
      ) : (
        <div className="space-y-6">
          {attention.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-amber-800">Needs your attention ({attention.length})</h2>
              {attention.map(j => <JobCard key={j.id} job={j} />)}
            </section>
          )}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">All jobs</h2>
            {list.map(j => <JobCard key={j.id} job={j} />)}
          </section>
        </div>
      )}

      <Dialog open={!!otpFor} onOpenChange={open => !open && setOtpFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter the Paystack code</DialogTitle>
            <DialogDescription>
              Paystack sent a code to your business phone or email for job #{otpFor?.id}. Typing it releases {otpFor ? naira(otpFor.companyReceivesKobo) : ""} to {otpFor?.company}.
            </DialogDescription>
          </DialogHeader>
          <Input inputMode="numeric" placeholder="Code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => resend.mutate()} disabled={resend.isPending}>Send a new code</Button>
            <Button onClick={() => finalize.mutate()} disabled={finalize.isPending || otp.length < 4}>{finalize.isPending ? "Sending…" : "Release money"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!chatFor} onOpenChange={open => !open && setChatFor(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chat for job #{chatFor?.id}: {chatFor?.company} and {chat.data?.customerName ?? "the customer"}</DialogTitle>
            <DialogDescription>
              You can read this chat because a problem was reported on this job. Only reported jobs can be opened. What you write below is shown to both sides as DodoLink Support.
            </DialogDescription>
          </DialogHeader>
          {chatFor?.disputes.map(d => (
            <p key={d.id} className="text-sm text-amber-800 bg-amber-50 rounded-md p-2">Problem raised by the {d.openedByRole}: {d.reason}</p>
          ))}
          <div className="space-y-2 max-h-72 overflow-y-auto rounded-md border border-gray-200 p-2">
            {chat.isLoading && <p className="text-sm text-gray-600">Loading…</p>}
            {chat.isError && <p className="text-sm text-red-600">Could not load this chat.</p>}
            {(chat.data?.messages ?? []).map(m => (
              <div key={m.id} className={`text-sm rounded-md px-2 py-1 ${m.senderType === "support" ? "bg-green-50 text-green-900" : "bg-gray-50 text-gray-900"}`}>
                <span className="font-semibold">{m.senderType === "support" ? "DodoLink Support" : m.senderType === "agent" ? `${m.senderName} (company)` : `${m.senderName} (customer)`}</span>
                <span className="text-xs text-gray-500"> · {date(m.createdAt)}</span>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
            {chat.data && chat.data.messages.length === 0 && <p className="text-sm text-gray-600">No messages.</p>}
          </div>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (support.trim()) sendSupport.mutate(); }}>
            <Input placeholder="Message to both the customer and the company" value={support} onChange={e => setSupport(e.target.value)} maxLength={2000} />
            <Button type="submit" disabled={sendSupport.isPending || !support.trim()}>Send</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolving} onOpenChange={open => !open && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decide job #{resolving?.id}</DialogTitle>
            <DialogDescription>The payment is held until you choose. Refunds go back through Paystack and cannot be undone.</DialogDescription>
          </DialogHeader>
          {resolving?.disputes.filter(d => d.status === "open").map(d => (
            <p key={d.id} className="text-sm text-gray-800 bg-gray-50 rounded-md p-2">{d.openedByRole}: {d.reason}</p>
          ))}
          <div className="space-y-2 text-sm">
            {([
              ["pay_agent", "Pay the company (delivery was fine)"],
              ["refund_customer", `Refund the customer in full (${resolving ? naira(resolving.amountKobo) : ""})`],
              ["split", "Split: refund part to the customer, pay the company the rest"],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer">
                <input type="radio" className="mt-1" checked={action === value} onChange={() => setAction(value)} />{label}
              </label>
            ))}
            {action === "split" && (
              <Input inputMode="decimal" placeholder="Amount to refund the customer (₦)" value={refundNaira} onChange={e => setRefundNaira(e.target.value)} />
            )}
            <Input placeholder="Note (optional, kept in the record)" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>Cancel</Button>
            <Button onClick={() => resolve.mutate()} disabled={resolve.isPending || (action === "split" && !(Number(refundNaira) > 0))}>
              {resolve.isPending ? "Saving…" : "Confirm decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
