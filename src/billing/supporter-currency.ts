/**
 * Display and checkout currency for the supporter plan. `CF-IPCountry` is a hint, not an
 * authorization boundary; both currencies are valid published prices.
 */
export function resolveSupporterCurrency(
    country?: string | null,
    acceptLanguage?: string | null,
): "BRL" | "USD" {
    return country?.trim().toUpperCase() === "BR" ||
        acceptLanguage?.trim().toLowerCase().startsWith("pt")
        ? "BRL"
        : "USD";
}
