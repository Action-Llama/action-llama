import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const API_KEY = "pw-test-key-12345";
const AUTH = { Authorization: `Bearer ${API_KEY}` };

/** Log in through the login page. */
async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="key"]', API_KEY);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard");
}

/** Reset server state to idle via control APIs. */
async function resetState(request: APIRequestContext) {
  // Kill any running instances
  await Promise.all([
    request.post("/control/agents/single-agent/kill", { headers: AUTH }),
    request.post("/control/agents/scaled-agent/kill", { headers: AUTH }),
  ]);
  // Re-enable agents, unpause, reset scales
  await Promise.all([
    request.post("/control/agents/single-agent/enable", { headers: AUTH }),
    request.post("/control/agents/scaled-agent/enable", { headers: AUTH }),
    request.post("/control/resume", { headers: AUTH }),
    request.post("/control/agents/single-agent/scale", {
      headers: AUTH,
      data: { scale: 1 },
    }),
    request.post("/control/agents/scaled-agent/scale", {
      headers: AUTH,
      data: { scale: 2 },
    }),
  ]);
}

// ──── Login ───────────────────────────────────────────────────────────

test.describe("Login", () => {
  test("valid login redirects to dashboard", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText("Action Llama");
    await page.fill('input[name="key"]', API_KEY);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");
    await expect(page.locator("h1")).toContainText("Dashboard");
  });

  test("invalid login shows error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="key"]', "wrong-key");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Invalid API key")).toBeVisible();
    expect(page.url()).toContain("/login");
  });

  test("unauthenticated dashboard access redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
  });

  test("logout redirects to login", async ({ page }) => {
    await login(page);
    await page.click("text=Logout");
    await page.waitForURL("**/login");
  });
});

// ──── Dashboard ───────────────────────────────────────────────────────

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetState(request);
    await login(page);
  });

  test("shows agents with correct initial state", async ({ page }) => {
    // single-agent (scale=1) → "idle"
    const singleRow = page.locator('tr[data-agent="single-agent"]');
    await expect(singleRow).toBeVisible();
    await expect(singleRow.locator("td").nth(1)).toContainText("idle");

    // scaled-agent (scale=2) → "idle (×2)"
    const scaledRow = page.locator('tr[data-agent="scaled-agent"]');
    await expect(scaledRow).toBeVisible();
    await expect(scaledRow.locator("td").nth(1)).toContainText("idle");
    await expect(scaledRow.locator("td").nth(1)).toContainText("×2");
  });

  test("Kill button disabled when agent is idle", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await expect(row.locator("button", { hasText: "Kill" })).toBeDisabled();
  });

  test("Kill button enables when agent is running", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await expect(row.locator("button", { hasText: "Kill" })).toBeDisabled();
    await row.locator("button", { hasText: "Run" }).click();
    await expect(row.locator("button", { hasText: "Kill" })).toBeEnabled({ timeout: 5000 });
  });

  test("Run button disabled after disabling agent", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await expect(row.locator("button", { hasText: "Run" })).toBeEnabled();
    await row.locator("button", { hasText: "Disable" }).click();
    await expect(row.locator("button", { hasText: "Run" })).toBeDisabled({ timeout: 5000 });
  });

  test("Run button re-enables after enabling agent", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await row.locator("button", { hasText: "Disable" }).click();
    await expect(row.locator("button", { hasText: "Run" })).toBeDisabled({ timeout: 5000 });
    await row.locator("button", { hasText: "Enable" }).click();
    await expect(row.locator("button", { hasText: "Run" })).toBeEnabled({ timeout: 5000 });
  });

  test("disabled agent row has reduced opacity", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await row.locator("button", { hasText: "Disable" }).click();
    await expect(row).toHaveClass(/opacity-50/, { timeout: 5000 });
  });

  test("Run triggers agent — SSE updates state to running", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await row.locator("button", { hasText: "Run" }).click();
    await expect(row.locator("td").nth(1)).toContainText("running", { timeout: 5000 });
  });

  test("Run on scale=2 shows running 1/2, not 2/2 (regression)", async ({ page }) => {
    const row = page.locator('tr[data-agent="scaled-agent"]');
    await row.locator("button", { hasText: "Run" }).click();
    const stateCell = row.locator("td").nth(1);
    await expect(stateCell).toContainText("running", { timeout: 5000 });
    await expect(stateCell).toContainText("1/2");
    await expect(stateCell).not.toContainText("2/2");
  });

  test("Kill confirms and transitions to idle, Kill button disables again", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await row.locator("button", { hasText: "Run" }).click();
    await expect(row.locator("td").nth(1)).toContainText("running", { timeout: 5000 });
    await expect(row.locator("button", { hasText: "Kill" })).toBeEnabled({ timeout: 5000 });

    page.once("dialog", (d) => d.accept());
    await row.locator("button", { hasText: "Kill" }).click();
    await expect(row.locator("td").nth(1)).toContainText("idle", { timeout: 5000 });
    await expect(row.locator("button", { hasText: "Kill" })).toBeDisabled({ timeout: 5000 });
  });

  test("Kill cancel leaves agent running", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await row.locator("button", { hasText: "Run" }).click();
    await expect(row.locator("td").nth(1)).toContainText("running", { timeout: 5000 });

    page.once("dialog", (d) => d.dismiss());
    await row.locator("button", { hasText: "Kill" }).click();
    await page.waitForTimeout(500);
    await expect(row.locator("td").nth(1)).toContainText("running");
  });

  test("Disable changes button to Enable via SSE", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await expect(row.locator("button", { hasText: "Disable" })).toBeVisible();
    await row.locator("button", { hasText: "Disable" }).click();
    await expect(row.locator("button", { hasText: "Enable" })).toBeVisible({ timeout: 5000 });
  });

  test("Enable re-enables a disabled agent", async ({ page }) => {
    const row = page.locator('tr[data-agent="single-agent"]');
    await row.locator("button", { hasText: "Disable" }).click();
    await expect(row.locator("button", { hasText: "Enable" })).toBeVisible({ timeout: 5000 });
    await row.locator("button", { hasText: "Enable" }).click();
    await expect(row.locator("button", { hasText: "Disable" })).toBeVisible({ timeout: 5000 });
  });

  test("Pause/Resume button toggles scheduler state", async ({ page }) => {
    const btn = page.locator("#pause-btn");
    await expect(btn).toContainText("Pause");
    await btn.click();
    await expect(btn).toContainText("Resume", { timeout: 5000 });
    await btn.click();
    await expect(btn).toContainText("Pause", { timeout: 5000 });
  });

  test("Config link navigates to project config", async ({ page }) => {
    await page.click('a[href="/dashboard/config"]');
    await page.waitForURL("**/dashboard/config");
    await expect(page.locator("h1")).toContainText("Project Configuration");
  });

  test("View all triggers link navigates to trigger history", async ({ page }) => {
    await page.click('a[href="/dashboard/triggers"]');
    await page.waitForURL("**/dashboard/triggers");
    await expect(page.locator("h1")).toContainText("Trigger History");
  });

  test("agent name link navigates to agent detail", async ({ page }) => {
    await page.click('a[href="/dashboard/agents/single-agent"]');
    await page.waitForURL("**/dashboard/agents/single-agent");
    await expect(page.locator("h1")).toContainText("single-agent");
  });

  test("theme toggle switches dark/light mode", async ({ page }) => {
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.click("#theme-toggle");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.click("#theme-toggle");
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("session stat cards are visible", async ({ page }) => {
    await expect(page.locator("#stat-tokens")).toBeVisible();
    await expect(page.locator("#stat-cost")).toBeVisible();
  });

  test("recent activity section is visible", async ({ page }) => {
    await expect(page.locator("#recent-logs")).toBeVisible();
  });
});

