import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGetPortfolioAnalytics,
  getGetPortfolioAnalyticsQueryKey,
  useCreatePortfolioClientLink,
  useDeletePortfolioClientLink,
} from "@workspace/api-client-react";
import { Link2, Copy, Trash2, Plus, AlertTriangle, BarChart3, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

const SECTIONS = ["hero", "about", "work", "skills", "contact"] as const;
type SectionKey = (typeof SECTIONS)[number];

function fmtDur(s: number): string {
  const n = Math.max(0, Math.round(s));
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m}m ${n % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

function shareUrl(id: string): string {
  return window.location.origin + "/portfolio/?client=" + encodeURIComponent(id);
}

function Stat({ label, value, note, id }: { label: string; value: string; note: string; id: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3" data-testid={id}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-xl font-bold text-[#1B5E20] mt-0.5">{value}</p>
      <p className="text-[11px] text-gray-400">{note}</p>
    </div>
  );
}

export default function PortfolioAnalyticsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useGetPortfolioAnalytics({
    query: { queryKey: getGetPortfolioAnalyticsQueryKey(), refetchInterval: 30000 },
  });
  const createLink = useCreatePortfolioClientLink();
  const deleteLink = useDeletePortfolioClientLink();
  const [label, setLabel] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: getGetPortfolioAnalyticsQueryKey() });

  const visits = data?.visits ?? [];
  const links = data?.links ?? [];
  const labelById = useMemo(() => new Map(links.map((l) => [l.id, l.label])), [links]);

  const sectionSummary = useMemo(() => {
    return SECTIONS.map((k) => {
      const vals = visits.map((v) => v.sections[k]).filter((x): x is number => typeof x === "number");
      const total = vals.reduce((a, b) => a + b, 0);
      return { k, viewers: vals.length, total, avg: vals.length ? total / vals.length : 0 };
    });
  }, [visits]);

  const perLink = useMemo(() => {
    const m = new Map<string, { count: number; secs: number; last: string }>();
    for (const v of visits) {
      if (!v.clientId) continue;
      const cur = m.get(v.clientId) ?? { count: 0, secs: 0, last: v.updatedAt };
      cur.count += 1;
      cur.secs += v.seconds;
      if (new Date(v.updatedAt) > new Date(cur.last)) cur.last = v.updatedAt;
      m.set(v.clientId, cur);
    }
    return m;
  }, [visits]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const l = label.trim();
    if (!l) return;
    createLink.mutate(
      { data: { label: l } },
      {
        onSuccess: () => {
          setLabel("");
          toast.success("Client link created");
          refresh();
        },
        onError: () => toast.error("Could not create link"),
      },
    );
  };

  const copy = async (id: string) => {
    const url = shareUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      setManualUrl(null);
      toast.success("Link copied");
    } catch {
      setManualUrl(url);
      toast.error("Clipboard blocked — copy the URL below");
    }
  };

  const remove = (id: string) => {
    deleteLink.mutate(
      { id },
      {
        onSuccess: () => {
          setConfirmId(null);
          toast.success("Link and its visits deleted");
          refresh();
        },
        onError: () => toast.error("Could not delete link"),
      },
    );
  };

  const avg = data && data.totalVisits > 0 ? data.totalSeconds / data.totalVisits : 0;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Portfolio Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Totals cover all retained visits (last 90 days). Tables and summaries use the most recent 500 visits.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh"
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5 text-xs text-amber-900 flex gap-2.5">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
        <ul className="space-y-1 leading-relaxed">
          <li>Client attribution comes from the link used, not verified identity. Shared links may be forwarded to others.</li>
          <li>No cookies, stored IP addresses or fingerprinting are used. Do Not Track and Global Privacy Control are respected.</li>
          <li>Visible time includes idle time and is counted up to a 4-hour cap per visit.</li>
        </ul>
      </div>

      {isLoading ? (
        <div className="space-y-3" data-testid="state-loading">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-gray-200/70 animate-pulse" />
            ))}
          </div>
          <div className="h-48 rounded-lg bg-gray-200/70 animate-pulse" />
        </div>
      ) : isError || !data ? (
        <div className="flex flex-col items-center py-16 text-center" data-testid="state-error">
          <AlertTriangle className="w-9 h-9 text-red-400 mb-3" />
          <p className="text-sm font-medium text-gray-700">Failed to load portfolio analytics</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()} data-testid="button-retry">
            Try again
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat id="stat-visits" label="Total visits" value={String(data.totalVisits)} note="Retained 90 days" />
            <Stat id="stat-time" label="Total visible time" value={fmtDur(data.totalSeconds)} note="Retained 90 days" />
            <Stat id="stat-avg" label="Avg visible-page time" value={fmtDur(avg)} note="Per visit, retained 90 days" />
          </div>

          <section className="bg-white border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-[#1B5E20]" /> Client links
            </h2>
            <form onSubmit={submit} className="flex gap-2 mt-3">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
                placeholder="Private label, e.g. Adaeze – Lagos agency"
                className="flex-1 h-9 px-3 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30"
                data-testid="input-link-label"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!label.trim() || createLink.isPending}
                className="bg-[#1B5E20] hover:bg-[#164d1a] text-white gap-1"
                data-testid="button-create-link"
              >
                <Plus className="w-3.5 h-3.5" /> {createLink.isPending ? "Creating…" : "Create"}
              </Button>
            </form>
            <p className="text-[11px] text-gray-400 mt-1.5">Labels are private to admins; visitors never see them.</p>

            {manualUrl && (
              <div className="mt-3 text-xs bg-amber-50 border border-amber-200 rounded-md p-2" data-testid="manual-url">
                <p className="text-amber-800 mb-1">Copy manually:</p>
                <input
                  readOnly
                  value={manualUrl}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full bg-white border border-amber-200 rounded px-2 py-1 font-mono"
                />
              </div>
            )}

            {links.length === 0 ? (
              <p className="text-xs text-gray-400 mt-4 py-4 text-center border border-dashed border-gray-200 rounded-md" data-testid="state-no-links">
                No client links yet. Create one to see which client viewed your portfolio.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-gray-100">
                {links.map((l) => {
                  const s = perLink.get(l.id);
                  return (
                    <div key={l.id} className="py-2.5" data-testid={`row-link-${l.id}`}>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex-1 min-w-48">
                          <p className="text-sm font-medium text-gray-900">{l.label}</p>
                          <p className="text-[11px] text-gray-500">
                            {s
                              ? `${s.count} visit${s.count === 1 ? "" : "s"} · ${fmtDur(s.secs)} · last ${fmtDate(s.last)}`
                              : "No visits in recent 500"}{" "}
                            <span className="text-gray-400">(recent-500 sample)</span>
                          </p>
                        </div>
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => copy(l.id)} data-testid={`button-copy-${l.id}`}>
                          <Copy className="w-3.5 h-3.5" /> Copy link
                        </Button>
                        {confirmId !== l.id && (
                          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setConfirmId(l.id)} data-testid={`button-delete-${l.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                      {confirmId === l.id && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap bg-red-50 border border-red-200 rounded-md px-3 py-2 text-xs text-red-800">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span className="flex-1 min-w-48">Deleting this link also deletes all visits associated with it. This cannot be undone.</span>
                          <Button size="sm" variant="outline" onClick={() => setConfirmId(null)} data-testid={`button-cancel-delete-${l.id}`}>
                            Cancel
                          </Button>
                          <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" disabled={deleteLink.isPending} onClick={() => remove(l.id)} data-testid={`button-confirm-delete-${l.id}`}>
                            {deleteLink.isPending ? "Deleting…" : "Delete link & visits"}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-900">Section summary</h2>
            <p className="text-[11px] text-gray-400 mb-3">Based on the latest {visits.length} of up to 500 recent visits only.</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {sectionSummary.map((s) => (
                <div key={s.k} className="rounded-md bg-green-50 border border-green-100 px-3 py-2" data-testid={`summary-${s.k}`}>
                  <p className="text-[11px] uppercase tracking-wide text-green-800 font-medium">{s.k}</p>
                  <p className="text-sm font-semibold text-gray-900">{fmtDur(s.avg)} avg</p>
                  <p className="text-[11px] text-gray-500">{s.viewers} viewer{s.viewers === 1 ? "" : "s"} · {fmtDur(s.total)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Recent visits</h2>
              <p className="text-[11px] text-gray-400">Latest {visits.length} (max 500) of {data.totalVisits} retained over 90 days</p>
            </div>
            {visits.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center" data-testid="state-empty">
                <BarChart3 className="w-9 h-9 text-gray-300 mb-2" />
                <p className="text-sm font-medium text-gray-500">No visits yet</p>
                <p className="text-xs text-gray-400 mt-1">Visits to the portfolio will appear here</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500 text-left">
                    <tr>
                      <th className="px-4 py-2 font-medium">Started</th>
                      <th className="px-4 py-2 font-medium">Visitor</th>
                      <th className="px-4 py-2 font-medium">Visible time</th>
                      <th className="px-4 py-2 font-medium">Sections viewed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visits.map((v) => {
                      const viewed = SECTIONS.filter((k: SectionKey) => typeof v.sections[k] === "number");
                      const name = v.clientId ? labelById.get(v.clientId) ?? "Deleted link" : null;
                      return (
                        <tr key={v.id} className="hover:bg-green-50/40 transition-colors" data-testid={`row-visit-${v.id}`}>
                          <td className="px-4 py-2 whitespace-nowrap text-gray-600">{fmtDate(v.startedAt)}</td>
                          <td className="px-4 py-2">
                            {name ? (
                              <span className="font-medium text-[#1B5E20]">{name}</span>
                            ) : (
                              <span className="text-gray-400">Anonymous</span>
                            )}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap font-medium text-gray-800">{fmtDur(v.seconds)}</td>
                          <td className="px-4 py-2">
                            {viewed.length === 0 ? (
                              <span className="text-gray-400">None recorded</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {viewed.map((k) => (
                                  <span key={k} className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">
                                    {k} {fmtDur(v.sections[k] ?? 0)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
