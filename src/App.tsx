import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Market from "./pages/Market";
import Trading from "./pages/Trading";
import Invoices from "./pages/Invoices";
import AuthPage from "./pages/Auth";
import NotFound from "./pages/NotFound";
import SupplyPoints from "./pages/SupplyPoints";
import Tariffs from "./pages/Tariffs";
import SupplyContracts from "./pages/SupplyContracts";
import MeterReadings from "./pages/MeterReadings";
import BillingRuns from "./pages/BillingRuns";
import Payments from "./pages/Payments";
import UsersAdmin from "./pages/admin/UsersAdmin";
import Settings from "./pages/admin/Settings";
import AuditLog from "./pages/admin/AuditLog";
import Counterparties from "./pages/Counterparties";
import TradingContracts from "./pages/TradingContracts";
import Schedules from "./pages/Schedules";
import Risk from "./pages/Risk";
import CounterpartyDrill from "./pages/risk/CounterpartyDrill";
import AgingDrill from "./pages/risk/AgingDrill";
import NopDrill from "./pages/risk/NopDrill";
import Forecasting from "./pages/Forecasting";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/supply-points" element={<SupplyPoints />} />
            <Route path="/tariffs" element={<Tariffs />} />
            <Route path="/contracts" element={<SupplyContracts />} />
            <Route path="/readings" element={<MeterReadings />} />
            <Route path="/billing" element={<BillingRuns />} />
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
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/forecasting" element={<Forecasting />} />
            <Route path="/admin/users" element={<UsersAdmin />} />
            <Route path="/admin/settings" element={<Settings />} />
            <Route path="/admin/audit" element={<AuditLog />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
