export interface PSNTokenInfo {
    accessToken: string;
    refreshToken: string;
    /**
     * ISO date string
     */
    expiresAt: string;
    /**
     * ISO date string
     */
    refreshTokenExpiresAt: string;
}
