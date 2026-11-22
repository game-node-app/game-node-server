import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SessionContainer } from "../auth/session.decorator";
import { GuildAccessService } from "./guild-access.service";

export const BYPASS_GUILD_ACCESS_KEY = "bypassGuildAccess";

/** Skips the Guild early-access gate; only the public access endpoint uses it. */
export const BypassGuildAccess = () =>
    SetMetadata(BYPASS_GUILD_ACCESS_KEY, true);

/** Runs after `AuthGuard`; gates player Guild routes by `GUILD_ACCESS_MODE` (design 9). */
@Injectable()
export class GuildAccessGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly guildAccessService: GuildAccessService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const bypass = this.reflector.getAllAndOverride<boolean>(
            BYPASS_GUILD_ACCESS_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (bypass) return true;

        // Public rollout never pays for a billing lookup.
        if (this.guildAccessService.getMode() === "public") return true;

        const request = context.switchToHttp().getRequest<{
            session?: SessionContainer;
        }>();

        if (
            !(await this.guildAccessService.canSessionAccess(request.session))
        ) {
            throw new ForbiddenException({
                message:
                    "Adventurers Guild is currently in early access for supporters.",
                code: "guild_early_access_required",
            });
        }

        return true;
    }
}
