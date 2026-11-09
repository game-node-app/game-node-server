import { chmod, chown, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
    MEDIA_NOBODY_GID,
    MEDIA_NOBODY_UID,
    runMediaProcess,
} from "./media-process";

const MAX_SOURCE_SIDE = 4096;
const MAX_OUTPUT_FPS = 30;
const MAX_OUTPUT_DURATION_SECONDS = 8;
const INPUT_ACCESS_ARGS = [
    "-protocol_whitelist",
    "file",
    "-format_whitelist",
    "mov,matroska",
];
const ALLOWED_CONTAINERS = new Set(["mov", "matroska"]);
const ALLOWED_CODECS = new Set(["h264", "hevc", "vp8", "vp9", "av1"]);
const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);
const HDR_FILTERS = [
    "zscale=t=linear:npl=100",
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
];

export const PROFILE_VIDEO_BUDGETS = {
    avatar: {
        width: 256,
        height: 256,
        maxRate: "900k",
        bufSize: "1800k",
        maxBytes: 1 * 1024 * 1024,
    },
    banner: {
        width: 1280,
        height: 548,
        maxRate: "4M",
        bufSize: "8M",
        maxBytes: 5 * 1024 * 1024,
    },
} as const;

export type ProfileVideoSlot = keyof typeof PROFILE_VIDEO_BUDGETS;

export type ProfileVideoErrorCode =
    | "rejected_source"
    | "conversion_failed"
    | "output_too_large";

export class ProfileVideoError extends Error {
    constructor(
        readonly code: ProfileVideoErrorCode,
        message: string = code,
    ) {
        super(message);
        this.name = "ProfileVideoError";
    }
}

export interface NormalizedCrop {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SourceProbe {
    durationMs: number;
    width: number;
    height: number;
    fps: number;
    hdr: boolean;
    videoStreamOrdinal: number;
}

export interface ConvertedVideo {
    path: string;
    posterPath: string;
    size: number;
    durationMs: number;
    width: number;
    height: number;
}

interface ProbeStream {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    color_transfer?: string;
    disposition?: { attached_pic?: number };
    side_data_list?: { rotation?: number }[];
    tags?: Record<string, string>;
}

interface ProbeData {
    streams?: ProbeStream[];
    format?: { format_name?: string; duration?: string };
}

async function ffprobe(path: string): Promise<ProbeData> {
    const output = await runMediaProcess("ffprobe", [
        "-hide_banner",
        "-loglevel",
        "error",
        ...INPUT_ACCESS_ARGS,
        "-show_format",
        "-show_streams",
        "-print_format",
        "json",
        "-i",
        path,
    ]);
    return JSON.parse(output) as ProbeData;
}

function parseFrameRate(value?: string): number | undefined {
    const [numerator, denominator] = (value ?? "").split("/").map(Number);
    if (
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        numerator <= 0 ||
        denominator <= 0
    ) {
        return undefined;
    }
    return Math.round((numerator / denominator) * 1000) / 1000;
}

function displayRotation(stream: ProbeStream): number {
    const sideData = stream.side_data_list?.find(
        (item) => typeof item.rotation === "number",
    )?.rotation;
    const tag = Number.parseInt(stream.tags?.rotate ?? "", 10);
    const rotation = sideData ?? tag;
    if (!Number.isFinite(rotation)) {
        return 0;
    }
    return ((Math.round(rotation) % 360) + 360) % 360;
}

function readDurationMs(data: ProbeData, stream: ProbeStream): number {
    const seconds = Number.parseFloat(
        data.format?.duration ?? stream.duration ?? "",
    );
    return Number.isFinite(seconds) && seconds > 0
        ? Math.round(seconds * 1000)
        : 0;
}

/**
 * Validates a source from its content. Throws a ProfileVideoError with code
 * "rejected_source" when the file is not an acceptable video.
 */
export async function probe(sourcePath: string): Promise<SourceProbe> {
    let data: ProbeData;
    try {
        data = await ffprobe(sourcePath);
    } catch {
        throw new ProfileVideoError(
            "rejected_source",
            "Source could not be read.",
        );
    }

    const formatNames = (data.format?.format_name ?? "").split(",");
    if (!formatNames.some((name) => ALLOWED_CONTAINERS.has(name))) {
        throw new ProfileVideoError(
            "rejected_source",
            "Unsupported source container.",
        );
    }

    const videoStreams = (data.streams ?? []).filter(
        (stream) => stream.codec_type === "video",
    );
    const videoStreamOrdinal = videoStreams.findIndex(
        (stream) => stream.disposition?.attached_pic !== 1,
    );
    if (videoStreamOrdinal < 0) {
        throw new ProfileVideoError(
            "rejected_source",
            "Source has no video stream.",
        );
    }

    const stream = videoStreams[videoStreamOrdinal];
    if (!ALLOWED_CODECS.has(stream.codec_name ?? "")) {
        throw new ProfileVideoError(
            "rejected_source",
            `Unsupported source codec: ${stream.codec_name ?? "unknown"}.`,
        );
    }

    const rotation = displayRotation(stream);
    const rotated = rotation === 90 || rotation === 270;
    const width = rotated ? stream.height : stream.width;
    const height = rotated ? stream.width : stream.height;
    if (
        !width ||
        !height ||
        width > MAX_SOURCE_SIDE ||
        height > MAX_SOURCE_SIDE
    ) {
        throw new ProfileVideoError(
            "rejected_source",
            `Source dimensions must be at most ${MAX_SOURCE_SIDE} pixels per side.`,
        );
    }

    const sourceFps =
        parseFrameRate(stream.avg_frame_rate) ??
        parseFrameRate(stream.r_frame_rate) ??
        MAX_OUTPUT_FPS;

    return {
        durationMs: readDurationMs(data, stream),
        width,
        height,
        fps: sourceFps,
        hdr: HDR_TRANSFERS.has(stream.color_transfer ?? ""),
        videoStreamOrdinal,
    };
}

function readCrop(crop: NormalizedCrop): [number, number, number, number] {
    const [x, y, width, height] = [crop.x, crop.y, crop.width, crop.height].map(
        Number,
    );
    const valid =
        [x, y, width, height].every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1,
        ) &&
        width > 0 &&
        height > 0 &&
        x + width <= 1 &&
        y + height <= 1;
    if (!valid) {
        throw new ProfileVideoError("conversion_failed", "Invalid crop.");
    }
    return [x, y, width, height];
}

