import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation, Link } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, Show, useClerk, useAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { setAuthTokenGetter, customFetch } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import SignInPage from "@/pages/sign-in";
import DashboardPage from "@/pages/dashboard";
import StoresPage from "@/pages/stores";
import UsersPage from "@/pages/users";
import AdminsPage from "@/pages/admins";
import SupportPage from "@/pages/support";
import LeadsPage from "@/pages/leads";
import PortfolioAnalyticsPage from "@/pages/portfolio-analytics";
import PrivacyPolicyPage from "@/pages/privacy";
import TermsOfServicePage from "@/pages/terms";
import DeleteAccountPage from "@/pages/delete-account";
import DeliveryPage from "@/pages/delivery";
import ReportsPage from "@/pages/reports";
import {
  useAdminListSupportThreads,
  getAdminListSupportThreadsQueryKey,
} from "@workspace/api-client-react";
import { LayoutDashboard, Store, LogOut, ShieldCheck, Users, HelpCircle, Inbox, BarChart3, Truck, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const clerkPubKey = import.meta.env.VITE_CLERK_AUTH_MODE === "external"
  ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  : publishableKeyFromHost(
      window.location.hostname,
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    );

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const NAV: Array<{ to: string; label: string; icon: typeof Store; page: string }> = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, page: "dashboard" },
  { to: "/stores", label: "Stores", icon: Store, page: "stores" },
  { to: "/users", label: "Users", icon: Users, page: "users" },
  { to: "/delivery", label: "Delivery companies", icon: Truck, page: "delivery" },
  { to: "/reports", label: "Reports", icon: Flag, page: "reports" },
  { to: "/admins", label: "Admins", icon: ShieldCheck, page: "admins" },
  { to: "/support", label: "Support", icon: HelpCircle, page: "support" },
  { to: "/leads", label: "Leads", icon: Inbox, page: "leads" },
  { to: "/portfolio-analytics", label: "Portfolio", icon: BarChart3, page: "portfolio" },
];

type AdminMe = { email: string | null; permissions: string[] | null };
function useAdminMe() {
  return useQuery<AdminMe>({ queryKey: ["admin-me"], queryFn: () => customFetch<AdminMe>("/api/admin/me"), staleTime: 60_000, retry: 1 });
}
const canSee = (me: AdminMe | undefined, page: string) => !me || me.permissions === null || me.permissions.includes(page);

function Sidebar() {
  const adminMe = useAdminMe();
  const { signOut } = useClerk();
  const [location] = useLocation();

  const { data: supportThreads } = useAdminListSupportThreads({
    query: {
      queryKey: getAdminListSupportThreadsQueryKey(),
      refetchInterval: 30000,
    },
  });
  const supportUnread = (supportThreads ?? []).reduce((sum, t) => sum + t.unreadCount, 0);

  return (
    <aside className="w-56 min-h-screen bg-[#1B5E20] flex flex-col">
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-6 h-6 text-amber-400" />
          <div>
            <p className="text-white font-bold text-sm leading-tight">Dodolink</p>
            <p className="text-green-300 text-xs">Admin Console</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.filter(item => canSee(adminMe.data, item.page)).map(({ to, label, icon: Icon }) => {
          const active = location === to || (to !== "/" && location.startsWith(to));
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-white/15 text-white"
                  : "text-green-200 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="w-4.5 h-4.5 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {to === "/support" && supportUnread > 0 && (
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
                  {supportUnread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-5">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-green-200 hover:bg-white/10 hover:text-white text-sm"
          onClick={() => signOut({ redirectUrl: `${basePath}/` })}
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}

function AuthTokenBridge() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      queryClient.invalidateQueries();
    }
  }, [isLoaded, isSignedIn]);

  return null;
}

function NoAccess() {
  const me = useAdminMe();
  const first = NAV.find(item => canSee(me.data, item.page));
  return (
    <div className="py-16 text-center">
      <p className="text-lg font-semibold text-gray-900">You do not have access to this page</p>
      <p className="text-sm text-gray-600 mt-1">Ask an owner to give you access.</p>
      {first && <Link to={first.to} className="inline-block mt-4 text-green-800 underline">Go to {first.label}</Link>}
    </div>
  );
}

function ProtectedRoute({ component: Component, page }: { component: () => React.ReactElement | null; page?: string }) {
  const me = useAdminMe();
  const allowed = !page || canSee(me.data, page);
  return (
    <>
      <Show when="signed-in">
        <AppShell>
          {allowed ? <Component /> : <NoAccess />}
        </AppShell>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function HomeRoute() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/dashboard">
        <ProtectedRoute component={DashboardPage} page="dashboard" />
      </Route>
      <Route path="/stores">
        <ProtectedRoute component={StoresPage} page="stores" />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={UsersPage} page="users" />
      </Route>
      <Route path="/delivery">
        <ProtectedRoute component={DeliveryPage} page="delivery" />
      </Route>
      <Route path="/reports">
        <ProtectedRoute component={ReportsPage} page="reports" />
      </Route>
      <Route path="/admins">
        <ProtectedRoute component={AdminsPage} page="admins" />
      </Route>
      <Route path="/support">
        <ProtectedRoute component={SupportPage} page="support" />
      </Route>
      <Route path="/leads">
        <ProtectedRoute component={LeadsPage} page="leads" />
      </Route>
      <Route path="/portfolio-analytics">
        <ProtectedRoute component={PortfolioAnalyticsPage} page="portfolio" />
      </Route>
      <Route path="/privacy" component={PrivacyPolicyPage} />
      <Route path="/terms" component={TermsOfServicePage} />
      <Route path="/delete-account" component={DeleteAccountPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => {
        window.history.pushState({}, "", to);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
      routerReplace={(to) => {
        window.history.replaceState({}, "", to);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AuthTokenBridge />
        <TooltipProvider>
          <WouterRouter base={basePath}>
            <Router />
          </WouterRouter>
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
