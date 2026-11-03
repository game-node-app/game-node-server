import { createHmac, timingSafeEqual } from "node:crypto";
import { DAILY_IMAGE_WIDTHS } from "./daily.constants";

export type DailyImageKind = "cover" | "artwork";

export interface DailyImageTokenPayload {
    /** Puzzle id. */
    p: number;
    k: DailyImageKind;
    /** Pixelation level, or "full" (only issued once the puzzle is finished). */
    l: number | "full";
}

const sign = (body: string, secret: string) =>
    createHmac("sha256", secret).update(body).digest();

export function signDailyImageToken(
    payload: DailyImageTokenPayload,
    secret: string,
): string {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${sign(body, secret).toString("base64url")}`;
}

/** Returns the payload, or `null` for any token this server did not sign. */
export function verifyDailyImageToken(
    token: string,
    secret: string,
): DailyImageTokenPayload | null {
    const [body, signature, ...rest] = token.split(".");
    if (!body || !signature || rest.length) return null;
    const expected = sign(body, secret);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return null;
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString());
        const validLevel =
            payload.l === "full" ||
            (Number.isInteger(payload.l) &&
                payload.l >= 0 &&
                payload.l < DAILY_IMAGE_WIDTHS.length);
        return Number.isInteger(payload.p) &&
            ["cover", "artwork"].includes(payload.k) &&
            validLevel
            ? payload
            : null;
    } catch {
        return null;
    }
}
