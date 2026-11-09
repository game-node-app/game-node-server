import { spawn } from "node:child_process";
import { Logger } from "@nestjs/common";

export const MEDIA_PROCESS_TIMEOUT_MS = 180_000;
export const MEDIA_MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
export const MEDIA_CPU_LIMIT_SECONDS = 180;
export const MEDIA_NOBODY_UID = 65534;
export const MEDIA_NOBODY_GID = 65534;

const DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin";
const logger = new Logger("MediaProcess");

export class MediaProcessError extends Error {
    constructor(
        message: string,
        readonly timedOut: boolean,
    ) {
        super(message);
        this.name = "MediaProcessError";
    }
}

/**
 * Runs an untrusted-media tool with a minimal environment and resource limits.
 * stderr is logged here and never attached to the error a caller can observe.
 */
// shortcut: ffmpeg shares the API container's filesystem and network stack; move conversion to a dedicated container if upload access widens beyond supporters or a relevant ffmpeg CVE appears.
export async function runMediaProcess(
    command: string,
    args: string[],
    options: { timeoutMs?: number; cwd?: string } = {},
): Promise<string> {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeoutMs = options.timeoutMs ?? MEDIA_PROCESS_TIMEOUT_MS;
    const runAsRoot =
        typeof process.getuid === "function" && process.getuid() === 0;

    return new Promise<string>((resolve, reject) => {
        const child = spawn(
            "nice",
            [
                "-n",
                "19",
                "prlimit",
                `--as=${MEDIA_MEMORY_LIMIT_BYTES}`,
                `--cpu=${MEDIA_CPU_LIMIT_SECONDS}`,
                command,
                ...args,
            ],
            {
                shell: false,
                env: { PATH: process.env.PATH ?? DEFAULT_PATH },
                stdio: ["ignore", "pipe", "pipe"],
                ...(options.cwd ? { cwd: options.cwd } : {}),
                ...(runAsRoot
                    ? { uid: MEDIA_NOBODY_UID, gid: MEDIA_NOBODY_GID }
                    : {}),
            },
        );

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs);

        const finish = (code: number | null) => {
            const stderrText = Buffer.concat(stderr).toString("utf8").trim();
            if (stderrText) {
                if (code === 0 && !timedOut) {
                    logger.warn(stderrText);
                } else {
                    logger.error(stderrText);
                }
            }

            if (timedOut) {
                reject(new MediaProcessError("Media process timed out.", true));
            } else if (code !== 0) {
                reject(new MediaProcessError("Media process failed.", false));
            } else {
                resolve(Buffer.concat(stdout).toString("utf8"));
            }
        };

        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", () => {
            clearTimeout(timer);
            reject(new MediaProcessError("Media process failed.", false));
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            finish(code);
        });
    });
}
