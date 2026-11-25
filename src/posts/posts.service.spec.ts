import { PostsService } from "./posts.service";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";

it("returns the saved post and registers its activity after committing", async () => {
    const save = jest.fn(async (post) => ({ ...post, id: "post" }));
    const repository = {
        create: (post: object) => post,
        manager: {
            transaction: async (
                action: (manager: object) => Promise<unknown>,
            ) =>
                action({
                    queryRunner: { isTransactionActive: true },
                    connection: { options: {} },
                    query: async () => ({ insertId: 1 }),
                    getRepository: () => ({ save }),
                }),
        },
    };
    const activities = { register: jest.fn() };
    const service = new PostsService(
        repository as any,
        {} as any,
        activities as any,
    );
    const post = await service.create("user", {
        gameId: 1,
        content: "<p>Hello</p>",
    });
    expect(post).toMatchObject({
        id: "post",
        profileUserId: "user",
        gameId: 1,
        content: "<p>Hello</p>",
    });
    expect(activities.register).toHaveBeenCalledWith({
        type: ActivityType.POST,
        profileUserId: "user",
        sourceId: "post",
    });
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
        activities.register.mock.invocationCallOrder[0],
    );
});

it("keeps GIF uploads for posts unchanged", async () => {
    const save = jest.fn(async () => ({
        fileName: "post-image",
        fileExt: "gif",
        fileNameWithExtension: "post-image.gif",
    }));
    const service = new PostsService({} as any, { save } as any, {} as any);
    const file = {
        buffer: Buffer.from("GIF89a"),
        mimetype: "image/gif",
    } as Express.Multer.File;

    await expect(service.uploadPostImage("user", file)).resolves.toEqual({
        filename: "post-image.gif",
    });
    expect(save).toHaveBeenCalledWith("user", file);
});

describe("PostsService guild contract evaluation hook", () => {
    function fixture() {
        const save = jest.fn(async (post) => ({ ...post, id: "post" }));
        const repository = {
            create: (post: object) => post,
            manager: {
                transaction: async (
                    action: (manager: object) => Promise<unknown>,
                ) =>
                    action({
                        queryRunner: { isTransactionActive: true },
                        connection: { options: {} },
                        query: async () => ({ insertId: 1 }),
                        getRepository: () => ({ save }),
                    }),
            },
        };
        const guildQueue = { enqueueEvaluation: jest.fn() };
        const service = new PostsService(
            repository as any,
            {} as any,
            { register: jest.fn() } as any,
            undefined,
            guildQueue as any,
        );
        return { service, save, guildQueue };
    }

    it("schedules evaluation after the post commits", async () => {
        const { service, save, guildQueue } = fixture();

        await service.create("user", { gameId: 1, content: "<p>Hello</p>" });

        expect(guildQueue.enqueueEvaluation).toHaveBeenCalledWith(
            "user",
            "post",
        );
        expect(save.mock.invocationCallOrder[0]).toBeLessThan(
            guildQueue.enqueueEvaluation.mock.invocationCallOrder[0],
        );
    });

    it("does not wait for the evaluation queue before committing", async () => {
        const { service, guildQueue } = fixture();
        guildQueue.enqueueEvaluation.mockReturnValue(new Promise(() => {}));

        await expect(
            service.create("user", { gameId: 1, content: "<p>Hello</p>" }),
        ).resolves.toMatchObject({ id: "post" });
        expect(guildQueue.enqueueEvaluation).toHaveBeenCalledTimes(1);
    });
});
