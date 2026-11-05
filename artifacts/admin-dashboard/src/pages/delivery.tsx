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
import { Truck, Plus, Pencil, Upload } from "lucide-react";

type DeliveryType = "intrastate" | "interstate" | "both";
type Agent = {
  id: number; name: string; phone: string; imageUrl: string | null; bio: string | null;
  linkedUserId: string | null; deliveryType: DeliveryType; homeState: string | null;
  coveredStates: string[]; nationwide: boolean; bankName: string | null;
  bankCode: string | null; bankAccountNumber: string | null; bankAccountName: string | null; active: boolean;
  qualifiedAt?: string | null; subscriptionDueAt?: string | null; subscriptionExempt?: boolean;
};
type Form = {
  imageUrl: string; name: string; phone: string; bio: string; accountEmail: string; deliveryType: DeliveryType;
  homeState: string; coveredStates: string[]; nationwide: boolean;
  bankName: string; bankCode: string; bankAccountNumber: string; active: boolean;
};

const EMPTY: Form = {
  imageUrl: "", name: "", phone: "", bio: "", accountEmail: "", deliveryType: "intrastate",
  homeState: "", coveredStates: [], nationwide: false,
  bankName: "", bankCode: "", bankAccountNumber: "", active: true,
};

const TYPE_LABEL: Record<DeliveryType, string> = {
  intrastate: "Intrastate", interstate: "Interstate", both: "Both",
};
const TYPE_HELP: Record<DeliveryType, string> = {
  intrastate: "Delivers inside one state.",
  interstate: "Delivers between states.",
  both: "Delivers inside his home state and between states.",
};

function errorMessage(err: unknown): string {
  const e = err as { data?: { error?: string }; message?: string } | undefined;
  return e?.data?.error ?? e?.message ?? "Something went wrong";
}

function coverage(a: Agent): string {
  const parts: string[] = [];
  if (a.deliveryType !== "interstate" && a.homeState) parts.push(a.homeState);
  if (a.deliveryType !== "intrastate") parts.push(a.nationwide ? "Nationwide" : a.coveredStates.join(", "));
  return parts.join(" · ");
}

