import { ImporterWatchService } from "./importer-watch.service";

test("importer notification reads remain scoped to their owner", async () => {
    const findOneOrFail = jest.fn().mockResolvedValue({ id: 1 });
    const service = new ImporterWatchService({ findOneOrFail } as any);
    await expect(service.findNotification("user", 1)).resolves.toEqual({
        id: 1,
    });
    expect(findOneOrFail).toHaveBeenCalledWith({
        where: { libraryUserId: "user", id: 1 },
        relations: { games: true },
    });
});
