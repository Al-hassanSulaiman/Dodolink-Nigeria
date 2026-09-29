import { useState } from "react";
import {
  useAdminListAdmins,
  useAdminAddAdmin,
  useAdminRemoveAdmin,
  getAdminListAdminsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ShieldCheck, UserPlus, Trash2 } from "lucide-react";
import ReviewAccessSection from "./review-access";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function errorMessage(err: unknown): string {
  const anyErr = err as { error?: string; message?: string } | undefined;
  return anyErr?.error ?? anyErr?.message ?? "Something went wrong";
}

export default function AdminsPage() {
  const queryClient = useQueryClient();
  const { data: admins, isLoading } = useAdminListAdmins();

  const [email, setEmail] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{ id: number; email: string } | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getAdminListAdminsQueryKey() });

  const addMutation = useAdminAddAdmin({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEmail("");
        toast.success("Admin access granted");
      },
      onError: (err) => toast.error(errorMessage(err)),
    },
  });

  const removeMutation = useAdminRemoveAdmin({
    mutation: {
      onSuccess: () => {
        invalidate();
        setRemoveTarget(null);
        toast.success("Admin access revoked");
      },
      onError: (err) => toast.error(errorMessage(err)),
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    addMutation.mutate({ data: { email: trimmed } });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admins</h1>
        <p className="text-sm text-gray-500 mt-1">
          People with these emails can sign in to this admin console. Grant or revoke access here.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3">
            <Input
              type="email"
              required
              placeholder="new-admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="sm:max-w-sm"
            />
            <Button type="submit" disabled={addMutation.isPending || !email.trim()}>
              <UserPlus className="w-4 h-4 mr-2" />
              {addMutation.isPending ? "Adding…" : "Grant admin access"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(admins ?? []).map((admin) => (
            <Card key={admin.id}>
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-green-100 text-green-800 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{admin.email}</p>
                    <p className="text-xs text-gray-500">
                      Added {formatDate(admin.createdAt)}
                      {admin.addedBy === "bootstrap" ? " · original owner" : ""}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700 flex-shrink-0"
                  onClick={() => setRemoveTarget({ id: admin.id, email: admin.email })}
                  disabled={(admins ?? []).length <= 1}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Revoke
                </Button>
              </CardContent>
            </Card>
          ))}
          {(admins ?? []).length === 0 && (
            <p className="text-sm text-gray-500">No admins found.</p>
          )}
        </div>
      )}

      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke admin access?</DialogTitle>
            <DialogDescription>
              {removeTarget?.email} will immediately lose access to this admin console. You can
              grant access again at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => removeTarget && removeMutation.mutate({ adminId: removeTarget.id })}
            >
              {removeMutation.isPending ? "Revoking…" : "Revoke access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReviewAccessSection />
    </div>
  );
}
