import { execFileSync, spawnSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    assertWithinBudget,
    convert,
    ProfileVideoError,
    probe,
} from "./profile-video-media";

jest.setTimeout(30_000);

interface InspectedStream {
    codec_type?: string;
    codec_name?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    color_transfer?: string;
    tags?: Record<string, string>;
}

interface InspectedMedia {
    streams: InspectedStream[];
    format?: { duration?: string; tags?: Record<string, string> };
}

function inspect(file: string): InspectedMedia {
    return JSON.parse(
        execFileSync(
            "ffprobe",
            [
                "-hide_banner",
                "-loglevel",
                "error",
                "-show_format",
                "-show_streams",
                "-print_format",
                "json",
                file,
            ],
            { encoding: "utf8" },
        ),
    ) as InspectedMedia;
}

function videoStream(media: InspectedMedia): InspectedStream {
    const stream = media.streams.find((item) => item.codec_type === "video");
    if (!stream) {
        throw new Error("Expected a video stream in the conversion output.");
    }
    return stream;
}

function expectNoSourceMetadata(media: InspectedMedia) {
    const tags = { ...(media.format?.tags ?? {}) };
    for (const stream of media.streams) {
        Object.assign(tags, stream.tags ?? {});
    }
    expect(tags.title).toBeUndefined();
    expect(tags.location).toBeUndefined();
    expect(tags.comment).toBeUndefined();
}

function expectFaststart(file: string) {
    const bytes = readFileSync(file);
    const moov = bytes.indexOf("moov");
    const mdat = bytes.indexOf("mdat");
    expect(moov).toBeGreaterThanOrEqual(0);
    expect(mdat).toBeGreaterThanOrEqual(0);
    expect(moov).toBeLessThan(mdat);
}

function centerPixel(jpegPath: string): number[] {
    return [
        ...execFileSync(
            "ffmpeg",
            [
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                jpegPath,
                "-vf",
                "format=rgb24,crop=1:1:128:128",
                "-f",
                "rawvideo",
                "-",
            ],
            { maxBuffer: 1024 },
        ),
    ];
}

const ffmpegAvailable =
    spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const ffprobeAvailable =
    spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
if (!ffmpegAvailable || !ffprobeAvailable) {
    console.warn(
        "Skipping profile video conversion tests: ffmpeg and ffprobe are required on PATH.",
    );
}
const describeWithFfmpeg =
    ffmpegAvailable && ffprobeAvailable ? describe : describe.skip;

