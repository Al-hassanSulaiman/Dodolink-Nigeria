import { useState } from "react";
import { useAdminListUsers } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Store, UserCheck, UserX, Search } from "lucide-react";

type StatusFilter = "all" | "active" | "inactive";

function formatDate(ms: number | null | undefined): string {
  if (!ms) return "Never";
  return new Date(ms).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "Never";
  const diff = Date.now() - ms;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function UserAvatar({ user }: { user: { firstName?: string | null; lastName?: string | null; email: string; imageUrl?: string | null } }) {
  const initials = [user.firstName, user.lastName]
    .filter(Boolean)
    .map((s) => s![0].toUpperCase())
    .join("") || user.email[0].toUpperCase();

  if (user.imageUrl) {
    return (
      <img
        src={user.imageUrl}
        alt={initials}
        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-green-100 text-green-800 flex items-center justify-center text-sm font-semibold flex-shrink-0">
      {initials}
    </div>
  );
}

export default function UsersPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useAdminListUsers(
    statusFilter !== "all" ? { status: statusFilter } : {}
  );

  const filtered = (users ?? []).filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.toLowerCase();
    return name.includes(q) || u.email.toLowerCase().includes(q) || (u.storeName ?? "").toLowerCase().includes(q);
  });

  const activeCount = (users ?? []).filter((u) => u.isActive).length;
  const inactiveCount = (users ?? []).filter((u) => !u.isActive).length;

  const tabs: { key: StatusFilter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: users?.length },
    { key: "active", label: "Active", count: statusFilter === "all" ? activeCount : undefined },
    { key: "inactive", label: "Inactive", count: statusFilter === "all" ? inactiveCount : undefined },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500 mt-1">
          Active = logged in within last 30 days
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <UserCheck className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{activeCount}</p>
            <p className="text-xs text-gray-500">Active users</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center">
            <UserX className="w-5 h-5 text-gray-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{inactiveCount}</p>
            <p className="text-xs text-gray-500">Inactive users</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
            <Store className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">
              {(users ?? []).filter((u) => u.hasStore).length}
            </p>
            <p className="text-xs text-gray-500">Have a store</p>
          </div>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {tabs.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                statusFilter === key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
              {count !== undefined && (
                <span className="ml-1.5 text-xs text-gray-400">({count})</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search name, email or store…"
            className="pl-9 h-9 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            Loading users…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            No users found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  User
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Store
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Joined
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Last active
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <UserAvatar user={user} />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {[user.firstName, user.lastName].filter(Boolean).join(" ") || "—"}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <Badge className="bg-green-100 text-green-700 border-green-200 font-medium">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-gray-500 border-gray-300 font-medium">
                        Inactive
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {user.hasStore ? (
                      <div>
                        <p className="text-gray-900 font-medium truncate max-w-[140px]">
                          {user.storeName ?? "Unnamed store"}
                        </p>
                        <Badge
                          className={
                            user.storeVerified
                              ? "bg-amber-100 text-amber-700 border-amber-200 text-xs mt-0.5"
                              : "bg-gray-100 text-gray-600 border-gray-200 text-xs mt-0.5"
                          }
                        >
                          {user.storeVerified ? "Verified" : "Unverified"}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">No store</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <span className={user.isActive ? "text-green-600 font-medium" : "text-gray-400"}>
                      {timeAgo(user.lastActiveAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
