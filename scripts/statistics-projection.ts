import "reflect-metadata";
import { DataSource } from "typeorm";
import { resolve } from "node:path";
import { testEnvironment } from "../test/igdb/helpers/test-environment";
import { StatisticsProjectionService } from "../src/statistics/statistics-projection.service";

export async function statisticsProjectionCommand(args: string[]) {
    const [command, ...flags] = args;
    const local = flags.includes("--local");
    const eventIdText = flags.find((flag) => flag.startsWith("--event-id="))?.slice("--event-id=".length);
    if (!(["diagnostics", "rearm"].includes(command)) || flags.some((flag) => flag !== "--local" && !flag.startsWith("--event-id=")))
        throw new Error("Usage: statistics:projection diagnostics|rearm [--local] [--event-id=<numeric-event-id>]");
    const eventId = eventIdText === undefined ? undefined : Number(eventIdText);
    if (eventId !== undefined && (!Number.isSafeInteger(eventId) || eventId < 1))
        throw new Error("--event-id must be a positive safe integer");
    if (command === "rearm" && eventId === undefined)
        throw new Error("A failed numeric event ID is required for rearm");

    const fixture = local ? testEnvironment(process.env) : null;
    const source = fixture
        ? new DataSource({ ...fixture.mysql, entities: [resolve(__dirname, "../src/**/*.entity.ts")], timezone: "Z" })
        : (require("../data-source").AppDataSource as DataSource);
    await source.initialize();
    try {
        const projection = new StatisticsProjectionService(source);
        if (command === "diagnostics") return await projection.diagnostics();
        return { eventId, rearmed: await projection.rearm(eventId!) };
    } finally {
        await source.destroy();
    }
}

if (require.main === module)
    statisticsProjectionCommand(process.argv.slice(2))
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error instanceof Error ? error.message : "Statistics projection command failed");
            process.exitCode = 1;
        });
