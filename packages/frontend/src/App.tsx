import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AgentLayout } from "./components/AgentLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { AgentAdminPage } from "./pages/AgentAdminPage";
import { InstanceDetailPage } from "./pages/InstanceDetailPage";
import { ActivityPage } from "./pages/ActivityPage";
import { TriggerDetailPage } from "./pages/TriggerDetailPage";
import { ProjectConfigPage } from "./pages/ProjectConfigPage";
import { AgentStatsPage } from "./pages/AgentStatsPage";
import { StatsPage } from "./pages/StatsPage";
import { ChatPage } from "./pages/ChatPage";
import { WebhookReceiptPage } from "./pages/WebhookReceiptPage";

function AgentTriggersRedirect() {
  const { name } = useParams<{ name: string }>();
  return <Navigate to={`/activity?agent=${encodeURIComponent(name ?? "")}`} replace />;
}

function AgentSkillRedirect() {
  const { name } = useParams<{ name: string }>();
  return <Navigate to={`/dashboard/agents/${encodeURIComponent(name ?? "")}/settings`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Chat page is full-screen, outside Layout */}
      <Route path="/chat/:agent" element={<ChatPage />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/agents/:name" element={<AgentLayout />}>
          <Route index element={<AgentDetailPage />} />
          <Route path="stats" element={<AgentStatsPage />} />
          <Route path="settings" element={<AgentAdminPage />} />
          <Route path="admin" element={<Navigate to="settings" replace />} />
          <Route path="skill" element={<AgentSkillRedirect />} />
          <Route path="triggers" element={<AgentTriggersRedirect />} />
        </Route>
        <Route
          path="/dashboard/agents/:name/instances/:id"
          element={<InstanceDetailPage />}
        />
        <Route path="/dashboard/triggers" element={<Navigate to="/activity" replace />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/triggers" element={<Navigate to="/activity" replace />} />
        <Route path="/jobs" element={<Navigate to="/activity" replace />} />
        <Route path="/dashboard/triggers/:instanceId" element={<TriggerDetailPage />} />
        <Route path="/dashboard/webhooks/:receiptId" element={<WebhookReceiptPage />} />
        <Route path="/dashboard/config" element={<ProjectConfigPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
