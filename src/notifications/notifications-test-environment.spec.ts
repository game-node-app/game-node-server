import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";

afterEach(() => jest.restoreAllMocks());

it("ignores application database configuration", async () => {
    jest.replaceProperty(process, "env", {
        DB_HOST: "application.invalid",
        DB_PORT: "3306",
        DB_DATABASE: "gamenode",
        DB_USER: "application-user",
        DB_PASS: "application-password",
    });
    const initialize = jest
        .spyOn(DataSource.prototype, "initialize")
        .mockRejectedValue(new Error("connection probe"));

    await expect(createNotificationTestDataSource()).rejects.toThrow(
        "connection probe",
    );
    expect(initialize.mock.contexts[0]).toMatchObject({
        options: {
            host: "127.0.0.1",
            port: 13306,
            database: "igdb_sync_test",
            username: "igdb_test",
        },
    });
});

it.each([
    { IGDB_TEST_MYSQL_DATABASE: "gamenode" },
    { IGDB_TEST_MYSQL_HOST: "application.invalid" },
])(
    "rejects unsafe fixture configuration before connecting: %j",
    async (env) => {
        jest.replaceProperty(process, "env", env);
        const initialize = jest.spyOn(DataSource.prototype, "initialize");
        await expect(createNotificationTestDataSource()).rejects.toThrow();
        expect(initialize).not.toHaveBeenCalled();
    },
);