describeWithFfmpeg("profile video conversion", () => {
    let directory: string;
    let sourcePath: string;
    let splitPath: string;
    let rotatedPath: string;
    let fastPath: string;
    let hdrPath: string | undefined;

    function ffmpeg(...args: string[]) {
        execFileSync(
            "ffmpeg",
            ["-hide_banner", "-loglevel", "error", "-y", ...args],
            { stdio: "pipe" },
        );
    }

    beforeAll(() => {
        directory = mkdtempSync(join(tmpdir(), "profile-video-convert-"));
        // Media processes may drop to uid 65534 when the test runs as root.
        chmodSync(directory, 0o755);
        sourcePath = join(directory, "source.mp4");
        splitPath = join(directory, "split.mp4");
        rotatedPath = join(directory, "rotated.mp4");
        fastPath = join(directory, "fast.mp4");

        ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=30:d=10",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=10",
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            "-metadata",
            "title=SOURCE TITLE",
            "-metadata",
            "comment=SOURCE COMMENT",
            "-metadata",
            "location=SOURCE LOCATION",
            sourcePath,
        );
        ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=320x180:r=10:d=1",
            "-vf",
            "drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            splitPath,
        );
        ffmpeg(
            "-display_rotation",
            "90",
            "-i",
            splitPath,
            "-c",
            "copy",
            rotatedPath,
        );
        ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=60:d=2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            fastPath,
        );
        try {
            hdrPath = join(directory, "hdr.mp4");
            ffmpeg(
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:r=10:d=1",
                "-c:v",
                "libx265",
                "-preset",
                "ultrafast",
                "-x265-params",
                "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
                "-pix_fmt",
                "yuv420p10le",
                hdrPath,
            );
        } catch {
            console.warn(
                "Skipping the HDR tone mapping test: this ffmpeg build cannot encode a libx265 HDR sample.",
            );
            hdrPath = undefined;
        }
    });

    afterAll(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it("converts an avatar to a 256x256 H.264 yuv420p MP4 with a JPEG poster", async () => {
        const output = await convert(
            "avatar",
            sourcePath,
            join(directory, "avatar"),
        );

        expect(output.size).toBeLessThanOrEqual(1024 * 1024);
        expect(statSync(output.path).size).toBe(output.size);
        expect(output.durationMs).toBeLessThanOrEqual(8000);
        expect(output.width).toBe(256);
        expect(output.height).toBe(256);

        const media = inspect(output.path);
        const video = videoStream(media);
        expect(video.codec_name).toBe("h264");
        expect(video.pix_fmt).toBe("yuv420p");
        expect(video.width).toBe(256);
        expect(video.height).toBe(256);
        expect(Number(media.format?.duration)).toBeLessThanOrEqual(8);
        const [num, den] = (video.avg_frame_rate ?? "0/0")
            .split("/")
            .map(Number);
        expect(num / den).toBeLessThanOrEqual(30);
        expect(
            media.streams.filter((stream) => stream.codec_type === "audio"),
        ).toHaveLength(0);
        expectNoSourceMetadata(media);
        expectFaststart(output.path);

        expect(existsSync(output.posterPath)).toBe(true);
        const poster = readFileSync(output.posterPath);
        expect([...poster.subarray(0, 2)]).toEqual([0xff, 0xd8]);
        const posterStream = videoStream(inspect(output.posterPath));
        expect(posterStream.width).toBe(256);
        expect(posterStream.height).toBe(256);
    });

    it("converts a banner to 1280x548 within its budget", async () => {
        const output = await convert(
            "banner",
            sourcePath,
            join(directory, "banner"),
        );

        expect(output.size).toBeLessThanOrEqual(5 * 1024 * 1024);
        expect(output.width).toBe(1280);
        expect(output.height).toBe(548);

        const media = inspect(output.path);
        const video = videoStream(media);
        expect(video.codec_name).toBe("h264");
        expect(video.pix_fmt).toBe("yuv420p");
        expect(video.width).toBe(1280);
        expect(video.height).toBe(548);
        expect(Number(media.format?.duration)).toBeLessThanOrEqual(8);
        expect(
            media.streams.filter((stream) => stream.codec_type === "audio"),
        ).toHaveLength(0);
        expectNoSourceMetadata(media);
        expectFaststart(output.path);
        expect(videoStream(inspect(output.posterPath)).width).toBe(1280);
        expect(videoStream(inspect(output.posterPath)).height).toBe(548);
    });

    it("applies a normalized crop", async () => {
        const output = await convert(
            "avatar",
            splitPath,
            join(directory, "cropped"),
            { x: 0.5, y: 0, width: 0.5, height: 1 },
        );

        const [red, , blue] = centerPixel(output.posterPath);
        expect(red).toBeLessThan(60);
        expect(blue).toBeGreaterThan(200);
    });

    it("autorotates before applying the crop", async () => {
        const rotated = await probe(rotatedPath);
        expect(rotated.width).toBe(180);
        expect(rotated.height).toBe(320);

        const output = await convert(
            "avatar",
            rotatedPath,
            join(directory, "rotated"),
            { x: 0, y: 0, width: 0.25, height: 0.125 },
        );

        // The displayed top-left is the source's right (blue) half only when
        // ffmpeg applies the display matrix before the crop filter.
        const [red, , blue] = centerPixel(output.posterPath);
        expect(red).toBeLessThan(60);
        expect(blue).toBeGreaterThan(200);
    });

    it("tone maps an HDR source to SDR BT.709", async () => {
        if (!hdrPath) {
            return;
        }

        const hdr = await probe(hdrPath);
        expect(hdr.hdr).toBe(true);

        const output = await convert("avatar", hdrPath, join(directory, "hdr"));

        const video = videoStream(inspect(output.path));
        expect(video.codec_name).toBe("h264");
        expect(video.pix_fmt).toBe("yuv420p");
        expect(video.color_transfer).toBe("bt709");
    });

    it("does not raise the frame rate above 30", async () => {
        const source = await probe(fastPath);
        expect(source.fps).toBe(60);

        const output = await convert(
            "banner",
            fastPath,
            join(directory, "fast"),
        );

        const [num, den] = (
            videoStream(inspect(output.path)).avg_frame_rate ?? "0/0"
        )
            .split("/")
            .map(Number);
        expect(num / den).toBeLessThanOrEqual(30);
    });

    it("rejects an output above its slot budget", () => {
        expect(() => assertWithinBudget("avatar", 1024 * 1024)).not.toThrow();
        expect(() =>
            assertWithinBudget("banner", 5 * 1024 * 1024),
        ).not.toThrow();

        const avatarError = (() => {
            try {
                assertWithinBudget("avatar", 1024 * 1024 + 1);
            } catch (error) {
                return error;
            }
        })();
        expect(avatarError).toBeInstanceOf(ProfileVideoError);
        expect(avatarError).toMatchObject({ code: "output_too_large" });

        const bannerError = (() => {
            try {
                assertWithinBudget("banner", 5 * 1024 * 1024 + 1);
            } catch (error) {
                return error;
            }
        })();
        expect(bannerError).toBeInstanceOf(ProfileVideoError);
        expect(bannerError).toMatchObject({ code: "output_too_large" });
    });
});
