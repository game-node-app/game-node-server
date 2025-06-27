import { Achievement } from "../models/achievement.model";
import {
    AchievementCategory,
    ACHIEVEMENTS_GAME_IDS,
    ACHIEVEMENTS_GAME_THEMES_IDS,
} from "../achievements.constants";
import { Collection } from "../../collections/entities/collection.entity";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";

export const achievementsCollectionsData: Achievement[] = [
    {
        id: "space-station",
        name: "Space Station",
        description: "Add 100 games to your collections",
        expGainAmount: 75,
        category: AchievementCategory.COLLECTIONS,
        checkEligibility: async (dataSource, targetUserId) => {
            const collectionEntriesRepository =
                dataSource.getRepository(CollectionEntry);
            const totalCollectionEntries =
                await collectionEntriesRepository.countBy({
                    collectionsMap: {
                        collection: {
                            libraryUserId: targetUserId,
                        },
                    },
                });

            return totalCollectionEntries >= 100;
        },
    },
    {
        id: "boo",
        name: "Boo!",
        description:
            "Have a collection composing of at least five horror games",
        expGainAmount: 75,
        category: AchievementCategory.COLLECTIONS,
        checkEligibility: async (dataSource, targetUserId) => {
            const minimumCollectionEntries = 5;
            const collectionRepository = dataSource.getRepository(Collection);
            const collectionsWithHorrorGames = await collectionRepository.find({
                where: {
                    library: {
                        userId: targetUserId,
                    },
                    entriesMap: {
                        collectionEntry: {
                            game: {
                                themes: {
                                    // Horror game ID in the game_theme table.
                                    id: ACHIEVEMENTS_GAME_THEMES_IDS.HORROR_ID,
                                },
                            },
                        },
                    },
                },
                relations: {
                    entriesMap: {
                        collectionEntry: {
                            game: {
                                themes: true,
                            },
                        },
                    },
                },
            });
            const collectionMeetsCriteria = collectionsWithHorrorGames.some(
                (collection) => {
                    if (
                        collection.entries == undefined ||
                        collection.entries.length === 0
                    ) {
                        return false;
                    }
                    const horrorGamesInCollection = collection.entries.filter(
                        (entry) => {
                            try {
                                const game = entry.game;
                                const themes = game.themes;
                                return (
                                    themes &&
                                    themes.some(
                                        (theme) =>
                                            theme.id ===
                                            ACHIEVEMENTS_GAME_THEMES_IDS.HORROR_ID,
                                    )
                                );
                                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            } catch (e) {}

                            return false;
                        },
                    );
                    return (
                        horrorGamesInCollection.length >=
                        minimumCollectionEntries
                    );
                },
            );

            return collectionMeetsCriteria;
        },
    },
    {
        id: "a-survivor-is-born",
        name: "A Survivor is Born",
        category: AchievementCategory.COLLECTIONS,
        expGainAmount: 50,
        description: "Have Tomb Raider 2013 in your library",
        checkEligibility: async (dataSource, targetUserId) => {
            const collectionEntryRepository =
                dataSource.getRepository(CollectionEntry);

            return await collectionEntryRepository.existsBy({
                gameId: ACHIEVEMENTS_GAME_IDS.TOMB_RAIDER_2013,
                collectionsMap: {
                    collection: {
                        libraryUserId: targetUserId,
                    },
                },
            });
        },
    },
];
