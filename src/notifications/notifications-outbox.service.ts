import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { randomUUID } from "node:crypto";
import {
    MAX_PAYLOAD_BYTES,
    NotificationEventIntent,
    SUPPORTED_EVENT_TYPES,
    SUPPORTED_EVENT_VERSION,
} from "./notifications.types";
import { NotificationOutbox } from "./entity/notification-outbox.entity";

export class NotificationIntentValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NotificationIntentValidationError";
    }
}

export function validateNotificationIntent(
    intent: NotificationEventIntent,
): void {
    if (!intent) {
        throw new NotificationIntentValidationError("Intent cannot be empty");
    }

    if (intent.eventVersion !== SUPPORTED_EVENT_VERSION) {
        throw new NotificationIntentValidationError(
            `Unsupported event version: ${intent.eventVersion}. Supported version: ${SUPPORTED_EVENT_VERSION}`,
        );
    }

    if (!SUPPORTED_EVENT_TYPES.includes(intent.eventType)) {
        throw new NotificationIntentValidationError(
            `Unsupported event type: ${intent.eventType}`,
        );
    }

    if (
        intent.id !== undefined &&
        (typeof intent.id !== "string" ||
            intent.id.trim().length === 0 ||
            intent.id.length > 255)
    ) {
        throw new NotificationIntentValidationError("Invalid intent id");
    }

    if (
        intent.recipientUserId !== null &&
        (typeof intent.recipientUserId !== "string" ||
            intent.recipientUserId.trim().length === 0 ||
            intent.recipientUserId.length > 255)
    ) {
        throw new NotificationIntentValidationError("Invalid recipientUserId");
    }

    if (
        intent.actorUserId !== null &&
        (typeof intent.actorUserId !== "string" ||
            intent.actorUserId.trim().length === 0 ||
            intent.actorUserId.length > 255)
    ) {
        throw new NotificationIntentValidationError("Invalid actorUserId");
    }

    if (!intent.payload || typeof intent.payload !== "object") {
        throw new NotificationIntentValidationError(
            "Payload must be a non-null object",
        );
    }

    let payloadString: string;
    try {
        payloadString = JSON.stringify(intent.payload);
    } catch {
        throw new NotificationIntentValidationError(
            "Payload cannot be serialized to JSON",
        );
    }

    if (Buffer.byteLength(payloadString, "utf8") > MAX_PAYLOAD_BYTES) {
        throw new NotificationIntentValidationError(
            `Oversized payload: ${Buffer.byteLength(
                payloadString,
                "utf8",
            )} bytes exceeds maximum ${MAX_PAYLOAD_BYTES} bytes`,
        );
    }

    if (
        intent.occurredAt !== undefined &&
        (!(intent.occurredAt instanceof Date) ||
            !Number.isFinite(intent.occurredAt.getTime()))
    ) {
        throw new NotificationIntentValidationError("Invalid occurredAt");
    }

    const identity = (value: unknown) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 255;
    const count = (value: unknown) =>
        Number.isSafeInteger(value) && Number(value) >= 0;
    const positiveId = (value: unknown) => count(value) && Number(value) > 0;
    const rootTypes = ["review", "post", "activity"];
    const payload = intent.payload as unknown as Record<string, any>;
    let allowed: string[];
    let valid: boolean;
    switch (intent.eventType) {
        case "content.liked":
            allowed = [
                "likeId",
                "subjectType",
                "subjectId",
                "rootType",
                "rootId",
            ];
            valid =
                positiveId(payload.likeId) &&
                [...rootTypes, "comment", "game"].includes(
                    payload.subjectType,
                ) &&
                identity(payload.subjectId) &&
                ((payload.rootType === undefined &&
                    payload.rootId === undefined) ||
                    (rootTypes.includes(payload.rootType) &&
                        identity(payload.rootId)));
            break;
        case "comment.created":
        case "comment.replied":
            allowed = ["commentId", "rootType", "rootId"];
            valid =
                identity(payload.commentId) &&
                rootTypes.includes(payload.rootType) &&
                identity(payload.rootId);
            if (intent.eventType === "comment.replied") {
                allowed.push("parentCommentId");
                valid =
                    valid &&
                    identity(payload.parentCommentId) &&
                    payload.parentCommentId !== payload.commentId;
            }
            break;
        case "profile.followed":
            allowed = ["followId"];
            valid = positiveId(payload.followId);
            break;
        case "import.discovery-completed":
            allowed = [
                "discoveryResultId",
                "provider",
                "gameCount",
                "importedCount",
                "skippedCount",
                "failedCount",
                "gameSample",
            ];
            valid =
                (positiveId(payload.discoveryResultId) ||
                    identity(payload.discoveryResultId)) &&
                identity(payload.provider) &&
                [
                    payload.gameCount,
                    payload.importedCount,
                    payload.skippedCount,
                    payload.failedCount,
                ].every(count) &&
                (payload.gameSample === undefined ||
                    (Array.isArray(payload.gameSample) &&
                        payload.gameSample.length <= 3 &&
                        payload.gameSample.every(
                            (game: any) =>
                                game &&
                                positiveId(game.id) &&
                                typeof game.title === "string" &&
                                game.title.length <= 100 &&
                                Object.keys(game).every((key) =>
                                    ["id", "title"].includes(key),
                                ),
                        )));
            break;
        case "moderation.applied":
            allowed = ["action", "safeReason", "reportId"];
            valid =
                ["alert", "suspension", "ban"].includes(payload.action) &&
                (payload.safeReason === undefined ||
                    (typeof payload.safeReason === "string" &&
                        payload.safeReason.length <= 240)) &&
                (payload.reportId === undefined ||
                    positiveId(payload.reportId));
            break;
    }
    if (
        !valid ||
        Array.isArray(payload) ||
        Object.keys(payload).some((key) => !allowed.includes(key))
    ) {
        throw new NotificationIntentValidationError("Invalid event payload");
    }
}

export async function appendNotificationIntent(
    manager: EntityManager,
    intent: NotificationEventIntent,
): Promise<NotificationOutbox> {
    validateNotificationIntent(intent);
    if (!manager.queryRunner?.isTransactionActive) {
        throw new NotificationIntentValidationError("Notification intent requires the active action transaction");
    }

    const outboxRepo = manager.getRepository(NotificationOutbox);
    const id =
        intent.id && intent.id.trim().length > 0 ? intent.id : randomUUID();

    const record = outboxRepo.create({
        id,
        eventType: intent.eventType,
        eventVersion: intent.eventVersion,
        occurredAt: intent.occurredAt || new Date(),
        recipientUserId: intent.recipientUserId ?? null,
        actorUserId: intent.actorUserId ?? null,
        payload: intent.payload,
        state: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        ownerToken: null,
        ownerExpiresAt: null,
        completedAt: null,
        lastError: null,
    });

    await outboxRepo.insert(record);
    return record;
}

@Injectable()
export class NotificationsOutboxService {
    appendIntent(
        manager: EntityManager,
        intent: NotificationEventIntent,
    ): Promise<NotificationOutbox> {
        return appendNotificationIntent(manager, intent);
    }
}
