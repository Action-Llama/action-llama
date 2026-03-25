/**
 * al add — install a skill from a git repository.
 *
 * 1. Fetch repo (shallow clone to temp dir)
 * 2. Discover SKILL.md files (root or skills/star/)
 * 3. If multiple and no --agent, prompt user to pick
 * 4. Copy SKILL.md + config.toml into agents dir
 * 5. Run al config for interactive gap-filling
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { resolve, basename } from "path";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, readdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { select, input } from "@inquirer/prompts";
import { validateAgentName } from "../../shared/config.js";
import { parseFrontmatter } from "../../shared/frontmatter.js";
import { parse as parseTOML, stringify as stringifyTOML } from "smol-toml";

interface DiscoveredSkill {
  name: string;
  description?: string;
  skillMdPath: string;
  configTomlPath?: string;
  dockerfilePath?: string;
}

// Discover SKILL.md files in a cloned repo.
// Checks: root SKILL.md (single-skill repo), then skills/*/ and agents/*/ (collection).
function discoverSkills(repoPath: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];

  // Check root-level SKILL.md (single-skill repo)
  const rootSkill = resolve(repoPath, "SKILL.md");
  if (existsSync(rootSkill)) {
    const { name, description } = readSkillMeta(rootSkill);
    skills.push({
      name: name || basename(repoPath),
      description,
      skillMdPath: rootSkill,
      configTomlPath: existsSync(resolve(repoPath, "config.toml"))
        ? resolve(repoPath, "config.toml")
        : undefined,
      dockerfilePath: existsSync(resolve(repoPath, "Dockerfile"))
        ? resolve(repoPath, "Dockerfile")
        : undefined,
    });
  }

  // Check skills/*/ and agents/*/ (collection repos)
  for (const dirName of ["skills", "agents"]) {
    const collectionDir = resolve(repoPath, dirName);
    if (!existsSync(collectionDir) || !statSync(collectionDir).isDirectory()) continue;

    for (const entry of readdirSync(collectionDir)) {
      const entryPath = resolve(collectionDir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const skillMd = resolve(entryPath, "SKILL.md");
      if (!existsSync(skillMd)) continue;

      // Skip duplicates (if root SKILL.md already matched this name)
      const { name, description } = readSkillMeta(skillMd);
      const skillName = name || entry;
      if (skills.some((s) => s.name === skillName)) continue;

      skills.push({
        name: skillName,
        description,
        skillMdPath: skillMd,
        configTomlPath: existsSync(resolve(entryPath, "config.toml"))
          ? resolve(entryPath, "config.toml")
          : undefined,
        dockerfilePath: existsSync(resolve(entryPath, "Dockerfile"))
          ? resolve(entryPath, "Dockerfile")
          : undefined,
      });
    }
  }

  return skills;
}

function readSkillMeta(skillMdPath: string): { name?: string; description?: string } {
  try {
    const raw = readFileSync(skillMdPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
    };
  } catch {
    return {};
  }
}

function normalizeRepo(repo: string): string {
  // GitHub shorthand: author/repo -> https://github.com/author/repo.git
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(repo)) {
    return `https://github.com/${repo}.git`;
  }
  return repo;
}

export async function execute(
  repo: string,
  opts: { agent?: string; project: string },
): Promise<void> {
  const projectPath = resolve(opts.project);
  const agentsDir = resolve(projectPath, "agents");

  // 1. Clone to temp dir
  const tmpDir = mkdtempSync(resolve(tmpdir(), "al-add-"));
  try {
    const gitUrl = normalizeRepo(repo);
    console.log(`Fetching ${gitUrl}...`);
    execFileSync("git", ["clone", "--depth", "1", "--single-branch", gitUrl, tmpDir], {
      stdio: "pipe",
    });

    // 2. Discover skills
    const skills = discoverSkills(tmpDir);
    if (skills.length === 0) {
      throw new Error(`No SKILL.md files found in ${repo}.`);
    }

    // 3. Select skill
    let skill: DiscoveredSkill;
    if (opts.agent) {
      const match = skills.find((s) => s.name === opts.agent);
      if (!match) {
        const available = skills.map((s) => s.name).join(", ");
        throw new Error(
          `Agent "${opts.agent}" not found. Available: ${available}`,
        );
      }
      skill = match;
    } else if (skills.length === 1) {
      skill = skills[0];
    } else {
      skill = await select({
        message: "Select a skill to install:",
        choices: skills.map((s) => ({
          name: s.description ? `${s.name} — ${s.description}` : s.name,
          value: s,
        })),
      });
    }

    // 4. Determine agent directory name
    let agentName = skill.name;

    // Validate name format
    try {
      validateAgentName(agentName);
    } catch {
      agentName = await input({
        message: `Skill name "${skill.name}" is not a valid agent name. Enter a name:`,
        validate: (v) => {
          try {
            validateAgentName(v);
            return true;
          } catch (err: any) {
            return err.message;
          }
        },
      });
    }

    // Check for conflicts
    const agentDir = resolve(agentsDir, agentName);
    if (existsSync(agentDir)) {
      agentName = await input({
        message: `Agent "${agentName}" already exists. Enter a different name:`,
        validate: (v) => {
          try {
            validateAgentName(v);
          } catch (err: any) {
            return err.message;
          }
          if (existsSync(resolve(agentsDir, v))) {
            return `Agent "${v}" already exists.`;
          }
          return true;
        },
      });
    }

    // 5. Copy files
    const destDir = resolve(agentsDir, agentName);
    mkdirSync(destDir, { recursive: true });

    copyFileSync(skill.skillMdPath, resolve(destDir, "SKILL.md"));

    if (skill.configTomlPath) {
      // Copy config.toml and add source field
      const rawToml = readFileSync(skill.configTomlPath, "utf-8");
      let configObj: Record<string, unknown>;
      try {
        configObj = parseTOML(rawToml) as Record<string, unknown>;
      } catch {
        configObj = {};
      }
      configObj.source = repo;
      const { writeFileSync } = await import("fs");
      writeFileSync(resolve(destDir, "config.toml"), stringifyTOML(configObj) + "\n");
    } else {
      // Create minimal config.toml with just source
      const { writeFileSync } = await import("fs");
      writeFileSync(resolve(destDir, "config.toml"), stringifyTOML({ source: repo }) + "\n");
    }

    if (skill.dockerfilePath) {
      copyFileSync(skill.dockerfilePath, resolve(destDir, "Dockerfile"));
    }

    console.log(`Installed skill "${skill.name}" as agent "${agentName}".`);

    // 6. Run al config for interactive gap-filling
    const { configAgent } = await import("./agent.js");
    await configAgent(agentName, { project: opts.project });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
