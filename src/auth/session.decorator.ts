import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Socket } from "socket.io";

/**
 * Retrieves session info for the current logged in user. <br>
 * Needs to be used with {@link AuthGuard} or {@link WsAuthGuard}. <br>
 * If the 'Public' decorator is also used, the 'session' object will be null if the user is not logged in.
 * @see AuthGuard
 * @see WsAuthGuard
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

            return client.data.session;
        }
    },
);
