import {
    audienceSatisfiesLevel,
    isEntryVisible,
    LIBRARY_AUDIENCE_RANK,
    LIBRARY_VISIBILITY_LEVELS,
    LIBRARY_VISIBILITY_RANK,
    LibraryAudience,
    LibraryVisibility,
    levelsSatisfiedByAudience,
    visibleEntryLevels,
} from "./library-visibility.constants";

const AUDIENCES = Object.values(LibraryAudience);
const VISIBILITIES = Object.values(LibraryVisibility);

/** Expected rule, written independently from the rank table. */
const expectedVisible = (
    audience: LibraryAudience,
    libraryVisibility: LibraryVisibility,
    entryVisibility: LibraryVisibility,
) => {
    if (audience === LibraryAudience.Owner) return true;
    if (audience === LibraryAudience.Follower) {
        return (
            libraryVisibility !== LibraryVisibility.Private &&
            entryVisibility !== LibraryVisibility.Private
        );
    }
    return (
        libraryVisibility === LibraryVisibility.Public &&
        entryVisibility === LibraryVisibility.Public
    );
};

const expectedLevels = (
    audience: LibraryAudience,
    libraryVisibility: LibraryVisibility,
): LibraryVisibility[] => {
    if (audience === LibraryAudience.Owner)
        return [...LIBRARY_VISIBILITY_LEVELS];
    if (audience === LibraryAudience.Follower) {
        return libraryVisibility === LibraryVisibility.Private
            ? []
            : [LibraryVisibility.Public, LibraryVisibility.Followers];
    }
    return libraryVisibility === LibraryVisibility.Public
        ? [LibraryVisibility.Public]
        : [];
};

describe("library visibility constants", () => {
    it("ranks levels and audiences in the same order", () => {
        expect(LIBRARY_AUDIENCE_RANK[LibraryAudience.Everyone]).toBe(0);
        expect(LIBRARY_AUDIENCE_RANK[LibraryAudience.Follower]).toBe(1);
        expect(LIBRARY_AUDIENCE_RANK[LibraryAudience.Owner]).toBe(2);
        expect(LIBRARY_VISIBILITY_RANK[LibraryVisibility.Public]).toBe(0);
        expect(LIBRARY_VISIBILITY_RANK[LibraryVisibility.Followers]).toBe(1);
        expect(LIBRARY_VISIBILITY_RANK[LibraryVisibility.Private]).toBe(2);
    });

    it("agrees with the rule for every profile level, entry level and audience", () => {
        for (const audience of AUDIENCES) {
            for (const libraryVisibility of VISIBILITIES) {
                for (const entryVisibility of VISIBILITIES) {
                    expect({
                        audience,
                        libraryVisibility,
                        entryVisibility,
                        visible: isEntryVisible(
                            audience,
                            libraryVisibility,
                            entryVisibility,
                        ),
                    }).toEqual({
                        audience,
                        libraryVisibility,
                        entryVisibility,
                        visible: expectedVisible(
                            audience,
                            libraryVisibility,
                            entryVisibility,
                        ),
                    });
                }
            }
        }
    });

    it("lists the visible entry levels for every audience and profile level", () => {
        for (const audience of AUDIENCES) {
            expect(levelsSatisfiedByAudience(audience)).toEqual(
                VISIBILITIES.filter((level) =>
                    audienceSatisfiesLevel(audience, level),
                ),
            );
            for (const libraryVisibility of VISIBILITIES) {
                expect(visibleEntryLevels(audience, libraryVisibility)).toEqual(
                    expectedLevels(audience, libraryVisibility),
                );
            }
        }
    });
});