function buildFilter(
    source: SourceProbe,
    target: { width: number; height: number },
    crop?: NormalizedCrop,
): string {
    const filters: string[] = [];
    if (source.hdr) {
        filters.push(...HDR_FILTERS);
    }
    if (crop) {
        const [x, y, width, height] = readCrop(crop);
        filters.push(`crop=iw*${width}:ih*${height}:iw*${x}:ih*${y}`);
    }
    filters.push(`fps=${Math.min(source.fps, MAX_OUTPUT_FPS)}`);
    filters.push(
        `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase:force_divisible_by=2`,
    );
    filters.push(`crop=${target.width}:${target.height}`);
    filters.push("format=yuv420p");
    return filters.join(",");
}

function conversionArgs(
    sourcePath: string,
    source: SourceProbe,
    slot: ProfileVideoSlot,
    outputPath: string,
    crop?: NormalizedCrop,
): string[] {
    const budget = PROFILE_VIDEO_BUDGETS[slot];
    return [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        ...INPUT_ACCESS_ARGS,
        "-i",
        sourcePath,
        "-map",
        `0:v:${source.videoStreamOrdinal}`,
        "-an",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-t",
        `${MAX_OUTPUT_DURATION_SECONDS}`,
        "-vf",
        buildFilter(source, budget, crop),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-maxrate",
        budget.maxRate,
        "-bufsize",
        budget.bufSize,
        "-threads",
        "2",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        "-y",
        outputPath,
    ];
}

function posterArgs(videoPath: string, posterPath: string): string[] {
    return [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        ...INPUT_ACCESS_ARGS,
        "-i",
        videoPath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "-c:v",
        "mjpeg",
        "-q:v",
        "2",
        "-y",
        posterPath,
    ];
}

/**
 * Creates the per-job output directory and gives it to the unprivileged user
 * that media processes run as.
 */
export async function prepareJobDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    if (typeof process.getuid === "function" && process.getuid() === 0) {
        await chown(directory, MEDIA_NOBODY_UID, MEDIA_NOBODY_GID);
    }
}

export function assertWithinBudget(slot: ProfileVideoSlot, size: number): void {
    if (size > PROFILE_VIDEO_BUDGETS[slot].maxBytes) {
        throw new ProfileVideoError(
            "output_too_large",
            `Converted ${slot} video exceeds its size budget.`,
        );
    }
}

/**
 * Converts a validated source into the slot's MP4 and a JPEG poster of its
 * first frame. Both files are generated inside jobDirectory.
 */
export async function convert(
    slot: ProfileVideoSlot,
    sourcePath: string,
    jobDirectory: string,
    crop?: NormalizedCrop,
): Promise<ConvertedVideo> {
    const source = await probe(sourcePath);
    const budget = PROFILE_VIDEO_BUDGETS[slot];
    const videoPath = join(jobDirectory, "video.mp4");
    const posterPath = join(jobDirectory, "poster.jpg");

    try {
        await prepareJobDirectory(jobDirectory);
        await runMediaProcess(
            "ffmpeg",
            conversionArgs(sourcePath, source, slot, videoPath, crop),
            { cwd: jobDirectory },
        );
        const { size } = await stat(videoPath);
        assertWithinBudget(slot, size);

        const output = await ffprobe(videoPath);
        const stream = (output.streams ?? []).find(
            (item) => item.codec_type === "video",
        );
        if (!stream?.width || !stream?.height) {
            throw new ProfileVideoError(
                "conversion_failed",
                "Converted video is unreadable.",
            );
        }

        await runMediaProcess("ffmpeg", posterArgs(videoPath, posterPath), {
            cwd: jobDirectory,
        });

        return {
            path: videoPath,
            posterPath,
            size,
            durationMs: readDurationMs(output, stream),
            width: stream.width,
            height: stream.height,
        };
    } catch (error: unknown) {
        if (error instanceof ProfileVideoError) {
            throw error;
        }
        throw new ProfileVideoError("conversion_failed");
    }
}
