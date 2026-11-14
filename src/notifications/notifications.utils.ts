import { BadRequestException } from "@nestjs/common";
import { NotificationFilter } from "./notifications.types";

export interface NotificationCursorPayload {
    u: string;
    t: number;
    i: number;
    f?: NotificationFilter;
}

export function encodeNotificationCursor(
    userId: string,
    lastEventAt: Date,
    id: number,
    filter: NotificationFilter,
): string {
    const payload: NotificationCursorPayload = {
        u: userId,
        t: new Date(lastEventAt).getTime(),
        i: id,
        f: filter,
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeNotificationCursor(
    cursor: string,
    expectedUserId: string,
    expectedFilter: NotificationFilter,
): { lastEventAt: Date; id: number } {
    try {
        if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
            throw new BadRequestException("Invalid cursor format");
        }
        const json = Buffer.from(cursor, "base64url").toString("utf8");
        const payload = JSON.parse(json) as NotificationCursorPayload;
        if (!payload || typeof payload !== "object") {
            throw new BadRequestException("Invalid cursor format");
        }
        if (payload.u !== expectedUserId) {
            throw new BadRequestException(
                "Cursor belongs to another recipient",
            );
        }
        // Legacy cursors predate the filter and belong to the "all" listing.
        const cursorFilter: string = payload.f ?? "all";
        if (
            !Number.isSafeInteger(payload.t) ||
            !Number.isFinite(new Date(payload.t).getTime()) ||
            !Number.isSafeInteger(payload.i) ||
            payload.i < 1 ||
            !["all", "unread"].includes(cursorFilter) ||
            Object.keys(payload).some(
                (key) => !["u", "t", "i", "f"].includes(key),
            )
        ) {
            throw new BadRequestException("Invalid cursor payload");
        }
        if (cursorFilter !== expectedFilter) {
            throw new BadRequestException("Cursor belongs to another filter");
        }
        return {
            lastEventAt: new Date(payload.t),
            id: payload.i,
        };
    } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException("Invalid cursor");
    }
}
