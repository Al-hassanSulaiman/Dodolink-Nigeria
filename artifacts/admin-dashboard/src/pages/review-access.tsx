import { useState, type FormEvent } from "react";
import {
  adminCreateReviewAccess,
  adminGetReviewAccess,
  adminRevokeReviewAccess,
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ReviewAccount = Awaited<ReturnType<typeof adminCreateReviewAccess>>;

function errorMessage(err: unknown): string {
  const apiError = err as { data?: { error?: string }; message?: string } | undefined;
  return apiError?.data?.error ?? apiError?.message ?? "The request failed. Please try again.";
}

export default function ReviewAccessSection() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [account, setAccount] = useState<ReviewAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const created = await adminCreateReviewAccess({
        email: email.trim().toLowerCase(),
        password,
      });
      setAccount(created);
      setPassword("");
      toast.success("Review account created. Test sign-in on a fresh device before submitting it.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const lookUpAccount = async () => {
    if (busy || !email.trim()) return;
    setBusy(true);
    try {
      const found = await adminGetReviewAccess({ email: email.trim().toLowerCase() });
      setAccount(found);
    } catch (err) {
      setAccount(null);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revokeAccount = async () => {
    if (!account || busy) return;
    setBusy(true);
    try {
      const revoked = await adminRevokeReviewAccess(account.id);
      setAccount(revoked);
      setConfirmRevoke(false);
      toast.success("Review access revoked and active sessions ended.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold text-gray-900">App review access</h2>
      <p className="text-sm text-gray-600 mt-2 mb-4 max-w-2xl">
        Create an ordinary, non-admin account for Google Play and Apple reviewers. Only this
        account skips Clerk&apos;s new-device check. Use a separate email address you control
        and a unique password, not your own sign-in details. Create it from the
        <strong> published admin console</strong>—preview accounts are separate.
      </p>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={createAccount} className="space-y-4 max-w-lg">
            <div>
              <label htmlFor="review-email" className="block text-sm font-medium text-gray-800 mb-1">
                Review-only email
              </label>
              <Input
                id="review-email"
                type="email"
                autoComplete="off"
                required
                maxLength={320}
                placeholder="review@example.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setAccount(null);
                }}
              />
            </div>
            <div>
              <label htmlFor="review-password" className="block text-sm font-medium text-gray-800 mb-1">
                Unique password
              </label>
              <Input
                id="review-password"
                type="password"
                autoComplete="new-password"
                minLength={16}
                maxLength={128}
                required
                placeholder="At least 16 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Save it securely before creating the account. It is sent to Clerk, never saved here
                or shown again.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || password.length < 16}>
                {busy ? "Working…" : "Create review account"}
              </Button>
              <Button type="button" variant="outline" onClick={lookUpAccount} disabled={busy || !email.trim()}>
                Check existing access
              </Button>
            </div>
          </form>

          {account && (
            <div className="border-t mt-6 pt-5 max-w-lg" aria-live="polite">
              <p className="text-sm font-semibold text-gray-900">{account.email}</p>
              <p className="text-sm text-gray-600 mt-1">
                {account.revoked ? "Access revoked. This account cannot sign in." : "Review access is active."}
              </p>
              {!account.revoked && (
                <>
                  <p className="text-sm text-gray-600 mt-2">
                    Before sending credentials to either store, sign in on a fresh device to
                    confirm that no email code or other challenge appears. Put the email and
                    password in Google Play Console&apos;s Sign-in details and Apple&apos;s App
                    Review information—not in the app or its source code.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3 text-red-600 hover:text-red-700"
                    onClick={() => setConfirmRevoke(true)}
                  >
                    Revoke review access
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this review account?</DialogTitle>
            <DialogDescription>
              {account?.email} will be unable to sign in, and any active sessions will end.
              Do this only after both stores have finished reviewing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={revokeAccount}>
              {busy ? "Revoking…" : "Revoke access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}