// ──── Agent detail ────────────────────────────────────────────────────

test.describe("Agent detail", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetState(request);
    await login(page);
    await page.goto("/dashboard/agents/single-agent");
  });

  test("shows agent name and idle state", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("single-agent");
    await expect(page.locator("#agent-state")).toContainText("idle");
  });

  test("Run button triggers agent and SSE updates state", async ({ page }) => {
    await page.click("button:has-text('Run')");
    await expect(page.locator("#agent-state")).toContainText("running", { timeout: 5000 });
  });

  test("Settings tab is visible", async ({ page }) => {
    const link = page.locator('a[href="/dashboard/agents/single-agent/settings"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText("Settings");
  });

  test("Kill All button is disabled when no instances running", async ({ page }) => {
    await expect(page.locator("#agent-kill-btn")).toBeDisabled();
  });

  test("Kill All enables and works after triggering a run", async ({ page }) => {
    await page.click("button:has-text('Run')");
    await expect(page.locator("#agent-state")).toContainText("running", { timeout: 5000 });
    await expect(page.locator("#running-section")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#agent-kill-btn")).toBeEnabled({ timeout: 5000 });

    // Kill All (accept confirm)
    page.once("dialog", (d) => d.accept());
    await page.click("#agent-kill-btn");
    await expect(page.locator("#agent-state")).toContainText("idle", { timeout: 5000 });
    await expect(page.locator("#running-section")).toBeHidden({ timeout: 5000 });
  });

  test("breadcrumb Dashboard link navigates back", async ({ page }) => {
    await page.click('nav a[href="/dashboard"]');
    await page.waitForURL("**/dashboard");
    await expect(page.locator("h1")).toContainText("Dashboard");
  });

  test("instance history shows no run history", async ({ page }) => {
    await expect(page.locator("#history-body")).toContainText("No run history", { timeout: 5000 });
  });

  test("running instances section hidden when no instances", async ({ page }) => {
    await expect(page.locator("#running-section")).toBeHidden();
  });

  test("running instances section appears after trigger", async ({ page }) => {
    await page.click("button:has-text('Run')");
    await expect(page.locator("#running-section")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#running-instances")).toBeVisible();
  });
});

// ──── Agent admin ─────────────────────────────────────────────────────

test.describe("Agent admin", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetState(request);
    await login(page);
    await page.goto("/dashboard/agents/single-agent/settings");
  });

  test("shows agent name and Settings tab", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("single-agent");
    await expect(page.locator("text=Settings")).toBeVisible();
  });

  test("scale input shows current value and Update button exists", async ({ page }) => {
    await expect(page.locator("#agent-scale-input")).toBeVisible();
    await expect(page.locator("#agent-scale-input")).toHaveValue("1");
    await expect(page.locator("#update-agent-scale-btn")).toBeVisible();
  });

  test("scale update shows success alert", async ({ page }) => {
    const dialogPromise = page.waitForEvent("dialog");
    await page.fill("#agent-scale-input", "3");
    await page.click("#update-agent-scale-btn");
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("Agent scale updated");
    await dialog.accept();
  });

  test("Enable/Disable toggle updates via SSE", async ({ page }) => {
    const btn = page.locator("#toggle-btn");
    await expect(btn).toContainText("Disable");
    await btn.click();
    await expect(btn).toContainText("Enable", { timeout: 5000 });
    await btn.click();
    await expect(btn).toContainText("Disable", { timeout: 5000 });
  });

  test("skill route redirects to settings", async ({ page }) => {
    await page.goto("/dashboard/agents/single-agent/skill");
    await page.waitForURL("**/dashboard/agents/single-agent/settings");
    await expect(page.locator("h1")).toContainText("single-agent");
  });
});

