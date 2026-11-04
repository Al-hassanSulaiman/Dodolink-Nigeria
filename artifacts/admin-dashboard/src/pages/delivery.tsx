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
import { Truck, Plus, Pencil } from "lucide-react";

type DeliveryType = "intrastate" | "interstate" | "both";
type Agent = {
  id: number; name: string; phone: string; imageUrl: string | null; bio: string | null;
  linkedUserId: string | null; deliveryType: DeliveryType; homeState: string | null;
  coveredStates: string[]; nationwide: boolean; bankName: string | null;
  bankCode: string | null; bankAccountNumber: string | null; bankAccountName: string | null; active: boolean;
};
type Form = {
  name: string; phone: string; bio: string; imageUrl: string; accountEmail: string; deliveryType: DeliveryType;
  homeState: string; coveredStates: string[]; nationwide: boolean;
  bankName: string; bankCode: string; bankAccountNumber: string; active: boolean;
};

const EMPTY: Form = {
  name: "", phone: "", bio: "", imageUrl: "", accountEmail: "", deliveryType: "intrastate",
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
  const banks = useQuery({
    queryKey: ["delivery-banks"],
    queryFn: () => customFetch<{ name: string; code: string }[]>("/api/admin/delivery/banks"),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const states = meta.data?.states ?? [];
  const [uploading, setUploading] = useState(false);

  const uploadPicture = async (file: File) => {
    setUploading(true);
    try {
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>("/api/storage/uploads/request-url", {
        method: "POST", body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("upload failed");
      setForm(f => ({ ...f, imageUrl: objectPath }));
    } catch {
      toast.error("Could not upload the picture. You can paste a link to the picture instead.");
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
      name: a.name, phone: a.phone, bio: a.bio ?? "", imageUrl: a.imageUrl ?? "", accountEmail: "",
      deliveryType: a.deliveryType, homeState: a.homeState ?? "", coveredStates: a.coveredStates,
      nationwide: a.nationwide, bankName: a.bankName ?? "", bankCode: a.bankCode ?? "",
      bankAccountNumber: a.bankAccountNumber ?? "", active: a.active,
    });
    setEditing(a);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        ...form, homeState: form.homeState || null, bio: form.bio || null,
        accountEmail: form.accountEmail || null,
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

  const needsHome = form.deliveryType !== "interstate";
  const needsStates = form.deliveryType !== "intrastate";
  const toggleState = (s: string) =>
    set("coveredStates", form.coveredStates.includes(s) ? form.coveredStates.filter(x => x !== s) : [...form.coveredStates, s]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Delivery companies</h1>
          <p className="text-sm text-gray-500 mt-1">
            Only you can add delivery companies. Users see the company name, picture, delivery type and rating, never the phone number.
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
                  {a.imageUrl ? (
                    <img src={a.imageUrl.startsWith("http") ? a.imageUrl : `/api/storage${a.imageUrl}`} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-green-100 text-green-800 flex items-center justify-center flex-shrink-0">
                      <Truck className="w-5 h-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {a.name}
                      <span className="ml-2 text-xs rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{TYPE_LABEL[a.deliveryType]}</span>
                      {!a.active && <span className="ml-2 text-xs rounded-full bg-red-100 px-2 py-0.5 text-red-700">Inactive</span>}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {coverage(a)} · {a.phone} · {a.linkedUserId ? "account linked" : "no account linked (cannot chat yet)"}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => openEdit(a)}><Pencil className="w-4 h-4 mr-1.5" />Edit</Button>
              </CardContent>
            </Card>
          ))}
          {(agents.data ?? []).length === 0 && <p className="text-sm text-gray-500">No delivery companies yet.</p>}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-white text-gray-900">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add delivery company" : "Edit delivery company"}</DialogTitle>
            <DialogDescription>Fields marked * are required.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={e => { e.preventDefault(); save.mutate(); }}
          >
            <Input required placeholder="Company name *" value={form.name} onChange={e => set("name", e.target.value)} />
            <Input required placeholder="Company phone number * (hidden from users)" value={form.phone} onChange={e => set("phone", e.target.value)} />
            <Input
              type="email"
              placeholder={editing === "new" ? "The email the company will log in with (it must already have a DodoLink account)" : "Account email (leave empty to keep the current link)"}
              value={form.accountEmail}
              onChange={e => set("accountEmail", e.target.value)}
            />
            <Input placeholder="Short description (optional)" value={form.bio} onChange={e => set("bio", e.target.value)} />

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">Company picture</legend>
              <div className="flex items-center gap-3">
                {form.imageUrl ? (
                  <img
                    src={form.imageUrl.startsWith("http") ? form.imageUrl : `/api/storage${form.imageUrl}`}
                    alt="Company"
                    className="w-14 h-14 rounded-full object-cover border border-gray-200"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-gray-400"><Truck className="w-6 h-6" /></div>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadPicture(f); }}
                  className="text-sm text-gray-900"
                />
              </div>
              {uploading && <p className="text-xs text-gray-500">Uploading…</p>}
              <Input placeholder="…or paste a link to the picture" value={form.imageUrl.startsWith("/objects") ? "" : form.imageUrl} onChange={e => set("imageUrl", e.target.value)} />
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">Delivery type *</legend>
              {(["intrastate", "interstate", "both"] as DeliveryType[]).map(t => (
                <label key={t} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="radio" name="deliveryType" className="mt-1" checked={form.deliveryType === t} onChange={() => set("deliveryType", t)} />
                  <span><span className="font-medium">{TYPE_LABEL[t]}</span> <span className="text-gray-500">{TYPE_HELP[t]}</span></span>
                </label>
              ))}
            </fieldset>

            {needsHome && (
              <label className="block text-sm">
                <span className="font-medium text-gray-900">Home state *</span>
                <select
                  required
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
                <legend className="text-sm font-medium text-gray-900">States the company delivers to *</legend>
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
              <legend className="text-sm font-medium text-gray-900">Company bank account for payouts (checked with the bank when you save)</legend>
              <select
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                value={form.bankCode}
                onChange={e => {
                  const bank = (banks.data ?? []).find(b => b.code === e.target.value);
                  setForm(f => ({ ...f, bankCode: e.target.value, bankName: bank?.name ?? "" }));
                }}
              >
                <option value="">{banks.isLoading ? "Loading banks…" : "Choose the bank"}</option>
                {(banks.data ?? []).map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
              </select>
              <Input placeholder="Account number (10 digits)" inputMode="numeric" maxLength={10} value={form.bankAccountNumber} onChange={e => set("bankAccountNumber", e.target.value.replace(/\D/g, ""))} />
              {editing !== "new" && editing && (editing as Agent).bankAccountName && (
                <p className="text-xs text-gray-600">Verified account name: <span className="font-medium">{(editing as Agent).bankAccountName}</span></p>
              )}
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={e => set("active", e.target.checked)} />
              Active (visible to users)
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
