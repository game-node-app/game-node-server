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
