import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { testEnvironment } from "./helpers/test-environment";

async function main() {
    const settings = testEnvironment(process.env);
    const docker = spawnSync(
        "docker",
        ["info", "--format", "{{.ServerVersion}}"],
        { encoding: "utf8", timeout: 10000 },
    );
    if (docker.status !== 0)
        throw new Error(
            "Docker Engine is unavailable. Start Docker, then run corepack yarn test:igdb:services:up",
        );
    await Promise.all(
        [settings.mysql, settings.redis].map(
            ({ host, port }) =>
                new Promise<void>((resolve, reject) => {
                    const socket = createConnection({ host, port });
                    socket.setTimeout(2000);
                    socket.once("connect", () => {
                        socket.destroy();
                        resolve();
                    });
                    socket.once("error", () => {
                        socket.destroy();
                        reject(
                            new Error(
                                `Local service on ${host}:${port} is unavailable; run corepack yarn test:igdb:services:up`,
                            ),
                        );
                    });
                    socket.once("timeout", () => {
                        socket.destroy();
                        reject(
                            new Error(
                                "Local service connection timed out; run corepack yarn test:igdb:services:up",
                            ),
                        );
                    });
                }),
        ),
    );
    for (const pages of [100, 1000])
        await new Promise<void>((resolve, reject) => {
            const child = spawn(
                process.execPath,
                [
                    "--expose-gc",
                    "-r",
                    "ts-node/register",
                    "test/igdb/helpers/resource-child.ts",
                ],
                {
                    stdio: "inherit",
                    env: { ...process.env, IGDB_FIXTURE_PAGES: String(pages) },
                },
            );
            child.once("error", reject);
            child.once("close", (code, signal) =>
                code === 0
                    ? resolve()
                    : reject(
                          new Error(
                              `Resource child ${pages} pages failed (${code ?? signal})`,
                          ),
                      ),
            );
        });
}
main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
