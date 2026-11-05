import { useState } from "react";
import {
  useAdminListAdmins,
  useAdminRemoveAdmin,
  getAdminListAdminsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
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

const PAGE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "stores", label: "Stores" },
  { key: "users", label: "Users" },
  { key: "delivery", label: "Delivery companies" },
  { key: "reports", label: "Reports" },
  { key: "support", label: "Support" },
  { key: "leads", label: "Leads" },
  { key: "portfolio", label: "Portfolio" },
  { key: "admins", label: "Admins" },
];
const pageLabel = (key: string) => PAGE_OPTIONS.find(p => p.key === key)?.label ?? key;

function PageChecklist({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {PAGE_OPTIONS.map(p => (
        <label key={p.key} className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={value.includes(p.key)}
            onChange={e => onChange(e.target.checked ? [...value, p.key] : value.filter(k => k !== p.key))}
          />
          {p.label}
        </label>
      ))}
    </div>
  );
}

// Display only: the server is what actually refuses to revoke these.
const OWNER_EMAILS = ["alhassansulaiman1369@gmail.com", "alhassansulaiman5star@gmail.com"];

export default function AdminsPage() {
  const queryClient = useQueryClient();
  const { data: admins, isLoading } = useAdminListAdmins();

  const [email, setEmail] = useState("");
  const [pages, setPages] = useState<string[]>(["dashboard"]);
  const [editing, setEditing] = useState<{ id: number; email: string; pages: string[] } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ id: number; email: string } | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getAdminListAdminsQueryKey() });

  const addMutation = useMutation({
    mutationFn: (v: { email: string; permissions: string[] }) =>
      customFetch("/api/admin/admins", { method: "POST", body: JSON.stringify(v) }),
    onSuccess: () => {
      invalidate();
      setEmail("");
      setPages(["dashboard"]);
      toast.success("Admin access granted");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const saveMutation = useMutation({
    mutationFn: (v: { id: number; permissions: string[] }) =>
      customFetch(`/api/admin/admins/${v.id}/permissions`, { method: "PATCH", body: JSON.stringify({ permissions: v.permissions }) }),
    onSuccess: () => { invalidate(); setEditing(null); toast.success("Access updated"); },
    onError: (err) => toast.error(errorMessage(err)),
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
    if (pages.length === 0) { toast.error("Choose at least one page"); return; }
    addMutation.mutate({ email: trimmed, permissions: pages });
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
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
            <Input
              type="email"
              required
              placeholder="new-admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="sm:max-w-sm"
            />
            <Button type="submit" disabled={addMutation.isPending || !email.trim() || pages.length === 0}>
              <UserPlus className="w-4 h-4 mr-2" />
              {addMutation.isPending ? "Adding…" : "Grant admin access"}
            </Button>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 mb-2">Pages this admin can open</p>
              <PageChecklist value={pages} onChange={setPages} />
            </div>
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
                      {OWNER_EMAILS.includes(admin.email.toLowerCase()) ? " · owner, cannot be revoked" : ""}
                    </p>
                    <p className="text-xs text-gray-600">
                      {OWNER_EMAILS.includes(admin.email.toLowerCase()) || !(admin as { permissions?: string[] | null }).permissions
                        ? "Can open every page"
                        : `Can open: ${((admin as { permissions?: string[] | null }).permissions ?? []).map(pageLabel).join(", ")}`}
                    </p>
                  </div>
                </div>
                {!OWNER_EMAILS.includes(admin.email.toLowerCase()) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0"
                    onClick={() => setEditing({ id: admin.id, email: admin.email, pages: (admin as { permissions?: string[] | null }).permissions ?? PAGE_OPTIONS.map(p => p.key) })}
                  >
                    Pages
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700 flex-shrink-0"
                  onClick={() => setRemoveTarget({ id: admin.id, email: admin.email })}
                  disabled={(admins ?? []).length <= 1 || OWNER_EMAILS.includes(admin.email.toLowerCase())}
                  title={OWNER_EMAILS.includes(admin.email.toLowerCase()) ? "Owner accounts can never be revoked" : undefined}
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

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pages for {editing?.email}</DialogTitle>
            <DialogDescription>Tick the pages this admin can open. Changes apply within a minute.</DialogDescription>
          </DialogHeader>
          {editing && <PageChecklist value={editing.pages} onChange={next => setEditing({ ...editing, pages: next })} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={saveMutation.isPending || !editing || editing.pages.length === 0}
              onClick={() => editing && saveMutation.mutate({ id: editing.id, permissions: editing.pages })}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
