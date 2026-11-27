import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { ThrottlerRequest } from "@nestjs/throttler";
import { isTrustedForwarder, TRUSTED_FORWARDER_MULTIPLIER } from "./client-ip";

/** ThrottlerGuard that gives trusted forwarders (SSR) a multiple of every limit, default and per-route alike. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
    protected handleRequest(props: ThrottlerRequest): Promise<boolean> {
        const req = props.context.switchToHttp().getRequest();
        return super.handleRequest(
            isTrustedForwarder(req)
                ? {
                      ...props,
                      limit: props.limit * TRUSTED_FORWARDER_MULTIPLIER,
                  }
                : props,
        );
    }
}
