const ESCAPES: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

/**
 * Plain text -> the escaped `<p>` HTML the website editor stores, so a client can never store markup.
 * Blank lines split paragraphs; single newlines become `<br>`.
 */
export function plainTextToHtml(text: string): string {
    return text
        .replace(/\r\n?/g, "\n")
        .replace(/[&<>"']/g, (char) => ESCAPES[char])
        .split(/\n(?:[ \t]*\n)+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
        .join("");
}
