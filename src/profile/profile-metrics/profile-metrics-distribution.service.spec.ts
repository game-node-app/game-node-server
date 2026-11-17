import { ProfileMetricsDistributionService } from "./profile-metrics-distribution.service";
import { ProfileMetricsTypeDistributionBy } from "./dto/profile-metrics-type-distribution.dto";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import {
    LibraryAccess,
    LibraryAudience,
    LibraryVisibility,
} from "../../libraries/library-visibility.constants";

const entry = (visibility: LibraryVisibility) => ({
    gameId: 1,
    status: CollectionEntryStatus.PLANNED,
    visibility,
    finishedAt: null,
    ownedPlatforms: [],
});

const EVERYONE_ACCESS: LibraryAccess = {
    audience: LibraryAudience.Everyone,
    libraryVisibility: LibraryVisibility.Public,
    canViewLibrary: true,
    visibleEntryLevels: [LibraryVisibility.Public],
};

function fixture(entries: ReturnType<typeof entry>[]) {
    const findAllByUserIdWithPermissions = jest.fn(async () => [
        entries,
        entries.length,
    ]);
    const service = new ProfileMetricsDistributionService(
        { findAllByUserIdWithPermissions } as never,
        {} as never,
        {} as never,
        {} as never,
    );
    return { service, findAllByUserIdWithPermissions };
}

const totalGames = (distribution: { count: number }[]) =>
    distribution.reduce((total, item) => total + item.count, 0);

describe("ProfileMetricsDistributionService access", () => {
    it("counts only the entries the viewer may see", async () => {
        const { service } = fixture([
            entry(LibraryVisibility.Public),
            entry(LibraryVisibility.Private),
        ]);

        const result = await service.getTypeDistribution(
            "owner-1",
            { by: ProfileMetricsTypeDistributionBy.STATUS },
            EVERYONE_ACCESS,
        );

        expect(totalGames(result.distribution)).toBe(1);
    });

    it("returns nothing and reads no entries when the library is hidden", async () => {
        const { service, findAllByUserIdWithPermissions } = fixture([
            entry(LibraryVisibility.Public),
        ]);

        const result = await service.getTypeDistribution(
            "owner-1",
            { by: ProfileMetricsTypeDistributionBy.STATUS },
            {
                ...EVERYONE_ACCESS,
                canViewLibrary: false,
                visibleEntryLevels: [],
            },
        );

        expect(result).toEqual({ distribution: [] });
        expect(findAllByUserIdWithPermissions).not.toHaveBeenCalled();
    });

    it("keeps the owner's distribution unchanged", async () => {
        const { service } = fixture([
            entry(LibraryVisibility.Public),
            entry(LibraryVisibility.Private),
        ]);

        const result = await service.getTypeDistribution("owner-1", {
            by: ProfileMetricsTypeDistributionBy.STATUS,
        });

        expect(totalGames(result.distribution)).toBe(2);
    });
});
