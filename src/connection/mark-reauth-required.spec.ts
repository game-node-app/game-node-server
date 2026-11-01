import "reflect-metadata";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import {
    EConnectionAuthStatus,
    EConnectionType,
} from "./connections.constants";
import { UserConnection } from "./entity/user-connection.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import * as outbox from "../notifications/notifications-outbox.service";
import { markReauthRequired } from "./mark-reauth-required";

describe("markReauthRequired on MySQL", () => {
    let source: DataSource;
    let connection: UserConnection;

    beforeAll(async () => {
        source = await createNotificationTestDataSource();
    });
    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
    });
    beforeEach(async () => {
        const owner = randomUUID();
        await source.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [owner, owner.slice(0, 20)],
        );
        connection = await source.getRepository(UserConnection).save({
            type: EConnectionType.EPIC_GAMES,
            profileUserId: owner,
            sourceUserId: owner,
            sourceUsername: "Fixture",
        });
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await source
            .getRepository(NotificationOutbox)
            .delete({ recipientUserId: connection.profileUserId });
        await source.query("DELETE FROM profile WHERE userId = ?", [
            connection.profileUserId,
        ]);
    });

    const mark = () =>
        source.transaction((manager) =>
            markReauthRequired(manager, connection),
        );

    it("notifies once across concurrent and repeated calls, then again after reconnect", async () => {
        await Promise.all([mark(), mark()]);
        await mark();
        const repo = source.getRepository(NotificationOutbox);
        const events = await repo.findBy({
            recipientUserId: connection.profileUserId,
        });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            eventType: "connection.reauth-required",
            recipientUserId: connection.profileUserId,
            actorUserId: null,
            payload: { connectionId: connection.id, provider: "epicgames" },
        });
        expect(
            await source
                .getRepository(UserConnection)
                .findOneByOrFail({ id: connection.id }),
        ).toMatchObject({
            authStatus: EConnectionAuthStatus.REAUTH_REQUIRED,
        });

        await source.getRepository(UserConnection).update(connection.id, {
            authStatus: EConnectionAuthStatus.CONNECTED,
        });
        await mark();
        expect(
            await repo.countBy({ recipientUserId: connection.profileUserId }),
        ).toBe(2);
    });

    it("rolls back the status when the notification cannot be persisted", async () => {
        jest.spyOn(outbox, "appendNotificationIntent").mockRejectedValueOnce(
            new Error("outbox unavailable"),
        );
        await expect(mark()).rejects.toThrow("outbox unavailable");
        expect(
            await source
                .getRepository(UserConnection)
                .findOneByOrFail({ id: connection.id }),
        ).toMatchObject({
            authStatus: EConnectionAuthStatus.CONNECTED,
        });
        expect(
            await source
                .getRepository(NotificationOutbox)
                .countBy({ recipientUserId: connection.profileUserId }),
        ).toBe(0);
    });
});