// ──── Agent detail (scaled) ───────────────────────────────────────────

test.describe("Agent detail — scaled agent", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetState(request);
    await login(page);
    await page.goto("/dashboard/agents/scaled-agent/settings");
  });

  test("shows scale=2 in the scale input", async ({ page }) => {
    await expect(page.locator("#agent-scale-input")).toHaveValue("2");
  });
});

// ──── Project config ──────────────────────────────────────────────────

test.describe("Project config", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetState(request);
    await login(page);
    await page.goto("/dashboard/config");
  });

  test("shows project scale input with default value", async ({ page }) => {
    await expect(page.locator("#project-scale-input")).toBeVisible();
    await expect(page.locator("#project-scale-input")).toHaveValue("5");
  });

  test("scale update shows success alert", async ({ page }) => {
    const dialogPromise = page.waitForEvent("dialog");
    await page.fill("#project-scale-input", "10");
    await page.click("#update-project-scale-btn");
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain("Project scale updated");
    await dialog.accept();
  });

  test("Pause All confirms then pauses", async ({ page, request }) => {
    page.on("dialog", (d) => d.accept());
    await page.click("button:has-text('Pause All Agents')");
    await page.waitForTimeout(1000);
    const resp = await request.get("/control/status", { headers: AUTH });
    const data = await resp.json();
    expect(data.scheduler.paused).toBe(true);
  });

  test("Resume All resumes after pause", async ({ page, request }) => {
    await request.post("/control/pause", { headers: AUTH });
    page.on("dialog", (d) => d.accept());
    await page.click("button:has-text('Resume All Agents')");
    await page.waitForTimeout(1000);
    const resp = await request.get("/control/status", { headers: AUTH });
    const data = await resp.json();
    expect(data.scheduler.paused).toBe(false);
  });

  test("breadcrumb Dashboard link navigates back", async ({ page }) => {
    await page.click('nav a[href="/dashboard"]');
    await page.waitForURL("**/dashboard");
    await expect(page.locator("h1")).toContainText("Dashboard");
  });
});

// ──── Trigger history ─────────────────────────────────────────────────

test.describe("Trigger history", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetState(request);
    await login(page);
    await page.goto("/dashboard/triggers");
  });

  test("shows page heading", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Trigger History");
  });

  test("shows empty state when no triggers", async ({ page }) => {
    await expect(page.locator("text=No triggers found")).toBeVisible();
  });

  test("dead letters checkbox is present", async ({ page }) => {
    await expect(page.locator('input[type="checkbox"]')).toBeVisible();
    await expect(page.locator("text=Show dead letters")).toBeVisible();
  });

  test("page info shows Page 1 of 1", async ({ page }) => {
    await expect(page.locator("text=Page 1 of 1")).toBeVisible();
  });
});

// ──── Navigation ──────────────────────────────────────────────────────

test.describe("Navigation", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetState(request);
    await login(page);
  });

  test("logo links to dashboard from any page", async ({ page }) => {
    await page.goto("/dashboard/config");
    await page.click('a:has-text("Action Llama")');
    await page.waitForURL("**/dashboard");
  });

  test("root / redirects to dashboard", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/dashboard");
  });

  test("nonexistent agent shows unknown state", async ({ page }) => {
    await page.goto("/dashboard/agents/nonexistent-agent");
    await expect(page.locator("h1")).toContainText("nonexistent-agent");
    await expect(page.locator("#agent-state")).toContainText("unknown");
  });
});
