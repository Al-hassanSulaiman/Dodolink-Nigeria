import { useAdminGetAnalytics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Store, Package, MessageSquare, Clock, CheckCircle, XCircle } from "lucide-react";

export default function DashboardPage() {
  const { data: analytics, isLoading, error } = useAdminGetAnalytics();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="bg-red-50 rounded-2xl p-8 flex flex-col items-center gap-3 max-w-md w-full text-center">
          <AlertCircle className="w-10 h-10 text-red-500" />
          <h2 className="text-lg font-semibold text-gray-900">Failed to load dashboard</h2>
          <p className="text-sm text-gray-500">
            {error
              ? `Error: ${(error as Error).message}`
              : "No data returned from the server."}
          </p>
          <p className="text-xs text-gray-400">
            Make sure you are signed in with an admin account.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      title: "Total Stores",
      value: analytics.totalStores,
      icon: Store,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Pending Review",
      value: analytics.pendingStores,
      icon: Clock,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      title: "Verified Stores",
      value: analytics.verifiedStores,
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      title: "Rejected",
      value: analytics.rejectedStores,
      icon: XCircle,
      color: "text-red-600",
      bg: "bg-red-50",
    },
    {
      title: "Total Products",
      value: analytics.totalProducts,
      icon: Package,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      title: "Conversations",
      value: analytics.totalConversations,
      icon: MessageSquare,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
  ];

  const pieData = [
    { name: "Pending", value: analytics.pendingStores, color: "#F59E0B" },
    { name: "Verified", value: analytics.verifiedStores, color: "#1B5E20" },
    { name: "Rejected", value: analytics.rejectedStores, color: "#EF4444" },
  ].filter((d) => d.value > 0);

  const barData = analytics.recentStores.map((s) => ({
    name: s.name.length > 14 ? s.name.slice(0, 14) + "…" : s.name,
    status: s.verificationStatus,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Platform Overview</h2>
        <p className="text-gray-500 text-sm mt-1">Live snapshot of the Dodolink marketplace</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card) => (
          <Card key={card.title} className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className={`${card.bg} ${card.color} p-3 rounded-xl`}>
                <card.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm text-gray-500">{card.title}</p>
                <p className="text-3xl font-bold text-gray-900">{card.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {pieData.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-700">
                Store Verification Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {barData.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-gray-700">
                Most Recent Stores
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {analytics.recentStores.map((store) => (
                  <div
                    key={store.id}
                    className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{store.name}</p>
                      <p className="text-xs text-gray-400">{store.category} · {store.location}</p>
                    </div>
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
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
