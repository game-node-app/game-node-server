import { ExecutionContext, Injectable } from "@nestjs/common";
import { CacheInterceptor } from "@nestjs/cache-manager";
import { SessionRequest } from "supertokens-node/framework/express";

/**
 * Custom implementation of CacheInterceptor's tracking that makes the cache user-specific. <br>
 * For most endpoints, you probably don't want to use this, unless the expected response should be user-specific.
 * e.g. in the recommendation system.
 */
@Injectable()
export class SessionAwareCacheInterceptor extends CacheInterceptor {
    protected trackBy(context: ExecutionContext): string | undefined {
        const request: SessionRequest = context.switchToHttp().getRequest();
        const defaultTrackBy = super.trackBy(context);
        if (request.session && defaultTrackBy) {
            const userId = request.session.getUserId();
            return `${userId}-${defaultTrackBy}`;
        }

        return defaultTrackBy;
    }
}