export default function DeliveryPage() {
  const queryClient = useQueryClient();
  const agents = useQuery({
    queryKey: ["admin-delivery-agents"],
    queryFn: () => customFetch<Agent[]>("/api/admin/delivery-agents"),
  });
  const meta = useQuery({
    queryKey: ["delivery-meta"],
    queryFn: () => customFetch<{ states: string[] }>("/api/delivery/meta"),
    staleTime: Infinity,
  });
  const states = meta.data?.states ?? [];
  const banks = useQuery({
    queryKey: ["delivery-banks"],
    queryFn: () => customFetch<{ name: string; code: string }[]>("/api/admin/delivery-banks"),
    staleTime: 6 * 60 * 60 * 1000,
    retry: 0,
  });
  const [uploading, setUploading] = useState(false);
  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>("/api/storage/uploads/request-url", {
        method: "POST",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("upload failed");
      set("imageUrl", objectPath);
    } catch (err) {
      toast.error(errorMessage(err) === "Something went wrong" || /upload/i.test(String((err as Error)?.message))
        ? "The logo upload failed. Check the file is a photo under 10 MB and try again." : errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const [editing, setEditing] = useState<Agent | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(f => ({ ...f, [key]: value }));

  const openNew = () => { setForm(EMPTY); setEditing("new"); };
  const openEdit = (a: Agent) => {
    setForm({
      imageUrl: a.imageUrl ?? "", name: a.name, phone: a.phone, bio: a.bio ?? "", accountEmail: "",
      deliveryType: a.deliveryType, homeState: a.homeState ?? "", coveredStates: a.coveredStates,
      nationwide: a.nationwide, bankName: a.bankName ?? "", bankCode: a.bankCode ?? "",
      bankAccountNumber: a.bankAccountNumber ?? "", active: a.active,
    });
    setEditing(a);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        ...form, imageUrl: form.imageUrl || null, homeState: form.homeState || null, bio: form.bio || null,
        accountEmail: form.accountEmail || null, bankName: form.bankName || null, bankCode: form.bankCode || null,
        bankAccountNumber: form.bankAccountNumber || null,
      });
      return editing === "new"
        ? customFetch("/api/admin/delivery-agents", { method: "POST", body })
        : customFetch(`/api/admin/delivery-agents/${(editing as Agent).id}`, { method: "PATCH", body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-delivery-agents"] });
      toast.success("Saved");
      setEditing(null);
    },
    onError: err => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => customFetch(`/api/admin/delivery-agents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-delivery-agents"] });
      toast.success("Company deleted");
      setEditing(null);
    },
    onError: err => toast.error(errorMessage(err)),
  });
  const confirmDelete = () => {
    if (!editing || editing === "new") return;
    if (window.confirm(`Delete ${editing.name}? Its chats and ratings are removed. This cannot be undone.`)) remove.mutate(editing.id);
  };

  const setExempt = useMutation({
    mutationFn: (v: { id: number; exempt: boolean }) =>
      customFetch(`/api/admin/delivery-agents/${v.id}/exempt`, { method: "PATCH", body: JSON.stringify({ exempt: v.exempt }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["admin-delivery-agents"] }); toast.success("Saved"); },
    onError: err => toast.error(errorMessage(err)),
  });
  const subscriptionLine = (a: Agent) =>
    a.subscriptionExempt ? "Subscription: free of charge"
    : a.subscriptionDueAt && new Date(a.subscriptionDueAt) > new Date() ? `Subscription paid until ${new Date(a.subscriptionDueAt).toLocaleDateString("en-NG")}`
    : a.qualifiedAt ? "Subscription due, not paid" : "Subscription: not started";

  const needsHome = form.deliveryType !== "interstate";
  const needsStates = form.deliveryType !== "intrastate";
  const toggleState = (s: string) =>
    set("coveredStates", form.coveredStates.includes(s) ? form.coveredStates.filter(x => x !== s) : [...form.coveredStates, s]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Delivery companies</h1>
          <p className="text-sm text-gray-600 mt-1">
            Only you can add delivery companies. Users see the company name, logo, rating and delivery type, never the phone number. Each company logs in with the email you enter.
          </p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add delivery company</Button>
      </div>

      {agents.isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="space-y-3">
          {(agents.data ?? []).map(a => (
            <Card key={a.id}>
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-green-100 text-green-800 flex items-center justify-center flex-shrink-0">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {a.name}
                      <span className="ml-2 text-xs rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{TYPE_LABEL[a.deliveryType]}</span>
                      {!a.active && <span className="ml-2 text-xs rounded-full bg-red-100 px-2 py-0.5 text-red-700">Inactive</span>}
                    </p>
                    <p className="text-xs text-gray-600 truncate">
                      {coverage(a)} · {a.phone} · {a.linkedUserId ? "login linked" : "no login linked (cannot chat yet)"}
                    </p>
                    <p className="text-xs text-gray-600 truncate">{subscriptionLine(a)}</p>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm" disabled={setExempt.isPending} onClick={() => setExempt.mutate({ id: a.id, exempt: !a.subscriptionExempt })}>
                    {a.subscriptionExempt ? "Charge" : "Make free"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(a)}><Pencil className="w-4 h-4 mr-1.5" />Edit</Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(agents.data ?? []).length === 0 && <p className="text-sm text-gray-600">No delivery people yet.</p>}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add delivery company" : "Edit delivery company"}</DialogTitle>
            <DialogDescription>Fields marked * are required.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={e => { e.preventDefault(); save.mutate(); }}
          >
            <div className="flex items-center gap-3">
              {form.imageUrl ? (
                <img src={`/api/storage${form.imageUrl}`} alt="Company logo" className="w-16 h-16 rounded-full object-cover border border-gray-200" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-600"><Truck className="w-6 h-6" /></div>
              )}
              <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-900 cursor-pointer rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50">
                <Upload className="w-4 h-4" />
                {uploading ? "Uploading…" : form.imageUrl ? "Change company picture" : "Add company picture"}
                <input
                  type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }}
                />
              </label>
            </div>
            <Input required placeholder="Company name *" value={form.name} onChange={e => set("name", e.target.value)} />
            <Input required placeholder="Company phone number * (hidden from users)" value={form.phone} onChange={e => set("phone", e.target.value)} />
            <Input
              type="email"
              required={editing === "new"}
              placeholder={editing === "new" ? "Login email * (the company signs up in the app with this email first)" : "Login email (leave empty to keep the current one)"}
              value={form.accountEmail}
              onChange={e => set("accountEmail", e.target.value)}
            />
            <Input placeholder="Short description (optional)" value={form.bio} onChange={e => set("bio", e.target.value)} />

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">Delivery type *</legend>
              {(["intrastate", "interstate", "both"] as DeliveryType[]).map(t => (
                <label key={t} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="radio" name="deliveryType" className="mt-1" checked={form.deliveryType === t} onChange={() => set("deliveryType", t)} />
                  <span><span className="font-medium">{TYPE_LABEL[t]}</span> <span className="text-gray-600">{TYPE_HELP[t]}</span></span>
                </label>
              ))}
            </fieldset>

            {needsHome && (
              <label className="block text-sm">
                <span className="font-medium text-gray-900">Home state *</span>
                <select
                  required
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  value={form.homeState}
                  onChange={e => set("homeState", e.target.value)}
                >
                  <option value="">Choose a state</option>
                  {states.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            )}

            {needsStates && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-gray-900">States he delivers to *</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.nationwide} onChange={e => set("nationwide", e.target.checked)} />
                  Nationwide (all states)
                </label>
                {!form.nationwide && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-44 overflow-y-auto rounded-md border border-gray-200 p-2">
                    {states.map(s => (
                      <label key={s} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.coveredStates.includes(s)} onChange={() => toggleState(s)} />
                        {s}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">Company bank account for payouts</legend>
              <select
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                value={form.bankCode}
                onChange={e => {
                  const bank = (banks.data ?? []).find(b => b.code === e.target.value);
                  set("bankCode", e.target.value); set("bankName", bank?.name ?? "");
                }}
              >
                <option value="">{banks.isLoading ? "Loading banks…" : banks.isError ? "Could not load banks" : "Choose the bank"}</option>
                {(banks.data ?? []).map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
              <Input inputMode="numeric" maxLength={10} placeholder="10-digit account number" value={form.bankAccountNumber} onChange={e => set("bankAccountNumber", e.target.value.replace(/\D/g, ""))} />
              <p className="text-xs text-gray-600">When you save, Paystack checks the account and we keep the real account name. A wrong number is rejected.</p>
              {editing && editing !== "new" && editing.bankAccountName && (
                <p className="text-xs text-green-700">Verified account name: {editing.bankAccountName}</p>
              )}
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={e => set("active", e.target.checked)} />
              Active (visible to users)
            </label>

            <DialogFooter>
              {editing && editing !== "new" && (
                <Button type="button" variant="destructive" className="sm:mr-auto" disabled={remove.isPending} onClick={confirmDelete}>
                  {remove.isPending ? "Deleting…" : "Delete company"}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
