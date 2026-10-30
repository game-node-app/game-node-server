import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PSN_SYSTEM_AUTH_FAILED, PsnSyncAuthService } from "./psn-sync-auth.service";

const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class PsnSyncAuthScheduler {
    private readonly logger = new Logger(PsnSyncAuthScheduler.name);
    private running = false;

    constructor(private readonly authService: PsnSyncAuthService) {}

    @Cron("0 * * * *", { timeZone: "UTC" })
    async check(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            // The service constructor already warns about a missing NPSSO.
            if (!(await this.authService.hasNpsso())) return;

            const token = await this.authService.getValidAccessToken();
            const expiresAt = new Date(token.refreshTokenExpiresAt);
            if (expiresAt.getTime() - Date.now() < EXPIRY_WARNING_MS) {
                this.logger.warn(
                    `PSN refresh token expires soon, at ${expiresAt.toISOString()}`,
                );
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(
                message.startsWith(PSN_SYSTEM_AUTH_FAILED)
                    ? message
                    : `${PSN_SYSTEM_AUTH_FAILED}: ${message}`,
            );
        } finally {
            this.running = false;
        }
    }
}
