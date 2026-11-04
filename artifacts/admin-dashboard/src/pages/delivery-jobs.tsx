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
import { PackageCheck, AlertTriangle } from "lucide-react";

type Job = {
  id: number; companyName: string; pickupState: string; dropState: string; amountKobo: number; refundKobo: number;
  platformFeeKobo: number; companyReceivesKobo: number; status: string; payoutStatus: string; payoutError: string | null;
  paidAt: string | null; deliveredAt: string | null; createdAt: string; disputeOpen: boolean; needsReview: boolean;
};
type Dispute = {
  id: number; orderId: number; companyName: string; openedByRole: string; reason: string; status: string;
  resolution: string | null; adminNote: string | null; createdAt: string; amountKobo: number;
  pickupState: string; dropState: string; orderStatus: string; payoutStatus: string;
};
type Settings = { payoutMode: "manual_otp" | "automatic"; payoutsPaused: boolean };

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG")}`;
const PAYOUT_LABEL: Record<string, string> = {
  none: "No payout yet", queued: "Ready to pay out", sending: "Sending…", awaiting_otp: "Waiting for your Paystack code",
  sent: "Sent, Paystack is processing", paid: "Paid", failed: "Failed",
};
const STATUS_LABEL: Record<string, string> = {
  requested: "Waiting for payment", paid: "Paid, on the way", delivered: "Delivered", disputed: "Problem reported",
  refunded: "Refunded", cancelled: "Cancelled",
};

function errorMessage(err: unknown): string {
  const e = err as { data?: { error?: string; message?: string }; message?: string } | undefined;
  return e?.data?.message ?? e?.data?.error ?? e?.message ?? "Something went wrong";
}

