import { NotificationsController } from "./notifications.controller";
import { FindNotificationsDto } from "./dto/find-notifications.dto";
import { NotificationReadAllRequestDto } from "./dto/notification-read-all.dto";
import { NotificationReadRequestDto } from "./dto/notification-read.dto";
import { Test } from "@nestjs/testing";
import {
    BadRequestException,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { NotificationsService } from "./notifications.service";

describe("NotificationsController", () => {
    it("documents the sole contract and typed destinations without retired routes or source hydration DTOs", async () => {
        const module = await Test.createTestingModule({
            controllers: [NotificationsController],
            providers: [{ provide: NotificationsService, useValue: {} }],
        })
            .overrideGuard(AuthGuard)
            .useValue({ canActivate: () => true })
            .compile();
        const app = module.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
        try {
            const document = SwaggerModule.createDocument(
                app,
                new DocumentBuilder()
                    .setTitle("Notification contract")
                    .setVersion("1")
                    .build(),
            );
            expect(Object.keys(document.paths)).toEqual([
                "/v1/notifications",
                "/v1/notifications/read",
                "/v1/notifications/read-all",
            ]);
            const schemas = document.components!.schemas! as Record<
                string,
                any
            >;
            expect(
                schemas.NotificationInboxItemDto.properties.target.oneOf,
            ).toHaveLength(6);
            expect(schemas.NotificationConnectionTargetDto.required).toEqual(
                expect.arrayContaining(["type", "id", "provider"]),
            );
            for (const dto of [
                "NotificationImporterTargetDto",
                "NotificationImportPreviewDto",
                "NotificationConnectionTargetDto",
            ]) {
                expect(schemas[dto].properties.provider.enum).toEqual([
                    "steam",
                    "psn",
                    "xbox",
                    "epicgames",
                    "nintendo",
                    "gog",
                ]);
            }
            expect(
                schemas.NotificationActivityTargetDto.properties,
            ).toMatchObject({
                activityType: expect.any(Object),
                content: expect.any(Object),
                game: expect.any(Object),
            });
            expect(schemas.NotificationImporterTargetDto.required).toContain(
                "provider",
            );
            expect(schemas.NotificationAchievementTargetDto.required).toEqual(
                expect.arrayContaining(["type", "id", "tier"]),
            );
            expect(
                schemas.NotificationContentTargetDto.properties,
            ).not.toHaveProperty("url");
        } finally {
            await app.close();
        }
    });
    it("delegates findAll to notificationsService with session userId", async () => {
        const findAll = jest.fn().mockResolvedValue({
            data: [],
            pagination: { nextCursor: null, hasMore: false },
            unreadCount: 0,
        });
        const controller = new NotificationsController({ findAll } as any);
        const dto: FindNotificationsDto = { limit: 10 };

        const result = await controller.findAll(
            { getUserId: () => "owner-1" } as any,
            dto,
        );

        expect(findAll).toHaveBeenCalledWith("owner-1", dto);
        expect(result.unreadCount).toBe(0);
    });

    it("delegates acknowledgeRead to notificationsService with session userId", async () => {
        const acknowledgeRead = jest.fn().mockResolvedValue({ success: true });
        const controller = new NotificationsController({
            acknowledgeRead,
        } as any);
        const dto: NotificationReadRequestDto = {
            items: [{ id: 1, version: 2 }],
        };

        const result = await controller.acknowledgeRead(
            { getUserId: () => "owner-1" } as any,
            dto,
        );

        expect(acknowledgeRead).toHaveBeenCalledWith("owner-1", dto);
        expect(result.success).toBe(true);
    });

    it("delegates acknowledgeReadAll with the optional before timestamp", async () => {
        const acknowledgeReadAll = jest
            .fn()
            .mockResolvedValue({ success: true, unreadCount: 0 });
        const controller = new NotificationsController({
            acknowledgeReadAll,
        } as any);

        const result = await controller.acknowledgeReadAll(
            { getUserId: () => "owner-1" } as any,
            { before: "2026-11-11T12:00:00.000Z" },
        );

        expect(acknowledgeReadAll).toHaveBeenCalledWith(
            "owner-1",
            "2026-11-11T12:00:00.000Z",
        );
        expect(result).toEqual({ success: true, unreadCount: 0 });

        await controller.acknowledgeReadAll(
            { getUserId: () => "owner-1" } as any,
            undefined as any,
        );
        expect(acknowledgeReadAll).toHaveBeenLastCalledWith(
            "owner-1",
            undefined,
        );
    });

    it("rejects invalid read-all before timestamps and allows an absent body", async () => {
        const pipe = new ValidationPipe();
        const metadata = {
            type: "body" as const,
            metatype: NotificationReadAllRequestDto,
        };

        await expect(
            pipe.transform({ before: "not-a-date" }, metadata),
        ).rejects.toThrow(BadRequestException);
        await expect(pipe.transform({}, metadata)).resolves.toEqual({});
    });
});
