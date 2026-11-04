/**
 * Contract: GET /v1/game/external?category=<EGameExternalGameCategory>&uids=<id>&uids=<id>...
 * - Any signed-in user may call it with BOTH `category` and `uids` (1-100 distinct, non-blank strings
 *   of at most 256 characters). Exact (category, uid) matches are returned in the usual paginated
 *   envelope, ordered by updatedAt DESC, filtered before limit/offset. Unmapped IDs are simply absent.
 * - Supplying only one of the two, or invalid values, is a 400 (never a catalog listing).
 * - Without either field the original listing is unchanged, including its MOD/ADMIN restriction.
 * - Uses the existing (uid, category) index on GameExternalGame; no migration is needed.
 */
import { ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ExternalGameController } from "./external-game.controller";
import { ExternalGameService } from "./external-game.service";
import { FindExternalGamesRequestDto } from "./dto/find-external-games.dto";
import { EUserRoles } from "../../utils/constants";

// Mirrors main.ts: ValidationPipe({ transform, enableImplicitConversion }).
const parse = async (query: Record<string, unknown>) => {
    const dto = plainToInstance(FindExternalGamesRequestDto, query, {
        enableImplicitConversion: true,
    });
    return { dto, errors: await validate(dto) };
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

describe("external game lookup validation", () => {
    it("accepts a category with one or many UIDs (single value becomes a list)", async () => {
        expect(
            (await parse({ category: "1", uids: ["570", "730"] })).errors,
        ).toEqual([]);
        const one = await parse({ category: "1", uids: "570" });
        expect(one.errors).toEqual([]);
        expect(one.dto.uids).toEqual(["570"]);
        expect(one.dto.category).toBe(1);
        expect((await parse({ category: 1, uids: ids(100) })).errors).toEqual(
            [],
        );
    });

    it("leaves plain listings untouched", async () => {
        const { dto, errors } = await parse({ limit: "5", offset: "10" });
        expect(errors).toEqual([]);
        expect(dto).toMatchObject({ limit: 5, offset: 10, uids: undefined });
    });

    it.each([
        ["category only", { category: 1 }],
        ["uids only", { uids: ["570"] }],
        ["unknown category", { category: 999, uids: ["570"] }],
        ["empty list", { category: 1, uids: [] }],
        ["101 uids", { category: 1, uids: ids(101) }],
        ["blank uid", { category: 1, uids: ["570", ""] }],
        ["oversized uid", { category: 1, uids: ["x".repeat(257)] }],
    ])("rejects %s", async (_name, query) => {
        expect(
            (await parse(query as Record<string, unknown>)).errors.length,
        ).toBeGreaterThan(0);
    });
});

describe("ExternalGameController.findAll access", () => {
    const controller = (findAll = jest.fn().mockResolvedValue([[], 0])) => ({
        findAll,
        controller: new ExternalGameController({ findAll } as any, {} as any),
    });
    const session = (role?: string) => ({ user: { role } }) as any;

    it("is no longer role-gated by metadata", () => {
        expect(
            Reflect.getMetadata(
                "roles",
                ExternalGameController.prototype.findAll,
            ),
        ).toBeUndefined();
    });

    it("lets any signed-in user perform a lookup", async () => {
        const { controller: c, findAll } = controller();
        const dto = { category: 1, uids: ["570"] } as any;
        await c.findAll(dto, session(undefined));
        expect(findAll).toHaveBeenCalledWith(dto);
    });

    it("keeps the unfiltered listing for moderators and admins only", async () => {
        const { controller: c, findAll } = controller();
        const dto = { limit: 20, offset: 0 } as any;
        await expect(c.findAll(dto, session(undefined))).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await expect(c.findAll(dto, session("user"))).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await c.findAll(dto, session(EUserRoles.MOD.valueOf()));
        await c.findAll(dto, session(`user,${EUserRoles.ADMIN.valueOf()}`));
        expect(findAll).toHaveBeenCalledTimes(2);
    });
});

describe("ExternalGameService.findAll lookup", () => {
    it("filters by category and distinct UIDs before pagination", async () => {
        const findAndCount = jest.fn().mockResolvedValue([[], 0]);
        const service = new ExternalGameService(
            { findAndCount } as any,
            {} as any,
        );
        await service.findAll({
            category: 1,
            uids: ["570", "730", "570"],
            limit: 20,
            offset: 40,
        } as any);
        const options = findAndCount.mock.calls[0][0];
        expect(options.where.category).toBe(1);
        expect(options.where.uid.value).toEqual(["570", "730"]);
        expect(options).toMatchObject({ take: 20, skip: 40 });
    });

    it("keeps the unfiltered listing query unchanged", async () => {
        const findAndCount = jest.fn().mockResolvedValue([[], 0]);
        const service = new ExternalGameService(
            { findAndCount } as any,
            {} as any,
        );
        await service.findAll({ limit: 5, offset: 10 } as any);
        const options = findAndCount.mock.calls[0][0];
        expect(options.where).toBeUndefined();
        expect(options).toMatchObject({
            take: 5,
            skip: 10,
            order: { updatedAt: "DESC" },
        });
    });
});
