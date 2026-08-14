import { useState } from "react";

export default function DeleteAccountPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const apiBase = (import.meta as any).env?.VITE_API_BASE ?? "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/delete-account-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to submit request.");
      }
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-red-600 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Delete My Account</h1>
            <p className="text-sm text-gray-500 mt-0.5">Dodolink NG · Data Deletion Request</p>
          </div>
        </div>

        {done ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Request received</h2>
            <p className="text-sm text-gray-600">
              We've received your deletion request for <span className="font-medium">{email}</span>.
              Your account and associated data will be deleted within <span className="font-medium">90 days</span>.
              You'll receive a confirmation email once the deletion is complete.
            </p>
          </div>
        ) : (
          <>
            <div className="text-sm text-gray-700 space-y-3 mb-8">
              <p>
                Submitting this form will permanently delete your Dodolink NG account and all associated data,
                including your store listings, products, messages, and reviews.
              </p>
              <p>
                <span className="font-medium text-gray-900">This action cannot be undone.</span> Deletion
                is processed within 90 days of your request.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address on your account
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="w-full rounded-lg bg-red-600 text-white text-sm font-semibold py-2.5 px-4 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting…" : "Submit Deletion Request"}
              </button>
            </form>

            <p className="text-xs text-gray-400 mt-6 text-center">
              For questions, contact us via{" "}
              <span className="font-medium">Settings → Support</span> in the app.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
