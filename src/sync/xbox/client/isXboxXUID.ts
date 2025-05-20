export function isXboxXUID(entry: string | number) {
    return /^([0-9]+)$/g.test(entry.toString());
}
