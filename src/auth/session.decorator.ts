import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import SupertokensSession from "supertokens-node/recipe/session";
import { Socket } from "socket.io";

/**
 * Retrieves session info for the current logged in user. <br>
 * Needs to be used with AuthGuard. <br>
 * If the 'Public' decorator is also used, the 'session' object will be null if the user is not logged in.
 * @see AuthGuard
 * @see Public
 */
export const Session = createParamDecorator(
    (data: unknown, ctx: ExecutionContext) => {
        const ctxType = ctx.getType();
        if (ctxType === "http") {
            const request = ctx.switchToHttp().getRequest();
            return request.session;
        }
        if (ctxType === "ws") {
            const client: Socket = ctx.switchToWs().getClient();

            const token = client.handshake.query.token as string | undefined;
            if (!token) {
                return null;
            }

            return SupertokensSession.getSessionWithoutRequestResponse(
                token,
                undefined,
                {
                    sessionRequired: false,
                },
            );
        }
    },
);
