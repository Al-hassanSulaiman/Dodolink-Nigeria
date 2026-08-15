import { useAdminListLeads } from "@workspace/api-client-react";
import type { ContactLead } from "@workspace/api-client-react";
import { Mail, DollarSign, FileText, Inbox } from "lucide-react";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function LeadsPage() {
  const { data: leads, isLoading, isError } = useAdminListLeads();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Contact Leads</h1>
        <p className="text-sm text-gray-500 mt-1">All project enquiries submitted via the portfolio contact form</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-red-500 py-8 text-center">Failed to load leads. Please refresh.</p>
      ) : !leads || leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox className="w-10 h-10 text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-500">No leads yet</p>
          <p className="text-xs text-gray-400 mt-1">Submissions from the portfolio contact form will appear here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {leads.map((lead: ContactLead) => (
            <div
              key={lead.id}
              className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-base font-semibold text-gray-900">{lead.name}</p>
                  <a
                    href={`mailto:${lead.email}`}
                    className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mt-0.5"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {lead.email}
                  </a>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                    <DollarSign className="w-3 h-3" />
                    {lead.budget}
                  </span>
                  <span className="text-[11px] text-gray-400">{formatDate(lead.submittedAt)}</span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  <FileText className="w-3.5 h-3.5" />
                  Project Description
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{lead.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
