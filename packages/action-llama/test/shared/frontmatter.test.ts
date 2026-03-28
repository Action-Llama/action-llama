import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/shared/frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses valid YAML frontmatter", () => {
    const content = `---
name: my-agent
version: 1.0.0
---
Body content here.
`;
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({ name: "my-agent", version: "1.0.0" });
    expect(result.body).toBe("Body content here.\n");
  });

  it("returns empty data and original body when content does not start with ---", () => {
    const content = "Just plain text without frontmatter";
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
  });

  it("returns empty data and original body when frontmatter is not closed", () => {
    const content = `---
name: my-agent
No closing delimiter`;
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe(content);
  });

  it("returns empty data when YAML frontmatter contains an array (not an object)", () => {
    const content = `---
- item1
- item2
---
Body here.
`;
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    // When array is parsed, returns original content
    expect(result.body).toBe(content);
  });

  it("throws when frontmatter contains invalid YAML", () => {
    const content = `---
name: [invalid: yaml: { broken
---
Body.
`;
    expect(() => parseFrontmatter(content)).toThrow("Failed to parse YAML frontmatter");
  });

  it("handles content with leading whitespace before ---", () => {
    const content = `   
---
key: value
---
Body.
`;
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({ key: "value" });
    expect(result.body).toBe("Body.\n");
  });

  it("returns empty data for content with only ---", () => {
    const content = `---
---
Just body.
`;
    const result = parseFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.body).toBe("Just body.\n");
  });

  it("preserves body content after closing delimiter", () => {
    const content = `---
title: Hello
---
Line one.
Line two.
`;
    const result = parseFrontmatter(content);
    expect(result.body).toBe("Line one.\nLine two.\n");
  });
});
