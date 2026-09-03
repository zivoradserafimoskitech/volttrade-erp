import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Clients = lazy(() => import("./pages/Clients"));
const Market = lazy(() => import("./pages/Market"));
const Trading = lazy(() => import("./pages/Trading"));
const Invoices = lazy(() => import("./pages/Invoices"));
import AuthPage from "./pages/Auth";
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const TwoFactor = lazy(() => import("./pages/TwoFactor"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const VatraSignup = lazy(() => import("./pages/vatra/Signup"));
const VatraJoin = lazy(() => import("./pages/vatra/Join"));
import NotFound from "./pages/NotFound";
const SupplyPoints = lazy(() => import("./pages/SupplyPoints"));
const Tariffs = lazy(() => import("./pages/Tariffs"));
const SupplyContracts = lazy(() => import("./pages/SupplyContracts"));
const Ppa = lazy(() => import("./pages/Ppa"));
const MeterReadings = lazy(() => import("./pages/MeterReadings"));
const Reconciliation = lazy(() => import("./pages/Reconciliation"));
const BillingRuns = lazy(() => import("./pages/BillingRuns"));
const Compliance = lazy(() => import("./pages/Compliance"));
const Payments = lazy(() => import("./pages/Payments"));
const UsersAdmin = lazy(() => import("./pages/admin/UsersAdmin"));
const Settings = lazy(() => import("./pages/admin/Settings"));
const AuditLog = lazy(() => import("./pages/admin/AuditLog"));
const SyncHealth = lazy(() => import("./pages/admin/SyncHealth"));
const Counterparties = lazy(() => import("./pages/Counterparties"));
const TradingContracts = lazy(() => import("./pages/TradingContracts"));
const Schedules = lazy(() => import("./pages/Schedules"));
const Risk = lazy(() => import("./pages/Risk"));
const CounterpartyDrill = lazy(() => import("./pages/risk/CounterpartyDrill"));
const AgingDrill = lazy(() => import("./pages/risk/AgingDrill"));
const NopDrill = lazy(() => import("./pages/risk/NopDrill"));
const Position = lazy(() => import("./pages/risk/Position"));
const Forecasting = lazy(() => import("./pages/Forecasting"));
const Assets = lazy(() => import("./pages/Assets"));
const AssetMonitoring = lazy(() => import("./pages/AssetMonitoring"));
const PvMonitoring = lazy(() => import("./pages/PvMonitoring"));
const SmartMeter = lazy(() => import("./pages/SmartMeter"));
const Vatra = lazy(() => import("./pages/Vatra"));
const Gateways = lazy(() => import("./pages/gateways/Gateways"));
const GatewayDetail = lazy(() => import("./pages/gateways/GatewayDetail"));
const GatewayAlarms = lazy(() => import("./pages/gateways/Alarms"));
const ForecastDashboard = lazy(() => import("./pages/ForecastDashboard"));
const HedgePosition = lazy(() => import("./pages/HedgePosition"));
const QuoteBuilder = lazy(() => import("./pages/QuoteBuilder"));
const RiskMetrics = lazy(() => import("./pages/RiskMetrics"));

const ConsumerManager = lazy(() => import("./pages/balancing/ConsumerManager"));
const SlpSynthesis = lazy(() => import("./pages/balancing/SlpSynthesis"));
const Scheduling = lazy(() => import("./pages/balancing/Scheduling"));
const LivePosition = lazy(() => import("./pages/balancing/LivePosition"));
const ImbalanceAllocation = lazy(() => import("./pages/balancing/ImbalanceAllocation"));
const ForecastAccuracy = lazy(() => import("./pages/balancing/ForecastAccuracy"));
const DataReadiness = lazy(() => import("./pages/balancing/DataReadiness"));
const SmartMeterHealth = lazy(() => import("./pages/balancing/SmartMeterHealth"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Arbitrage = lazy(() => import("./pages/Arbitrage"));
const BatteryPlan = lazy(() => import("./pages/BatteryPlan"));
const BessOptimizer = lazy(() => import("./pages/assets/BessOptimizer"));
const Settlement = lazy(() => import("./pages/balancing/Settlement"));
const Onboarding = lazy(() => import("./pages/supply/Onboarding"));
const Switching = lazy(() => import("./pages/supply/Switching"));
const PortalLinks = lazy(() => import("./pages/admin/PortalLinks"));
const ConsumerApplications = lazy(() => import("./pages/admin/ConsumerApplications"));
const PortalOverview = lazy(() => import("./pages/portal/Overview"));
const PortalEdus = lazy(() => import("./pages/portal/Edus"));
const PortalInvoices = lazy(() => import("./pages/portal/PortalInvoices"));
const PortalReadings = lazy(() => import("./pages/portal/PortalReadings"));
const PortalHourly = lazy(() => import("./pages/portal/PortalHourly"));
const PortalTariffs = lazy(() => import("./pages/portal/PortalTariffs"));
const PortalSavings = lazy(() => import("./pages/portal/PortalSavings"));
const PortalRefer = lazy(() => import("./pages/portal/PortalRefer"));
const PortalEv = lazy(() => import("./pages/portal/PortalEv"));
const PortalPpa = lazy(() => import("./pages/portal/PortalPpa"));
const PortalProfile = lazy(() => import("./pages/portal/Profile"));
const PortalNotifications = lazy(() => import("./pages/portal/PortalNotifications"));

const ExternalRedirect = ({ to }: { to: string }) => {
  if (typeof window !== "undefined") window.location.replace(to);
  return null;
};

const queryClient = new QueryClient();

/** Shown while a lazily-loaded route chunk is in flight. */
const RouteFallback = () => (
  <div className="flex h-screen w-full items-center justify-center">
    <div
      className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary"
      role="status"
      aria-label="Loading"
    />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          {/* CODE SPLITTING 2026-09-03: every page below is React.lazy(), so a
              route's JS is fetched when it is first visited instead of shipping
              all 75 screens in the entry bundle. Auth and NotFound stay eager —
              the login screen is the first paint and should not wait on a
              second request. */}
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/2fa" element={<TwoFactor />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="/vatra/join" element={<VatraJoin />} />
            <Route path="/join" element={<VatraJoin />} />
            <Route path="/vatra/signup" element={<VatraSignup />} />
            <Route path="/" element={<AuthPage />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/supply-points" element={<SupplyPoints />} />
            <Route path="/tariffs" element={<Tariffs />} />
            <Route path="/contracts" element={<SupplyContracts />} />
            <Route path="/ppa" element={<Ppa />} />
            <Route path="/readings" element={<MeterReadings />} />
            <Route path="/reconciliation" element={<Reconciliation />} />
            <Route path="/billing" element={<BillingRuns />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/market" element={<Market />} />
            <Route path="/trading" element={<Trading />} />
            <Route path="/counterparties" element={<Counterparties />} />
            <Route path="/trading-contracts" element={<TradingContracts />} />
            <Route path="/schedules" element={<Schedules />} />
            <Route path="/risk" element={<Risk />} />
            <Route path="/risk/counterparty/:id" element={<CounterpartyDrill />} />
            <Route path="/risk/aging/:bucket" element={<AgingDrill />} />
            <Route path="/risk/nop/:date" element={<NopDrill />} />
            <Route path="/risk/position" element={<Position />} />
            <Route path="/risk/metrics" element={<RiskMetrics />} />
            <Route path="/risk/hedge" element={<HedgePosition />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/forecasting" element={<Forecasting />} />
            <Route path="/forecasting/models" element={<ForecastDashboard />} />
            <Route path="/quote-builder" element={<QuoteBuilder />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/asset-monitoring" element={<AssetMonitoring />} />
            <Route path="/pv-monitoring" element={<PvMonitoring />} />
            <Route path="/smart-meter" element={<SmartMeter />} />
            <Route path="/gateways" element={<Gateways />} />
            <Route path="/gateways/alarms" element={<GatewayAlarms />} />
            <Route path="/gateways/:id" element={<GatewayDetail />} />

            <Route path="/balancing/consumers" element={<ConsumerManager />} />
            <Route path="/balancing/slp" element={<SlpSynthesis />} />
            <Route path="/balancing/scheduling" element={<Scheduling />} />
            <Route path="/balancing/live" element={<LivePosition />} />
            <Route path="/balancing/allocation" element={<ImbalanceAllocation />} />
            <Route path="/balancing/accuracy" element={<ForecastAccuracy />} />
            <Route path="/balancing/readiness" element={<DataReadiness />} />
            <Route path="/balancing/smart-meter-health" element={<SmartMeterHealth />} />
            <Route path="/assets/optimizer" element={<BessOptimizer />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/arbitrage" element={<Arbitrage />} />
            <Route path="/battery" element={<BatteryPlan />} />
            <Route path="/balancing/settlement" element={<Settlement />} />
            <Route path="/supply/onboarding" element={<Onboarding />} />
            <Route path="/supply/switching" element={<Switching />} />
            <Route path="/portal" element={<PortalOverview />} />
            <Route path="/portal/edus" element={<PortalEdus />} />
            <Route path="/portal/invoices" element={<PortalInvoices />} />
            <Route path="/portal/readings" element={<PortalReadings />} />
            <Route path="/portal/hourly" element={<PortalHourly />} />
            <Route path="/portal/tariffs" element={<PortalTariffs />} />
            <Route path="/portal/savings" element={<PortalSavings />} />
            <Route path="/portal/refer" element={<PortalRefer />} />
            <Route path="/portal/ev" element={<PortalEv />} />
            <Route path="/portal/ppa" element={<PortalPpa />} />
            <Route path="/portal/profile" element={<PortalProfile />} />
            <Route path="/portal/notifications" element={<PortalNotifications />} />
            <Route path="/admin/users" element={<UsersAdmin />} />
            <Route path="/admin/settings" element={<Settings />} />
            <Route path="/admin/audit" element={<AuditLog />} />
            <Route path="/admin/sync-health" element={<SyncHealth />} />
            <Route path="/admin/portal-links" element={<PortalLinks />} />
            <Route path="/admin/consumer-applications" element={<ConsumerApplications />} />
            <Route path="/vatra" element={<Vatra />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
