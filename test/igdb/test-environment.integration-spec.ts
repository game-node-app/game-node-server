import { testEnvironment } from "./helpers/test-environment";

describe("isolated IGDB test environment", () => {
    it("uses explicit local defaults without application environment", () => {
        const settings = testEnvironment({
            DATABASE_HOST: "production.example",
        });
        expect(settings.mysql.host).toBe("127.0.0.1");
        expect(settings.mysql.database).toBe("igdb_sync_test");
        expect(settings.prefix).toMatch(/^igdb-test-/);
    });

    it.each([
        { IGDB_TEST_MYSQL_HOST: "remote.example" },
        { IGDB_TEST_REDIS_HOST: "192.168.1.2" },
        { IGDB_TEST_MYSQL_DATABASE: "game" },
        { IGDB_TEST_QUEUE_PREFIX: "" },
        { IGDB_TEST_QUEUE_PREFIX: "application" },
        { IGDB_TEST_MYSQL_PORT: "13306junk" },
    ])("rejects unsafe settings %j", (env) => {
        expect(() => testEnvironment(env)).toThrow();
    });
});
