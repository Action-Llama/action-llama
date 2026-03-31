import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  extractTitle,
  stripFrontmatter,
  stripMintlifyComponents,
  processMdxFile,
  processDocPage,
  buildOutputFile,
  buildAll,
  DOC_MAPPING,
} from "../src/build-docs.js";

describe("extractTitle", () => {
  it("extracts quoted title from frontmatter", () => {
    const content = '---\ntitle: "My Page"\ndescription: "desc"\n---\n\nBody';
    expect(extractTitle(content)).toBe("My Page");
  });

  it("extracts unquoted title from frontmatter", () => {
    const content = "---\ntitle: My Page\n---\n\nBody";
    expect(extractTitle(content)).toBe("My Page");
  });

  it("returns null when no frontmatter", () => {
    expect(extractTitle("# Just markdown")).toBeNull();
  });

  it("returns null when frontmatter has no title", () => {
    const content = '---\ndescription: "desc"\n---\n\nBody';
    expect(extractTitle(content)).toBeNull();
  });
});

describe("stripFrontmatter", () => {
  it("removes YAML frontmatter", () => {
    const content = '---\ntitle: "Test"\n---\n\nBody text';
    expect(stripFrontmatter(content)).toBe("Body text");
  });

  it("returns content unchanged when no frontmatter", () => {
    const content = "# Just markdown\n\nBody";
    expect(stripFrontmatter(content)).toBe("# Just markdown\n\nBody");
  });

  it("handles multiple newlines after frontmatter", () => {
    const content = '---\ntitle: "Test"\n---\n\n\n\nBody';
    expect(stripFrontmatter(content)).toBe("Body");
  });
});

describe("stripMintlifyComponents", () => {
  it("strips <Info> tags keeping content", () => {
    const content = "<Info>Important note here.</Info>";
    expect(stripMintlifyComponents(content)).toBe("Important note here.");
  });

  it("strips <Note> tags keeping content", () => {
    const content = "<Note>A note.</Note>";
    expect(stripMintlifyComponents(content)).toBe("A note.");
  });

  it("strips <Warning> tags keeping content", () => {
    const content = "<Warning>Be careful!</Warning>";
    expect(stripMintlifyComponents(content)).toBe("Be careful!");
  });

  it("strips multiline component tags", () => {
    const content = "<Info>\nLine one.\nLine two.\n</Info>";
    expect(stripMintlifyComponents(content)).toBe("\nLine one.\nLine two.\n");
  });

  it("strips <CardGroup> and <Card> tags", () => {
    const content = '<CardGroup cols={2}>\n  <Card title="Hello" href="/hello">\n    Description\n  </Card>\n</CardGroup>';
    const result = stripMintlifyComponents(content);
    expect(result).not.toContain("<CardGroup");
    expect(result).not.toContain("<Card");
    expect(result).toContain("Description");
  });

  it("removes self-closing tags", () => {
    const content = 'Text before <Card title="Hello" href="/hello" /> text after';
    const result = stripMintlifyComponents(content);
    expect(result).toBe("Text before  text after");
  });

  it("strips <Steps> and <Step> tags", () => {
    const content = "<Steps>\n<Step title=\"First\">\nDo this.\n</Step>\n</Steps>";
    const result = stripMintlifyComponents(content);
    expect(result).not.toContain("<Steps");
    expect(result).not.toContain("<Step");
    expect(result).toContain("Do this.");
  });

  it("collapses excessive blank lines", () => {
    const content = "Line 1\n\n\n\n\nLine 2";
    expect(stripMintlifyComponents(content)).toBe("Line 1\n\nLine 2");
  });

  it("preserves normal markdown", () => {
    const content = "# Heading\n\nSome **bold** text.\n\n```bash\necho hello\n```";
    expect(stripMintlifyComponents(content)).toBe(content);
  });
});

describe("processMdxFile", () => {
  it("extracts title and strips frontmatter + components", () => {
    const content = '---\ntitle: "My Page"\n---\n\n<Info>Note here.</Info>\n\n## Section\n\nBody text.';
    const result = processMdxFile(content);
    expect(result.title).toBe("My Page");
    expect(result.body).toContain("Note here.");
    expect(result.body).toContain("## Section");
    expect(result.body).not.toContain("<Info>");
    expect(result.body).not.toContain("---");
  });
});

