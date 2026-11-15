import { getMetadataArgsStorage } from "typeorm";
import { AddPlaytimeHistoryProfilePeriod1795200000000 } from "../migrations/1795200000000-AddPlaytimeHistoryProfilePeriod";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";

const INDEX = "IDX_playtime_history_profile_period";

describe("AddPlaytimeHistoryProfilePeriod", () => {
    it("adds and removes the nonunique profileUserId/createdAt index", async () => {
        const queries: string[] = [];
        const runner = {
            query: async (sql: string) => void queries.push(sql),
        } as any;
        const migration = new AddPlaytimeHistoryProfilePeriod1795200000000();

        await migration.up(runner);
        expect(queries).toEqual([
            `ALTER TABLE \`user_playtime_history\` ADD KEY \`${INDEX}\` (\`profileUserId\`, \`createdAt\`)`,
        ]);

        queries.length = 0;
        await migration.down(runner);
        expect(queries).toEqual([
            `ALTER TABLE \`user_playtime_history\` DROP KEY \`${INDEX}\``,
        ]);
    });

    it("matches the history entity index metadata", () => {
        const index = getMetadataArgsStorage().indices.find(
            (candidate) =>
                candidate.target === UserPlaytimeHistory &&
                candidate.name === INDEX,
        );
        expect(index?.columns).toEqual(["profileUserId", "createdAt"]);
        expect(index?.unique).not.toBe(true);
    });
});
