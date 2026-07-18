import { Switch, Route, Router as WouterRouter, Redirect, useLocation, Link } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import NotFound from "@/pages/not-found";
import SignInPage from "@/pages/sign-in";
import DashboardPage from "@/pages/dashboard";
import StoresPage from "@/pages/stores";
import UsersPage from "@/pages/users";
import { LayoutDashboard, Store, LogOut, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const clerkPubKey = publishableKeyFromHost(
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

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/stores", label: "Stores", icon: Store },
  { to: "/users", label: "Users", icon: Users },
];

function Sidebar() {
  const { signOut } = useClerk();
  const [location] = useLocation();

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
        {NAV.map(({ to, label, icon: Icon }) => {
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
              {label}
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

function ProtectedRoute({ component: Component }: { component: () => React.ReactElement | null }) {
  return (
    <>
      <Show when="signed-in">
        <AppShell>
          <Component />
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
        <ProtectedRoute component={DashboardPage} />
      </Route>
      <Route path="/stores">
        <ProtectedRoute component={StoresPage} />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={UsersPage} />
      </Route>
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
