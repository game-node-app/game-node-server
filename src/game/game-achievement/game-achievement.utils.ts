export const getPSNAchievementId = (
    npCommunicationId: string,
    trophyId: number,
) => `${npCommunicationId}_${trophyId}`;

/**
 * Checks is an string is a valid Xbox productId.
 * @example
 * +------------+
 * |uid         |
 * +------------+
 * |BZLN1W2ML7MG|
 * |BZJH18QJVDVW|
 * |BS8M9DCFB5BJ|
 * +------------+
 * @param productId
 */
export const isValidXboxProductId = (productId: string) => {
    const match = productId.match(/^[A-Z0-9]{12}$/);
    return match != undefined && match.length > 0;
};
