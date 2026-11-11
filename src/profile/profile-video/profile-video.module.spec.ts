import { PROFILE_VIDEO_TEST_TEMP_ROOT } from "../../../test/mocks/profile-video-temp-root";
import { profileVideoQueueMock } from "../../../test/mocks/queue/profile-video-mocks";

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { DynamicModule, Global, Module } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import {
    BullModule,
    getQueueOptionsToken,
    getQueueToken,
} from "@nestjs/bullmq";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { AuthService } from "../../auth/auth.service";
import { BillingService } from "../../billing/billing.service";
import { UploadService } from "../../upload/upload.service";
import { ProfileVideo } from "../entities/profile-video.entity";
import { PROFILE_VIDEO_QUEUE_NAME } from "./profile-video.constants";
import { ProfileVideoModule } from "./profile-video.module";
import { ProfileVideoProcessor } from "./profile-video.processor";
import { ProfileVideoQueueService } from "./profile-video-queue.service";
import { ProfileVideoService } from "./profile-video.service";
import { ProfileVideoTempService } from "./profile-video-temp.service";
import { SupporterGuard } from "../../billing/supporter.guard";

const source = {
    entityMetadatas: [],
    options: { type: "mysql" },
    getRepository: jest.fn((entity) => ({ target: entity })),
};

@Global()
@Module({
    providers: [
        { provide: DataSource, useValue: source },
        { provide: AuthService, useValue: { getSession: jest.fn() } },
        { provide: UploadService, useValue: {} },
    ],
    exports: [DataSource, AuthService, UploadService],
})
class FixtureModule {}

afterAll(async () => {
    await rm(PROFILE_VIDEO_TEST_TEMP_ROOT, { recursive: true, force: true });
});

test("resolves without a new provider cycle and registers attempts: 1", async () => {
    const module = await Test.createTestingModule({
        imports: [
            FixtureModule,
            ThrottlerModule.forRoot([{ limit: 5, ttl: 60_000 }]),
            ProfileVideoModule,
        ],
    })
        .overrideProvider(getQueueToken(PROFILE_VIDEO_QUEUE_NAME))
        .useValue(profileVideoQueueMock)
        .overrideProvider(BillingService)
        .useValue({ isSupporter: jest.fn(async () => true) })
        .compile();

    try {
        expect(module.get(ProfileVideoService)).toBeInstanceOf(
            ProfileVideoService,
        );
        expect(module.get(ProfileVideoQueueService)).toBeInstanceOf(
            ProfileVideoQueueService,
        );
        expect(module.get(ProfileVideoProcessor)).toBeInstanceOf(
            ProfileVideoProcessor,
        );
        expect(module.get(ProfileVideoTempService)).toBeInstanceOf(
            ProfileVideoTempService,
        );
        expect(module.get(SupporterGuard)).toBeInstanceOf(SupporterGuard);
        expect(module.get(getRepositoryToken(ProfileVideo))).toEqual({
            target: ProfileVideo,
        });
        expect(PROFILE_VIDEO_TEST_TEMP_ROOT).toBeTruthy();
    } finally {
        await module.close();
    }
});

test("the queue default job options override the attempts: 3 default", () => {
    const imports: DynamicModule[] = Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        ProfileVideoModule,
    );
    const registration = imports.find((item) => item.module === BullModule)!;
    const provider = registration.providers!.find(
        (item: any) =>
            item.provide === getQueueOptionsToken(PROFILE_VIDEO_QUEUE_NAME),
    ) as any;
    const options = provider.useFactory({
        getDependencyRef: () => ({
            connection: { host: "localhost", port: 6379 },
            defaultJobOptions: {
                removeOnComplete: true,
                removeOnFail: true,
                attempts: 3,
            },
        }),
    });

    expect(options.connection).toEqual({ host: "localhost", port: 6379 });
    expect(options.defaultJobOptions).toEqual({
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
    });
});

test("the queue service adds the processing job by name", async () => {
    const queue = { add: jest.fn(async () => ({})) };
    const service = new ProfileVideoQueueService(queue as never);
    const job = {
        userId: "user-1",
        type: "avatar" as const,
        sourcePath: "/tmp/source",
        attemptId: "attempt-1",
    };

    await service.add(job);

    expect(queue.add).toHaveBeenCalledWith("process-profile-video", job);
});

test("the application module graph resolves without new forward-reference cycles", () => {
    const script = String.raw`
        require('reflect-metadata');
        const {AppModule} = require('./src/app.module');
        const seen = new Set();
        async function visit(input) {
            const ref = await input;
            if (!ref) throw new Error('Unresolved Nest module import');
            if (ref.forwardRef) return visit(ref.forwardRef());
            const target = ref.module ?? ref;
            if (seen.has(target)) return;
            seen.add(target);
            for (const child of [...(Reflect.getMetadata('imports', target) ?? []), ...(ref.imports ?? [])]) await visit(child);
        }
        visit(AppModule).then(() => process.stdout.write('ok')).catch(error => { console.error(error); process.exitCode = 1; });
    `;
    expect(
        execFileSync(
            process.execPath,
            [
                "-r",
                "ts-node/register/transpile-only",
                "-r",
                "tsconfig-paths/register",
                "-e",
                script,
            ],
            {
                cwd: resolve(__dirname, "../../.."),
                encoding: "utf8",
                timeout: 15000,
            },
        ),
    ).toBe("ok");
});
