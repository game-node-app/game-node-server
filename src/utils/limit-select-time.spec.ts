import { EventEmitter } from "node:events";
import { DataSource } from "typeorm";
import { limitSelectTime } from "./limit-select-time";
import { parseAppRole } from "./app-role";

describe("limitSelectTime", () => {
    it("sets the session limit once per connection and retries after a failure", () => {
        const pool = new EventEmitter();
        limitSelectTime({ driver: { pool } } as unknown as DataSource, 15000);
        const ok = { query: jest.fn((_sql, cb) => cb(null)) };
        let fail = true;
        const flaky = {
            query: jest.fn((_sql, cb) => cb(fail ? new Error("gone") : null)),
        };

        pool.emit("acquire", ok);
        pool.emit("acquire", ok);
        pool.emit("acquire", flaky);
        fail = false;
        pool.emit("acquire", flaky);
        pool.emit("acquire", flaky);

        expect(ok.query).toHaveBeenCalledTimes(1);
        expect(ok.query.mock.calls[0][0]).toBe(
            "SET SESSION max_execution_time = 15000",
        );
        expect(flaky.query).toHaveBeenCalledTimes(2);
    });
});

describe("parseAppRole", () => {
    it("defaults to all and rejects typos", () => {
        expect(parseAppRole(undefined)).toBe("all");
        expect(parseAppRole("api")).toBe("api");
        expect(() => parseAppRole("apí")).toThrow("Invalid APP_ROLE");
    });
});
