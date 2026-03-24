import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { InstanceDetailPage } from "./pages/InstanceDetailPage";
import { TriggerHistoryPage } from "./pages/TriggerHistoryPage";
import { ProjectConfigPage } from "./pages/ProjectConfigPage";
import { AgentSkillPage } from "./pages/AgentSkillPage";
import { ChatPage } from "./pages/ChatPage";

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
          path="/dashboard/agents/:name/skill"
          element={<AgentSkillPage />}
        />
        <Route path="/dashboard/triggers" element={<TriggerHistoryPage />} />
        <Route path="/dashboard/config" element={<ProjectConfigPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
