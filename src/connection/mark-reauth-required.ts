import { EntityManager, Not } from "typeorm";
import { EConnectionAuthStatus } from "./connections.constants";
import { UserConnection } from "./entity/user-connection.entity";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";

export async function markReauthRequired(
    manager: EntityManager,
    connection: UserConnection,
): Promise<void> {
    const result = await manager.update(
        UserConnection,
        {
            id: connection.id,
            authStatus: Not(EConnectionAuthStatus.REAUTH_REQUIRED),
        },
        { authStatus: EConnectionAuthStatus.REAUTH_REQUIRED },
    );
    if (!result.affected) return;

    await appendNotificationIntent(manager, {
        id: `connection-reauth-${connection.id}-${Date.now()}`,
        eventType: "connection.reauth-required",
        eventVersion: 1,
        recipientUserId: connection.profileUserId,
        actorUserId: null,
        payload: { connectionId: connection.id, provider: connection.type },
    });
}
