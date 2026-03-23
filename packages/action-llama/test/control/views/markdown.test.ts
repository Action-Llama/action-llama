import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../../src/control/views/markdown.js";

describe("renderMarkdown", () => {
  describe("inline formatting", () => {
    it("renders inline code as <code> elements", () => {
      const result = renderMarkdown("Use `foo()` here");
      expect(result).toContain("<code");
      expect(result).toContain("foo()");
      expect(result).not.toContain("&lt;code");
    });

    it("renders bold as <strong>", () => {
      const result = renderMarkdown("This is **bold** text");
      expect(result).toContain('<strong class="font-semibold">bold</strong>');
      expect(result).not.toContain("&lt;strong");
    });

    it("renders italic as <em>", () => {
      const result = renderMarkdown("This is *italic* text");
      expect(result).toContain('<em class="italic">italic</em>');
      expect(result).not.toContain("&lt;em");
    });

    it("renders links as <a> elements", () => {
      const result = renderMarkdown("See [docs](https://example.com)");
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain(">docs</a>");
      expect(result).not.toContain("&lt;a");
    });

    it("renders mixed inline formatting in a single line", () => {
      const result = renderMarkdown("Use **bold** and `code` and *italic*");
      expect(result).toContain("<strong");
      expect(result).toContain("<code");
      expect(result).toContain("<em");
      expect(result).not.toContain("&lt;strong");
      expect(result).not.toContain("&lt;code");
      expect(result).not.toContain("&lt;em");
    });
  });

  describe("XSS prevention", () => {
    it("escapes user-supplied HTML in paragraphs", () => {
      const result = renderMarkdown('Hello <script>alert("xss")</script>');
      expect(result).toContain("&lt;script&gt;");
      expect(result).not.toContain("<script>");
    });

    it("escapes HTML inside inline markdown", () => {
      const result = renderMarkdown('**<img onerror=alert(1)>**');
      expect(result).toContain("&lt;img");
      expect(result).toContain("<strong");
    });

    it("escapes HTML in code blocks", () => {
      const result = renderMarkdown("```\n<div>test</div>\n```");
      expect(result).toContain("&lt;div&gt;");
      expect(result).not.toContain("<div>test</div>");
    });
  });

  describe("code blocks", () => {
    it("renders fenced code blocks with escaped content", () => {
      const result = renderMarkdown("```js\nconst x = 1;\n```");
      expect(result).toContain("<pre");
      expect(result).toContain("const x = 1;");
    });
  });
});