export default function DeliveryJobsPage() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-delivery-orders"] });
    qc.invalidateQueries({ queryKey: ["admin-delivery-disputes"] });
  };
  const jobs = useQuery({ queryKey: ["admin-delivery-orders"], queryFn: () => customFetch<Job[]>("/api/admin/delivery-orders"), refetchInterval: 30000 });
  const disputes = useQuery({ queryKey: ["admin-delivery-disputes"], queryFn: () => customFetch<Dispute[]>("/api/admin/delivery-disputes") });
  const settings = useQuery({ queryKey: ["admin-delivery-settings"], queryFn: () => customFetch<Settings>("/api/admin/delivery-settings") });

  const saveSettings = useMutation({
    mutationFn: (body: Partial<Settings>) => customFetch<Settings>("/api/admin/delivery-settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-delivery-settings"] }); toast.success("Saved"); },
    onError: err => toast.error(errorMessage(err)),
  });

  const startPayout = useMutation({
    mutationFn: (id: number) => customFetch<{ status: string }>(`/api/admin/delivery-orders/${id}/payout`, { method: "POST" }),
    onSuccess: r => { refresh(); toast.success(r.status === "awaiting_otp" ? "Paystack sent you a code. Enter it below." : "Payout started"); },
    onError: err => { refresh(); toast.error(errorMessage(err)); },
  });
  const resend = useMutation({
    mutationFn: (id: number) => customFetch(`/api/admin/delivery-orders/${id}/resend-otp`, { method: "POST" }),
    onSuccess: () => toast.success("A new code was sent"),
    onError: err => toast.error(errorMessage(err)),
  });

  const [otpFor, setOtpFor] = useState<Job | null>(null);
  const [otp, setOtp] = useState("");
  const sendOtp = useMutation({
    mutationFn: () => customFetch(`/api/admin/delivery-orders/${otpFor!.id}/otp`, { method: "POST", body: JSON.stringify({ otp }) }),
    onSuccess: () => { refresh(); setOtpFor(null); setOtp(""); toast.success("Payout sent"); },
    onError: err => toast.error(errorMessage(err)),
  });

  const [resolving, setResolving] = useState<Dispute | null>(null);
  const [resolution, setResolution] = useState<"pay_company" | "refund_customer" | "split">("pay_company");
  const [refundNaira, setRefundNaira] = useState("");
  const [note, setNote] = useState("");
  const resolve = useMutation({
    mutationFn: () => customFetch(`/api/admin/delivery-disputes/${resolving!.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution, note: note || undefined, ...(resolution === "split" ? { refundNaira: Number(refundNaira) } : {}) }),
    }),
    onSuccess: () => { refresh(); setResolving(null); setNote(""); setRefundNaira(""); toast.success("Dispute resolved"); },
    onError: err => toast.error(errorMessage(err)),
  });

  const openDisputes = (disputes.data ?? []).filter(d => d.status === "open");
  const needsReview = (jobs.data ?? []).filter(j => j.needsReview);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Delivery jobs and payouts</h1>
        <p className="text-sm text-gray-500 mt-1">Customers pay DodoLink first. After delivery is confirmed you send the company 90%, less Paystack fees.</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <h2 className="font-semibold text-gray-900">Payout settings</h2>
          {settings.data ? (
            <>
              <label className="flex items-start gap-2 text-sm text-gray-900">
                <input type="radio" name="mode" className="mt-1" checked={settings.data.payoutMode === "manual_otp"} onChange={() => saveSettings.mutate({ payoutMode: "manual_otp" })} />
                <span><span className="font-medium">With my Paystack code (recommended)</span> <span className="text-gray-500">You tap Pay out, then type the code Paystack sends you. Your transfer OTP stays on.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-900">
                <input type="radio" name="mode" className="mt-1" checked={settings.data.payoutMode === "automatic"} onChange={() => saveSettings.mutate({ payoutMode: "automatic" })} />
                <span><span className="font-medium">Automatic</span> <span className="text-gray-500">Only works if the transfer OTP is turned off in Paystack.</span></span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-900">
                <input type="checkbox" checked={settings.data.payoutsPaused} onChange={e => saveSettings.mutate({ payoutsPaused: e.target.checked })} />
                Pause all payouts (emergency switch)
              </label>
            </>
          ) : <Skeleton className="h-16 w-full" />}
        </CardContent>
      </Card>

      {(openDisputes.length > 0 || needsReview.length > 0) && (
        <section className="space-y-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" />Needs your decision</h2>
          {openDisputes.map(d => (
            <Card key={d.id}>
              <CardContent className="py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-gray-900">Job #{d.orderId} · {d.companyName} · {naira(d.amountKobo)}</p>
                  <p className="text-gray-500">{d.pickupState} to {d.dropState} · reported by the {d.openedByRole}</p>
                  <p className="text-gray-900 mt-1">“{d.reason}”</p>
                </div>
                <Button size="sm" onClick={() => { setResolving(d); setResolution("pay_company"); }}>Resolve</Button>
              </CardContent>
            </Card>
          ))}
          {needsReview.map(j => (
            <Card key={`r${j.id}`}>
              <CardContent className="py-4 text-sm">
                <p className="font-medium text-gray-900">Job #{j.id} · {j.companyName} · {naira(j.amountKobo)}</p>
                <p className="text-gray-500">Paid more than 3 days ago and nobody confirmed delivery. Contact them, or wait for a problem report to decide.</p>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-gray-900">All jobs</h2>
        {jobs.isLoading ? <Skeleton className="h-20 w-full" /> : (jobs.data ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">No delivery jobs yet.</p>
        ) : (jobs.data ?? []).map(j => (
          <Card key={j.id}>
            <CardContent className="py-4 flex items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <PackageCheck className="w-5 h-5 text-green-700 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-gray-900">
                    Job #{j.id} · {j.companyName} · {naira(j.amountKobo)}
                    {j.disputeOpen && <span className="ml-2 text-xs rounded-full bg-red-100 px-2 py-0.5 text-red-700">Problem</span>}
                  </p>
                  <p className="text-gray-500">{j.pickupState} to {j.dropState} · {STATUS_LABEL[j.status] ?? j.status}</p>
                  {j.status === "delivered" && (
                    <p className="text-gray-500">
                      Company gets {naira(j.companyReceivesKobo)} (DodoLink keeps {naira(j.platformFeeKobo)}) · {PAYOUT_LABEL[j.payoutStatus] ?? j.payoutStatus}
                    </p>
                  )}
                  {j.payoutError && j.payoutStatus === "failed" && <p className="text-red-600">{j.payoutError}</p>}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {j.status === "delivered" && (j.payoutStatus === "queued" || j.payoutStatus === "failed") && (
                  <Button size="sm" disabled={startPayout.isPending} onClick={() => startPayout.mutate(j.id)}>Pay out</Button>
                )}
                {j.payoutStatus === "awaiting_otp" && (
                  <>
                    <Button size="sm" onClick={() => { setOtpFor(j); setOtp(""); }}>Enter code</Button>
                    <Button size="sm" variant="outline" onClick={() => resend.mutate(j.id)}>Resend</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Dialog open={!!otpFor} onOpenChange={open => !open && setOtpFor(null)}>
        <DialogContent className="bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle>Enter the Paystack code</DialogTitle>
            <DialogDescription>Paystack sent a one-time code to your phone or email for the payout on job #{otpFor?.id}.</DialogDescription>
          </DialogHeader>
          <Input inputMode="numeric" placeholder="Code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtpFor(null)}>Cancel</Button>
            <Button disabled={otp.length < 4 || sendOtp.isPending} onClick={() => sendOtp.mutate()}>{sendOtp.isPending ? "Sending…" : "Send payout"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolving} onOpenChange={open => !open && setResolving(null)}>
        <DialogContent className="bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle>Resolve problem on job #{resolving?.orderId}</DialogTitle>
            <DialogDescription>{resolving ? `${naira(resolving.amountKobo)} · “${resolving.reason}”` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {([
              ["pay_company", "Pay the company", "Delivery happened. The payout is released as normal."],
              ["refund_customer", "Refund the customer in full", "Delivery did not happen. Paystack returns the money."],
              ["split", "Split", "Refund part to the customer; the company gets the rest."],
            ] as const).map(([value, title, help]) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer">
                <input type="radio" className="mt-1" checked={resolution === value} onChange={() => setResolution(value)} />
                <span><span className="font-medium">{title}</span> <span className="text-gray-500">{help}</span></span>
              </label>
            ))}
            {resolution === "split" && (
              <Input inputMode="numeric" placeholder="Naira to refund the customer" value={refundNaira} onChange={e => setRefundNaira(e.target.value.replace(/\D/g, ""))} />
            )}
            <Input placeholder="Note (optional, kept for your records)" value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolving(null)}>Cancel</Button>
            <Button disabled={resolve.isPending || (resolution === "split" && !refundNaira)} onClick={() => resolve.mutate()}>{resolve.isPending ? "Saving…" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
