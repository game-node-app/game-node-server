import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseRoles } from "../auth/auth.service";
import { BillingService } from "../billing/billing.service";
import { EUserRoles } from "../utils/constants";
import {
    GuildAccessMode,
    GuildAccessResponseDto,
} from "./dto/guild-access.dto";

/** Session shape the gate needs; matches the Better Auth session `AuthGuard` attaches. */
export interface GuildAccessSession {
    user?: { id?: string; role?: string | null };
}

/** Supporter early-access rollout gate (design 9). */
@Injectable()
export class GuildAccessService {
    private readonly mode: GuildAccessMode;

    constructor(
        configService: ConfigService,
        private readonly billingService: BillingService,
    ) {
        const mode = configService
            .get<string>("GUILD_ACCESS_MODE")
            ?.trim()
            .toLowerCase();

        if (!mode) {
            this.mode = "public";
        } else if (mode === "supporters" || mode === "public") {
            this.mode = mode;
        } else {
            // A typo must not silently open or close the rollout.
            throw new Error(
                `Invalid GUILD_ACCESS_MODE "${mode}"; expected "supporters" or "public"`,
            );
        }
    }

    getMode(): GuildAccessMode {
        return this.mode;
    }

    /** Internal QA bypass: admins and editors pass without a billing lookup. */
    hasBypassRole(role: string | string[] | null | undefined): boolean {
        const roles = Array.isArray(role)
            ? role.flatMap((value) => parseRoles(value))
            : parseRoles(role);
        return (
            roles.includes(EUserRoles.ADMIN) ||
            roles.includes(EUserRoles.EDITOR)
        );
    }

    async canSessionAccess(
        session: GuildAccessSession | null | undefined,
    ): Promise<boolean> {
        const user = session?.user;
        if (!user?.id) return false;
        if (this.mode === "public") return true;
        if (this.hasBypassRole(user.role)) return true;
        return this.billingService.isSupporter(user.id);
    }

    async getAccessStatus(
        session: GuildAccessSession | null | undefined,
    ): Promise<GuildAccessResponseDto> {
        return {
            mode: this.mode,
            hasAccess: await this.canSessionAccess(session),
        };
    }
}
