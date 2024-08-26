import { Achievement } from "../models/achievement.model";
import {
    AchievementCategory,
    ACHIEVEMENTS_GAME_THEMES_IDS,
} from "../achievements.constants";
import { Review } from "../../reviews/entities/review.entity";
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
                    collections: {
                        library: {
                            userId: targetUserId,
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
                    entries: {
                        game: {
                            themes: {
                                // Horror game ID in the game_theme table.
                                id: ACHIEVEMENTS_GAME_THEMES_IDS.HORROR_ID,
                            },
                        },
                    },
                },
                relations: {
                    entries: {
                        game: {
                            themes: true,
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
];
