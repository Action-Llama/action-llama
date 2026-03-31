import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { InstanceDetailPage } from "./pages/InstanceDetailPage";
import { ActivityPage } from "./pages/ActivityPage";
import { TriggerDetailPage } from "./pages/TriggerDetailPage";
import { ProjectConfigPage } from "./pages/ProjectConfigPage";
import { AgentSkillPage } from "./pages/AgentSkillPage";
import { AgentStatsPage } from "./pages/AgentStatsPage";
import { ChatPage } from "./pages/ChatPage";
import { WebhookReceiptPage } from "./pages/WebhookReceiptPage";

function AgentTriggersRedirect() {
  const { name } = useParams<{ name: string }>();
  return <Navigate to={`/activity?agent=${encodeURIComponent(name ?? "")}`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Chat page is full-screen, outside Layout */}
      <Route path="/chat/:agent" element={<ChatPage />} />
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/agents/:name" element={<AgentDetailPage />} />
        <Route
          path="/dashboard/agents/:name/instances/:id"
          element={<InstanceDetailPage />}
        />
        <Route
          path="/dashboard/agents/:name/triggers"
          element={<AgentTriggersRedirect />}
        />
        <Route
          path="/dashboard/agents/:name/skill"
          element={<AgentSkillPage />}
        />
        <Route
          path="/dashboard/agents/:name/stats"
          element={<AgentStatsPage />}
        />
        <Route path="/dashboard/triggers" element={<Navigate to="/activity" replace />} />
        <Route path="/activity" element={<ActivityPage />} />
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
