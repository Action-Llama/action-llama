import { escapeHtml, renderLayout } from "./layout.js";

export interface ProjectConfigData {
  projectName?: string;
  projectScale: number;
  gatewayPort?: number;
  webhooksActive: boolean;
}

export function renderProjectConfigPage(data: ProjectConfigData): string {
  const { projectName, projectScale, gatewayPort, webhooksActive } = data;

  const content = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div class="flex items-center gap-3">
        <h1 class="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">Project Configuration</h1>
      </div>
    </div>

    <!-- Global Settings -->
    <div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-4">Global Settings</h2>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Project Scale -->
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Project Scale</label>
          <div class="flex items-center gap-3">
            <input id="project-scale-input" type="number" min="1" max="50" value="${projectScale}" class="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-24">
            <button id="update-project-scale-btn" class="px-4 py-2 text-sm rounded-md font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors" onclick="updateProjectScale()">Update</button>
          </div>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-2">Maximum number of concurrent agent runs across all agents in this project</p>
        </div>

        <!-- Gateway Info (read-only) -->
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Gateway Status</label>
          <div class="space-y-2">
            ${gatewayPort ? `<div class="text-sm text-slate-600 dark:text-slate-300">Port: ${gatewayPort}</div>` : ""}
            <div class="text-sm text-slate-600 dark:text-slate-300">Webhooks: ${webhooksActive ? "Active" : "Inactive"}</div>
            ${projectName ? `<div class="text-sm text-slate-600 dark:text-slate-300">Project: ${escapeHtml(projectName)}</div>` : ""}
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6">
      <h2 class="text-lg font-semibold text-slate-900 dark:text-white mb-4">Actions</h2>
      
      <div class="flex flex-wrap gap-3">
        <button class="px-4 py-2 text-sm rounded-md font-semibold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="pauseScheduler()">Pause All Agents</button>
        <button class="px-4 py-2 text-sm rounded-md font-semibold border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors" onclick="resumeScheduler()">Resume All Agents</button>
      </div>
      
      <p class="text-sm text-slate-500 dark:text-slate-400 mt-3">These actions affect all agents in the project temporarily (until restart)</p>
    </div>
  `;

  const scripts = `<script>
    function ctrlPost(path) {
      fetch(path, { method: "POST", credentials: "same-origin" })
        .then(function(r) { 
          if (r.ok) { 
            return r.json(); 
          } else { 
            throw new Error("HTTP " + r.status); 
          } 
        })
        .then(function(data) {
          if (data.message) alert(data.message);
        })
        .catch(function(err) { 
          alert("Error: " + err); 
        });
    }

    function updateProjectScale() {
      var input = document.getElementById("project-scale-input");
      var btn = document.getElementById("update-project-scale-btn");
      var scale = parseInt(input.value);
      if (!scale || scale < 1 || scale > 50) {
        alert("Scale must be between 1 and 50");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Updating...";
      fetch("/control/project/scale", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scale: scale })
      }).then(function(r) {
        if (r.ok) {
          alert("Project scale updated to " + scale);
        } else {
          r.text().then(function(text) { alert("Error: " + text); });
        }
      }).catch(function(err) {
        alert("Error: " + err);
      }).finally(function() {
        btn.disabled = false;
        btn.textContent = "Update";
      });
    }

    function pauseScheduler() {
      if (!confirm("Pause all agents? This will stop all scheduled and webhook-triggered runs.")) return;
      ctrlPost("/control/pause");
    }

    function resumeScheduler() {
      ctrlPost("/control/resume");
    }
  </script>`;

  return renderLayout({
    title: "Project Configuration",
    breadcrumbs: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Configuration" },
    ],
    content,
    scripts,
  });
}