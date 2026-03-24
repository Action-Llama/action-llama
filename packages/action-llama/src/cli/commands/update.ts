/**
 * `al update [agent]` — update installed skills from their source repos.
 *
 * For each agent with a `source` field in config.toml:
 * 1. Clone the source repo (shallow)
 * 2. Discover the matching SKILL.md
 * 3. Diff local vs upstream SKILL.md
 * 4. If different, prompt user to accept the update
 * 5. Copy updated SKILL.md (config.toml is never touched)
 */

import { existsSync, readFileSync, copyFileSync } from "fs";
import { resolve, basename } from "path";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, readdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { confirm } from "@inquirer/prompts";
import { parse as parseTOML } from "smol-toml";
import { discoverAgents } from "../../shared/config.js";

interface UpdateCandidate {
  agentName: string;
  source: string;
  localSkillMd: string;
}

export async function execute(
  agentName: string | undefined,
  opts: { project: string },
): Promise<void> {
  const projectPath = resolve(opts.project);

  // Find agents with source fields
  const candidates = findUpdateCandidates(projectPath, agentName);

  if (candidates.length === 0) {
    if (agentName) {
      console.log(`Agent "${agentName}" has no source field in config.toml — nothing to update.`);
    } else {
      console.log("No agents have a source field in config.toml — nothing to update.");
    }
    return;
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const result = await updateAgent(candidate);
      if (result === "updated") updated++;
      else if (result === "skipped") skipped++;
      else if (result === "up-to-date") {
        console.log(`${candidate.agentName}: already up to date.`);
      }
    } catch (err: any) {
      console.error(`${candidate.agentName}: failed — ${err.message}`);
      failed++;
    }
  }

  // Summary
  if (candidates.length > 1) {
    const parts: string[] = [];
    if (updated > 0) parts.push(`${updated} updated`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    const upToDate = candidates.length - updated - skipped - failed;
    if (upToDate > 0) parts.push(`${upToDate} up to date`);
    console.log(`\nDone: ${parts.join(", ")}.`);
  }
}

function findUpdateCandidates(
  projectPath: string,
  filterAgent?: string,
): UpdateCandidate[] {
  const agents = discoverAgents(projectPath);
  const candidates: UpdateCandidate[] = [];

  for (const name of agents) {
    if (filterAgent && name !== filterAgent) continue;

    const agentDir = resolve(projectPath, "agents", name);
    const configPath = resolve(agentDir, "config.toml");
    const skillMdPath = resolve(agentDir, "SKILL.md");

    if (!existsSync(configPath) || !existsSync(skillMdPath)) continue;

    try {
      const raw = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      if (typeof raw.source === "string" && raw.source.trim()) {
        candidates.push({
          agentName: name,
          source: raw.source,
          localSkillMd: skillMdPath,
        });
      }
    } catch {
      // Skip agents with unparseable config
    }
  }

  if (filterAgent && candidates.length === 0) {
    // Check if the agent exists but has no source
    const agentDir = resolve(projectPath, "agents", filterAgent);
    if (!existsSync(agentDir)) {
      throw new Error(`Agent "${filterAgent}" not found.`);
    }
  }

  return candidates;
}

function normalizeRepo(repo: string): string {
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(repo)) {
    return `https://github.com/${repo}.git`;
  }
  return repo;
}

async function updateAgent(
  candidate: UpdateCandidate,
): Promise<"updated" | "skipped" | "up-to-date"> {
  const { agentName, source } = candidate;
  const gitUrl = normalizeRepo(source);

  console.log(`${agentName}: checking ${source}...`);

  const tmpDir = mkdtempSync(resolve(tmpdir(), "al-update-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", "--single-branch", gitUrl, tmpDir], {
      stdio: "pipe",
    });

    // Find the matching SKILL.md in the cloned repo
    const upstreamSkillMd = findUpstreamSkillMd(tmpDir, agentName);
    if (!upstreamSkillMd) {
      throw new Error(`No SKILL.md found in ${source}`);
    }

    // Compare content
    const localContent = readFileSync(candidate.localSkillMd, "utf-8");
    const upstreamContent = readFileSync(upstreamSkillMd, "utf-8");

    if (localContent === upstreamContent) {
      return "up-to-date";
    }

    // Show diff summary
    console.log(`${agentName}: SKILL.md has changed upstream.`);
    showDiffSummary(localContent, upstreamContent);

    const shouldUpdate = await confirm({
      message: `Update ${agentName}'s SKILL.md?`,
      default: true,
    });

    if (!shouldUpdate) {
      return "skipped";
    }

    copyFileSync(upstreamSkillMd, candidate.localSkillMd);
    console.log(`${agentName}: SKILL.md updated.`);
    return "updated";
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Find the SKILL.md in a cloned repo that corresponds to the given agent.
 * Checks: root SKILL.md, skills/agentName/SKILL.md, any single skill in skills dir.
 */
function findUpstreamSkillMd(repoPath: string, agentName: string): string | null {
  // Check skills/<agentName>/SKILL.md first (collection repos)
  const namedSkill = resolve(repoPath, "skills", agentName, "SKILL.md");
  if (existsSync(namedSkill)) return namedSkill;

  // Check root SKILL.md (single-skill repos)
  const rootSkill = resolve(repoPath, "SKILL.md");
  if (existsSync(rootSkill)) return rootSkill;

  // Fall back to any skills/*/SKILL.md if there's exactly one
  const skillsDir = resolve(repoPath, "skills");
  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    const entries = readdirSync(skillsDir).filter((entry) => {
      const entryPath = resolve(skillsDir, entry);
      return statSync(entryPath).isDirectory() && existsSync(resolve(entryPath, "SKILL.md"));
    });
    if (entries.length === 1) {
      return resolve(skillsDir, entries[0], "SKILL.md");
    }
  }

  return null;
}

function showDiffSummary(local: string, upstream: string): void {
  const localLines = local.split("\n");
  const upstreamLines = upstream.split("\n");

  const added = upstreamLines.length - localLines.length;
  if (added > 0) {
    console.log(`  +${added} lines`);
  } else if (added < 0) {
    console.log(`  ${added} lines`);
  }

  // Count changed lines (simple comparison)
  let changed = 0;
  const maxLen = Math.min(localLines.length, upstreamLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (localLines[i] !== upstreamLines[i]) changed++;
  }
  if (changed > 0) {
    console.log(`  ~${changed} lines modified`);
  }
}
