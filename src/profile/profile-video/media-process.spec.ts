jest.mock("node:child_process", () => {
    const actual = jest.requireActual("node:child_process");
    return { ...actual, spawn: jest.fn(actual.spawn) };
});

import * as childProcess from "node:child_process";
import { execFileSync, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import {
    MEDIA_PROCESS_TIMEOUT_MS,
    MediaProcessError,
    runMediaProcess,
} from "./media-process";
import { probe } from "./profile-video-media";

type FakeChild = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
};

function fakeChild(stdout = "", stderr = "", exitCode = 0): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    setImmediate(() => {
        if (stdout) {
            child.stdout.emit("data", Buffer.from(stdout));
        }
        if (stderr) {
            child.stderr.emit("data", Buffer.from(stderr));
        }
        child.emit("close", exitCode);
    });
    return child;
}

const validProbeOutput = JSON.stringify({
    streams: [
        {
            codec_type: "video",
            codec_name: "h264",
            width: 320,
            height: 180,
            avg_frame_rate: "30/1",
            disposition: { attached_pic: 0 },
        },
    ],
    format: {
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
        duration: "1.000000",
    },
});

describe("runMediaProcess", () => {
    const spawnMock = childProcess.spawn as unknown as jest.Mock;

    beforeEach(() => {
        spawnMock.mockReset();
        spawnMock.mockImplementation(
            jest.requireActual("node:child_process").spawn,
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function mockSpawn(child: FakeChild) {
        spawnMock.mockImplementationOnce(() => child);
    }

    it("spawns nice/prlimit with an argument array and no shell", async () => {
        mockSpawn(fakeChild(validProbeOutput));

        await probe("/generated/source.mp4");

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [command, args, options] = spawnMock.mock.calls[0] as [
            string,
            string[],
            { shell?: boolean; env?: Record<string, string> },
        ];
        expect(command).toBe("nice");
        expect(args.slice(0, 6)).toEqual([
            "-n",
            "19",
            "prlimit",
            "--as=2147483648",
            "--cpu=180",
            "ffprobe",
        ]);
        expect(args).toEqual(
            expect.arrayContaining([
                "-protocol_whitelist",
                "file",
                "-format_whitelist",
                "mov,matroska",
                "-i",
                "/generated/source.mp4",
            ]),
        );
        expect(args).not.toContain("-c");
        expect(command).not.toMatch(/(^|\/)sh$/);
        expect(options.shell).toBe(false);
    });

    it("gives the process only PATH in its environment", async () => {
        mockSpawn(fakeChild(validProbeOutput));

        await probe("/generated/source.mp4");

        const options = spawnMock.mock.calls[0][2] as {
            env?: Record<string, string>;
        };
        expect(Object.keys(options.env ?? {})).toEqual(["PATH"]);
        expect(options.env?.PATH).toBe(process.env.PATH);
    });

    it("uses the 180 second wall clock limit by default", () => {
        expect(MEDIA_PROCESS_TIMEOUT_MS).toBe(180_000);
    });

    it("logs stderr but never puts it in the caller's error", async () => {
        const errorLog = jest
            .spyOn(Logger.prototype, "error")
            .mockImplementation(() => undefined);
        mockSpawn(fakeChild("", "hostile tool output", 1));

        const error = await runMediaProcess("ffmpeg", ["-version"]).catch(
            (reason: unknown) => reason,
        );

        expect(error).toBeInstanceOf(MediaProcessError);
        expect((error as Error).message).toBe("Media process failed.");
        expect((error as Error).message).not.toContain("hostile tool output");
        expect(errorLog).toHaveBeenCalledWith(
            expect.stringContaining("hostile tool output"),
        );
    });

    it("kills a process that exceeds its wall clock limit", async () => {
        const startedAt = Date.now();

        const error = await runMediaProcess("sleep", ["30"], {
            timeoutMs: 200,
        }).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(MediaProcessError);
        expect((error as MediaProcessError).timedOut).toBe(true);
        expect(Date.now() - startedAt).toBeLessThan(5000);
    });
});

const ffmpegAvailable =
    spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const ffprobeAvailable =
    spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!ffmpegAvailable || !ffprobeAvailable) {
    console.warn(
        "Skipping profile video probe rejection tests: ffmpeg and ffprobe are required on PATH.",
    );
}
const describeWithFfmpeg =
    ffmpegAvailable && ffprobeAvailable ? describe : describe.skip;

describeWithFfmpeg("profile video source validation", () => {
    let directory: string;

    function sample(name: string): string {
        return join(directory, name);
    }

    function ffmpeg(...args: string[]) {
        execFileSync(
            "ffmpeg",
            ["-hide_banner", "-loglevel", "error", "-y", ...args],
            { stdio: "pipe" },
        );
    }

    beforeAll(() => {
        directory = mkdtempSync(join(tmpdir(), "profile-video-probe-"));
        chmodSync(directory, 0o755);

        ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=30:d=1",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            sample("valid.mp4"),
        );
        ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:d=1:r=5",
            "-frames:v",
            "1",
            sample("image.gif"),
        );
        ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "aac",
            sample("audio-only.mp4"),
        );
        ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:r=1:d=1",
            "-map",
            "0:a",
            "-map",
            "1:v",
            "-c:a",
            "aac",
            "-c:v",
            "mjpeg",
            "-disposition:v",
            "attached_pic",
            sample("cover-art.mp4"),
        );
        ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=4100x100:r=5:d=0.2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            sample("oversized.mp4"),
        );
        writeFileSync(
            sample("playlist.m3u8"),
            [
                "#EXTM3U",
                "#EXT-X-VERSION:3",
                "#EXT-X-TARGETDURATION:1",
                "#EXTINF:1,",
                "http://127.0.0.1:9/segment.ts",
                "#EXT-X-ENDLIST",
                "",
            ].join("\n"),
        );
    });

    afterAll(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it("accepts a supported video", async () => {
        const result = await probe(sample("valid.mp4"));

        expect(result.width).toBe(320);
        expect(result.height).toBe(180);
        expect(result.fps).toBe(30);
        expect(result.hdr).toBe(false);
        expect(result.videoStreamOrdinal).toBe(0);
    });

    it("rejects GIF content", async () => {
        await expect(probe(sample("image.gif"))).rejects.toMatchObject({
            code: "rejected_source",
        });
    });

    it("rejects an audio-only container", async () => {
        await expect(probe(sample("audio-only.mp4"))).rejects.toMatchObject({
            code: "rejected_source",
        });
    });

    it("rejects a container with only cover art", async () => {
        await expect(probe(sample("cover-art.mp4"))).rejects.toMatchObject({
            code: "rejected_source",
        });
    });

    it("rejects a playlist referencing a remote URL", async () => {
        await expect(probe(sample("playlist.m3u8"))).rejects.toMatchObject({
            code: "rejected_source",
        });
    });

    it("rejects a source above 4096 pixels per side", async () => {
        await expect(probe(sample("oversized.mp4"))).rejects.toMatchObject({
            code: "rejected_source",
        });
    });
});
