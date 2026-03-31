/**
 * Build script that generates skill supporting files from the docs package.
 *
 * Reads docs.json for navigation structure, reads MDX source files,
 * strips Mintlify components, and concatenates them into skill
 * supporting files grouped by topic.
 *
 * Usage: node --import tsx/esm src/build-docs.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, "..", "..", "docs");
const SKILLS_DIR = resolve(__dirname, "..", "skills", "al");

/** Mapping of output filename → list of doc page paths (relative to docs dir, no extension). */
export const DOC_MAPPING: Record<string, string[]> = {
  "agent-authoring.md": [
    "concepts/agents",
    "reference/agent-config",
    "reference/agent-docs",
    "reference/credentials",
    "reference/models",
    "reference/webhooks",
    "reference/webhooks/github",
    "reference/webhooks/sentry",
    "reference/webhooks/linear",
    "reference/webhooks/mintlify",
    "reference/webhooks/slack",
    "reference/webhooks/twitter",
  ],
  "operations.md": [
    "first-steps/getting-started",
    "first-steps/using-webhooks",
    "reference/cli-commands",
    "reference/project-config",
    "concepts/scheduler",
    "reference/dockerfiles",
    "guides/deploying-to-vps",
    "guides/cloud-run-runtime",
    "guides/continuous-deployment",
    "guides/custom-dockerfiles",
    "reference/gateway-api",
    "reference/web-dashboard",
  ],
  "debugging.md": [
    "reference/agent-commands",
    "concepts/runtime-context",
    "concepts/resource-locks",
    "guides/dynamic-context",
    "guides/shared-context",
    "guides/subagents",
    "guides/scaling-agents",
  ],
};

/** Extract title from YAML frontmatter. */
export function extractTitle(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const titleMatch = match[1].match(/^title:\s*"?([^"\n]+)"?\s*$/m);
  return titleMatch ? titleMatch[1] : null;
}

/** Strip YAML frontmatter from MDX content. */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, "");
}

/**
 * Strip Mintlify JSX components, keeping their text content.
 * Handles: <Info>, <Note>, <Warning>, <Tip>, <CardGroup>, <Card>, <Steps>, <Step>, etc.
 */
export function stripMintlifyComponents(content: string): string {
  // Remove self-closing tags: <Card ... />
  let result = content.replace(/<\w+\s+[^>]*\/>/g, "");

  // Remove opening and closing tags, keeping inner content
  // Handles both single-line and multi-line: <Info>text</Info>
  result = result.replace(/<(Info|Note|Warning|Tip|CardGroup|Card|Steps|Step|Accordion|AccordionGroup|Tab|Tabs|Frame|Snippet|Check|ResponseField|Expandable|ParamField)(\s[^>]*)?>/gi, "");
  result = result.replace(/<\/(Info|Note|Warning|Tip|CardGroup|Card|Steps|Step|Accordion|AccordionGroup|Tab|Tabs|Frame|Snippet|Check|ResponseField|Expandable|ParamField)>/gi, "");

  // Clean up excessive blank lines (3+ → 2)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

/** Process a single MDX file into clean markdown. */
export function processMdxFile(content: string): { title: string | null; body: string } {
  const title = extractTitle(content);
  let body = stripFrontmatter(content);
  body = stripMintlifyComponents(body);
  return { title, body: body.trim() };
}

/** Read and process a doc page, returning formatted markdown section. */
export function processDocPage(docsDir: string, pagePath: string): string {
  const filePath = resolve(docsDir, `${pagePath}.mdx`);
  if (!existsSync(filePath)) {
    throw new Error(`Doc file not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf-8");
  const { title, body } = processMdxFile(raw);

  // Wrap in a section with the title as H1
  const heading = title ? `# ${title}` : `# ${pagePath.split("/").pop()}`;
  return `${heading}\n\n${body}`;
}

/** Build a single output file from a list of doc pages. */
export function buildOutputFile(docsDir: string, pages: string[]): string {
  const sections = pages.map((page) => processDocPage(docsDir, page));
  return sections.join("\n\n---\n\n") + "\n";
}

/** Build all output files from the mapping. */
export function buildAll(docsDir: string, outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  for (const [filename, pages] of Object.entries(DOC_MAPPING)) {
    const content = buildOutputFile(docsDir, pages);
    writeFileSync(resolve(outputDir, filename), content);
  }
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const docsDir = process.argv[2] || DOCS_DIR;
  const outputDir = process.argv[3] || SKILLS_DIR;

  if (!existsSync(resolve(docsDir, "docs.json"))) {
    console.error(`docs.json not found in ${docsDir}`);
    process.exit(1);
  }

  buildAll(docsDir, outputDir);

  const totalPages = Object.values(DOC_MAPPING).reduce((sum, pages) => sum + pages.length, 0);
  console.log(`Built ${Object.keys(DOC_MAPPING).length} skill files from ${totalPages} doc pages → ${outputDir}`);
}
