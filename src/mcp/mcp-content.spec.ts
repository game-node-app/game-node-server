import { plainTextToHtml } from "./mcp-content";

describe("plainTextToHtml", () => {
    it("wraps blank-line separated paragraphs in <p>", () => {
        expect(plainTextToHtml("Great game.\n\nToo short.")).toBe(
            "<p>Great game.</p><p>Too short.</p>",
        );
    });

    it("turns single newlines into <br>", () => {
        expect(plainTextToHtml("line one\nline two")).toBe(
            "<p>line one<br>line two</p>",
        );
    });

    it("escapes markup so none is stored", () => {
        const html = plainTextToHtml(`<img src=x onerror=alert(1)> & "q" 'a'`);
        expect(html).not.toContain("<img");
        expect(html).toBe(
            "<p>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; &#39;a&#39;</p>",
        );
    });

    it("normalizes CRLF and ignores extra blank lines", () => {
        expect(plainTextToHtml("a\r\n\r\n\r\nb\n\n")).toBe("<p>a</p><p>b</p>");
    });

    it("treats whitespace-only lines as paragraph separators", () => {
        expect(plainTextToHtml("a\n \t\nb")).toBe("<p>a</p><p>b</p>");
    });
});