describe("processDocPage", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads and processes an MDX file", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-docs-"));
    mkdirSync(join(tmpDir, "reference"), { recursive: true });
    writeFileSync(
      join(tmpDir, "reference", "cli-commands.mdx"),
      '---\ntitle: "CLI Commands"\ndescription: "All commands"\n---\n\n## al run\n\nRun an agent.\n'
    );

    const result = processDocPage(tmpDir, "reference/cli-commands");
    expect(result).toContain("# CLI Commands");
    expect(result).toContain("## al run");
    expect(result).toContain("Run an agent.");
  });

  it("throws when file does not exist", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-docs-"));
    expect(() => processDocPage(tmpDir, "nonexistent")).toThrow("Doc file not found");
  });

  it("uses filename as fallback heading when no title", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-docs-"));
    writeFileSync(join(tmpDir, "page.mdx"), "Just content, no frontmatter.\n");

    const result = processDocPage(tmpDir, "page");
    expect(result).toContain("# page");
  });
});

describe("buildOutputFile", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("concatenates multiple doc pages with separators", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "al-docs-"));
    mkdirSync(join(tmpDir, "concepts"), { recursive: true });
    mkdirSync(join(tmpDir, "reference"), { recursive: true });

    writeFileSync(
      join(tmpDir, "concepts", "agents.mdx"),
      '---\ntitle: "Agents"\n---\n\nAgents are autonomous.\n'
    );
    writeFileSync(
      join(tmpDir, "reference", "config.mdx"),
      '---\ntitle: "Configuration"\n---\n\nConfig uses TOML.\n'
    );

    const result = buildOutputFile(tmpDir, ["concepts/agents", "reference/config"]);
    expect(result).toContain("# Agents");
    expect(result).toContain("Agents are autonomous.");
    expect(result).toContain("---");
    expect(result).toContain("# Configuration");
    expect(result).toContain("Config uses TOML.");
  });
});

describe("buildAll", () => {
  let tmpDocsDir: string;
  let tmpOutputDir: string;

  afterEach(() => {
    if (tmpDocsDir) rmSync(tmpDocsDir, { recursive: true, force: true });
    if (tmpOutputDir) rmSync(tmpOutputDir, { recursive: true, force: true });
  });

  it("generates all output files from a mock docs tree", () => {
    tmpDocsDir = mkdtempSync(join(tmpdir(), "al-docs-"));
    tmpOutputDir = mkdtempSync(join(tmpdir(), "al-output-"));

    // Create all required doc files from DOC_MAPPING
    const allPages = new Set<string>();
    for (const pages of Object.values(DOC_MAPPING)) {
      for (const page of pages) allPages.add(page);
    }

    for (const page of allPages) {
      const dir = resolve(tmpDocsDir, ...page.split("/").slice(0, -1));
      mkdirSync(dir, { recursive: true });
      const name = page.split("/").pop()!;
      const title = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      writeFileSync(
        resolve(tmpDocsDir, `${page}.mdx`),
        `---\ntitle: "${title}"\ndescription: "Test page"\n---\n\nContent for ${page}.\n`
      );
    }

    buildAll(tmpDocsDir, tmpOutputDir);

    // Verify all output files were created
    for (const filename of Object.keys(DOC_MAPPING)) {
      const filePath = resolve(tmpOutputDir, filename);
      expect(existsSync(filePath), `${filename} should exist`).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);

      // Each page should produce a section with its title
      for (const page of DOC_MAPPING[filename]) {
        expect(content).toContain(`Content for ${page}.`);
      }
    }
  });

  it("creates output directory if it does not exist", () => {
    tmpDocsDir = mkdtempSync(join(tmpdir(), "al-docs-"));
    tmpOutputDir = join(mkdtempSync(join(tmpdir(), "al-output-")), "nested", "dir");

    // Create minimal docs
    const allPages = new Set<string>();
    for (const pages of Object.values(DOC_MAPPING)) {
      for (const page of pages) allPages.add(page);
    }
    for (const page of allPages) {
      const dir = resolve(tmpDocsDir, ...page.split("/").slice(0, -1));
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(tmpDocsDir, `${page}.mdx`), `---\ntitle: "T"\n---\n\nC.\n`);
    }

    buildAll(tmpDocsDir, tmpOutputDir);
    expect(existsSync(tmpOutputDir)).toBe(true);
  });
});

describe("DOC_MAPPING covers all docs", () => {
  it("all mapped pages exist in the docs package", () => {
    const docsDir = resolve(__dirname, "..", "..", "docs");
    // Skip if docs package isn't available (e.g. in CI without full monorepo)
    if (!existsSync(resolve(docsDir, "docs.json"))) return;

    for (const [output, pages] of Object.entries(DOC_MAPPING)) {
      for (const page of pages) {
        const filePath = resolve(docsDir, `${page}.mdx`);
        expect(existsSync(filePath), `${page}.mdx should exist (mapped to ${output})`).toBe(true);
      }
    }
  });
});
