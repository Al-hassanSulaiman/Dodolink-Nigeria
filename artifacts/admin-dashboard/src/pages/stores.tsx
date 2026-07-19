import { useState } from "react";
import {
  useAdminListStores,
  useAdminVerifyStore,
  useAdminRejectStore,
  useAdminUpdateStore,
  getAdminListStoresQueryKey,
  getAdminGetAnalyticsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle,
  XCircle,
  Store,
  Phone,
  MapPin,
  FileText,
  User,
  ShieldCheck,
  CreditCard,
  EyeOff,
  Clock,
  Pencil,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

const GRACE_PERIOD_DAYS = 14;

function getSubscriptionInfo(store: {
  qualifiedAt?: string | null;
  subscriptionStatus?: string | null;
  subscriptionDueAt?: string | null;
}) {
  const qualifiedAt = store.qualifiedAt ? new Date(store.qualifiedAt) : null;
  const status = store.subscriptionStatus ?? "inactive";

  if (!qualifiedAt) return { label: "Not qualified", color: "gray", hidden: false, daysLeft: null };
  if (status === "active") return { label: "Active", color: "green", hidden: false, daysLeft: null };
  // Missed renewal — hidden immediately, no grace
  if (status === "past_due") return { label: "Hidden – not paid", color: "red", hidden: true, daysLeft: null };

  // Initial qualification only (inactive = never paid): 14-day grace from qualifiedAt
  const expiresAt = new Date(qualifiedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const msLeft = expiresAt.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

  if (daysLeft <= 0) return { label: "Hidden – not paid", color: "red", hidden: true, daysLeft: 0 };
  return {
    label: "Grace period",
    color: daysLeft <= 3 ? "red" : daysLeft <= 7 ? "amber" : "blue",
    hidden: false,
    daysLeft,
  };
}

type VerificationStatus = "pending" | "verified" | "rejected";

export default function StoresPage() {
  const [tab, setTab] = useState<VerificationStatus>("pending");
  const [rejectStoreId, setRejectStoreId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editStoreId, setEditStoreId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const queryClient = useQueryClient();

  const { data: stores, isLoading } = useAdminListStores({ status: tab, limit: 100 });

  const verifyMutation = useAdminVerifyStore({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListStoresQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminGetAnalyticsQueryKey() });
        toast.success("Store verified successfully");
      },
      onError: () => toast.error("Failed to verify store"),
    },
  });

  const rejectMutation = useAdminRejectStore({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListStoresQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminGetAnalyticsQueryKey() });
        setRejectStoreId(null);
        setRejectReason("");
        toast.success("Store rejected");
      },
      onError: () => toast.error("Failed to reject store"),
    },
  });

  const updateMutation = useAdminUpdateStore({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListStoresQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminGetAnalyticsQueryKey() });
        setEditStoreId(null);
        toast.success("Store updated — name and location are now locked for the owner");
      },
      onError: () => toast.error("Failed to update store"),
    },
  });

  function handleVerify(storeId: number) {
    verifyMutation.mutate({ storeId });
  }

  function openEdit(store: { id: number; name: string; location: string }) {
    setEditStoreId(store.id);
    setEditName(store.name);
    setEditLocation(store.location);
  }

  function handleEditSubmit() {
    if (!editStoreId) return;
    if (!editName.trim() || !editLocation.trim()) {
      toast.error("Name and location cannot be empty");
      return;
    }
    updateMutation.mutate({
      storeId: editStoreId,
      data: { name: editName.trim(), location: editLocation.trim() },
    });
  }

  function handleRejectSubmit() {
    if (!rejectStoreId) return;
    if (!rejectReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }
    rejectMutation.mutate({ storeId: rejectStoreId, data: { reason: rejectReason.trim() } });
  }

  const tabLabels: Record<VerificationStatus, string> = {
    pending: "Pending",
    verified: "Verified",
    rejected: "Rejected",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Store Management</h2>
        <p className="text-gray-500 text-sm mt-1">Review and approve retailer applications</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as VerificationStatus)}>
        <TabsList className="bg-gray-100">
          {(["pending", "verified", "rejected"] as VerificationStatus[]).map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">
              {tabLabels[t]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading && (
        <div className="grid gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && stores && stores.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Store className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">No {tab} stores</p>
        </div>
      )}

      {!isLoading && stores && stores.length > 0 && (
        <div className="grid gap-4">
          {stores.map((store) => (
            <Card key={store.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-base font-semibold text-gray-900 truncate">{store.name}</h3>
                      <Badge
                        className={
                          store.verificationStatus === "verified"
                            ? "bg-green-100 text-green-800 border-green-200"
                            : store.verificationStatus === "rejected"
                            ? "bg-red-100 text-red-800 border-red-200"
                            : "bg-amber-100 text-amber-800 border-amber-200"
                        }
                        variant="outline"
                      >
                        {store.verificationStatus}
                      </Badge>
                      {store.detailsLockedByAdmin && (
                        <Badge className="bg-gray-100 text-gray-700 border-gray-200" variant="outline">
                          <Lock className="w-3 h-3 mr-1" />
                          Name & location locked
                        </Badge>
                      )}
                      {/* Subscription badge — only relevant for verified stores */}
                      {store.verificationStatus === "verified" && (() => {
                        const sub = getSubscriptionInfo(store);
                        const cls =
                          sub.color === "green" ? "bg-green-100 text-green-800 border-green-200" :
                          sub.color === "red"   ? "bg-red-100 text-red-800 border-red-200" :
                          sub.color === "amber" ? "bg-amber-100 text-amber-800 border-amber-200" :
                          sub.color === "blue"  ? "bg-blue-100 text-blue-800 border-blue-200" :
                                                  "bg-gray-100 text-gray-500 border-gray-200";
                        return (
                          <Badge className={cls} variant="outline">
                            <CreditCard className="w-3 h-3 mr-1" />
                            {sub.label}
                          </Badge>
                        );
                      })()}
                    </div>
                    <p className="text-sm text-gray-600 line-clamp-2 mb-3">{store.description}</p>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-gray-400" />
                        <span className="truncate">{store.ownerName}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-gray-400" />
                        <span className="truncate">{store.location}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-gray-400" />
                        <span>{store.phone}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                        <span className={store.cacNumber ? "font-mono" : "italic text-gray-400"}>
                          {store.cacNumber ?? "No CAC number"}
                        </span>
                      </div>
                    </div>

                    {store.verificationStatus === "rejected" && store.rejectionReason && (
                      <div className="mt-3 p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
                        <span className="font-medium">Rejection reason:</span> {store.rejectionReason}
                      </div>
                    )}

                    {store.verificationStatus === "verified" && store.verifiedAt && (
                      <div className="mt-3 flex items-center gap-1.5 text-xs text-green-700">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Verified on {new Date(store.verifiedAt).toLocaleDateString()}
                      </div>
                    )}

                    {/* Paystack subscription detail for verified stores */}
                    {store.verificationStatus === "verified" && store.qualifiedAt && (
                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                          <span className="font-medium text-gray-600">Last paid:</span>
                          {store.subscriptionLastPaidAt
                            ? new Date(store.subscriptionLastPaidAt).toLocaleDateString()
                            : <span className="italic">Never</span>}
                        </span>
                        {store.subscriptionDueAt && store.subscriptionStatus === "active" && (
                          <span>
                            <span className="font-medium text-gray-600">Renews:</span>{" "}
                            {new Date(store.subscriptionDueAt).toLocaleDateString()}
                          </span>
                        )}
                        <span className={`flex items-center gap-1 font-medium ${store.autoPayEnabled ? "text-green-600" : "text-gray-400"}`}>
                          {store.autoPayEnabled ? "✓ Auto-pay on" : "Auto-pay off"}
                        </span>
                      </div>
                    )}

                    {/* Subscription detail row for verified stores */}
                    {store.verificationStatus === "verified" && (() => {
                      const sub = getSubscriptionInfo(store);

                      if (sub.hidden) return (
                        <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-100 rounded-md px-2.5 py-1.5">
                          <EyeOff className="w-3.5 h-3.5 flex-shrink-0" />
                          Store is hidden from customers — subscription unpaid after 14-day grace period
                        </div>
                      );

                      if (sub.daysLeft !== null) return (
                        <div className={`mt-2 flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5 border ${
                          sub.color === "red"   ? "text-red-700 bg-red-50 border-red-100" :
                          sub.color === "amber" ? "text-amber-700 bg-amber-50 border-amber-100" :
                                                  "text-blue-700 bg-blue-50 border-blue-100"
                        }`}>
                          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                          {sub.daysLeft === 0
                            ? "Grace period ends today — store will be hidden if unpaid"
                            : `${sub.daysLeft} day${sub.daysLeft === 1 ? "" : "s"} left in 14-day grace period before store goes hidden`}
                        </div>
                      );

                      return null;
                    })()}

                    <p className="mt-2 text-xs text-gray-400">
                      Category: <span className="font-medium text-gray-500">{store.category}</span>
                      {" · "}Applied {new Date(store.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  {store.imageUrl && (
                    <img
                      src={store.imageUrl}
                      alt={store.name}
                      className="w-16 h-16 rounded-xl object-cover flex-shrink-0 border border-gray-100"
                    />
                  )}
                </div>

                {tab === "pending" && (
                  <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                    <Button
                      size="sm"
                      className="bg-green-700 hover:bg-green-800 text-white"
                      onClick={() => handleVerify(store.id)}
                      disabled={verifyMutation.isPending}
                    >
                      <CheckCircle className="w-4 h-4 mr-1.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { setRejectStoreId(store.id); setRejectReason(""); }}
                    >
                      <XCircle className="w-4 h-4 mr-1.5" />
                      Reject
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(store)}>
                      <Pencil className="w-4 h-4 mr-1.5" />
                      Edit name / location
                    </Button>
                  </div>
                )}

                {tab === "verified" && (
                  <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { setRejectStoreId(store.id); setRejectReason(""); }}
                    >
                      <XCircle className="w-4 h-4 mr-1.5" />
                      Revoke
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(store)}>
                      <Pencil className="w-4 h-4 mr-1.5" />
                      Edit name / location
                    </Button>
                  </div>
                )}

                {tab === "rejected" && (
                  <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                    <Button
                      size="sm"
                      className="bg-green-700 hover:bg-green-800 text-white"
                      onClick={() => handleVerify(store.id)}
                      disabled={verifyMutation.isPending}
                    >
                      <CheckCircle className="w-4 h-4 mr-1.5" />
                      Re-approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(store)}>
                      <Pencil className="w-4 h-4 mr-1.5" />
                      Edit name / location
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editStoreId !== null} onOpenChange={(o) => { if (!o) setEditStoreId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Store Name & Location</DialogTitle>
            <DialogDescription>
              This updates the store everywhere in the app. After saving, the store owner will no
              longer be able to change the name or location themselves.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Store name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Store name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-location">Location</Label>
              <Input
                id="edit-location"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="e.g. Kaduna, Nigeria"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStoreId(null)}>
              Cancel
            </Button>
            <Button
              className="bg-green-700 hover:bg-green-800 text-white"
              onClick={handleEditSubmit}
              disabled={updateMutation.isPending || !editName.trim() || !editLocation.trim()}
            >
              {updateMutation.isPending ? "Saving…" : "Save & Lock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectStoreId !== null} onOpenChange={(o) => { if (!o) setRejectStoreId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Store Application</DialogTitle>
            <DialogDescription>
              Provide a reason for rejection. This will be visible to the store owner.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="reason">Rejection Reason</Label>
            <Textarea
              id="reason"
              placeholder="e.g. Invalid CAC number provided, please resubmit with correct documentation."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectStoreId(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleRejectSubmit}
              disabled={rejectMutation.isPending || !rejectReason.trim()}
            >
              {rejectMutation.isPending ? "Rejecting…" : "Reject Store"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
