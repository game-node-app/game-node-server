import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, IsNull, Repository } from "typeorm";
import { AwardsNomination } from "../entity/awards-nomination.entity";
import { AwardsCategory } from "../entity/awards-category.entity";
import { AwardsCategorySuggestion } from "../entity/awards-category-suggestion.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { AwardsService } from "../awards.service";
import { assertGameEligible, getAwardsPhase } from "../awards.utils";
import { MAX_NOMINATIONS_PER_CATEGORY } from "../dto/update-nominations.dto";

export type MyNominationsCategory = {
    categoryId: number;
    gameIds: number[];
};

@Injectable()
export class AwardsNominationService {
    constructor(
        @InjectRepository(AwardsNomination)
        private readonly awardsNominationRepository: Repository<AwardsNomination>,
        @InjectRepository(AwardsCategory)
        private readonly awardsCategoryRepository: Repository<AwardsCategory>,
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        private readonly awardsService: AwardsService,
        private readonly dataSource: DataSource,
    ) {}

    /**
     * Replaces the user's nominations for one category in a single transaction.
     */
    public async replaceNominations(
        userId: string,
        eventId: number,
        categoryId: number,
        gameIds: number[],
        now: Date = new Date(),
    ): Promise<void> {
        if (gameIds.length > MAX_NOMINATIONS_PER_CATEGORY) {
            throw new HttpException(
                `A user can nominate at most ${MAX_NOMINATIONS_PER_CATEGORY} games per category.`,
                HttpStatus.BAD_REQUEST,
            );
        }
        if (new Set(gameIds).size !== gameIds.length) {
            throw new HttpException(
                "Duplicate game ids are not allowed.",
                HttpStatus.BAD_REQUEST,
            );
        }

        const event = await this.awardsService.getEventById(eventId);
        if (event == null) {
            throw new HttpException(
                `No registered event for id ${eventId}.`,
                HttpStatus.NOT_FOUND,
            );
        }
        const category = await this.awardsCategoryRepository.findOneBy({
            id: categoryId,
            eventId,
        });
        if (category == null) {
            throw new HttpException(
                `No registered category for id ${categoryId}.`,
                HttpStatus.BAD_REQUEST,
            );
        }
        if (category.isPersonalGOTY) {
            throw new HttpException(
                "The personal GOTY category does not accept nominations.",
                HttpStatus.BAD_REQUEST,
            );
        }
        if (getAwardsPhase(event, now) !== "nominations") {
            throw new HttpException(
                "Nominations are not open for this event.",
                HttpStatus.BAD_REQUEST,
            );
        }

        const games =
            gameIds.length > 0
                ? await this.gameRepository.findBy({ id: In(gameIds) })
                : [];
        if (games.length !== gameIds.length) {
            throw new HttpException(
                "One or more games do not exist.",
                HttpStatus.BAD_REQUEST,
            );
        }
        for (const game of games) {
            assertGameEligible(event, game);
        }

        await this.dataSource.transaction(async (manager) => {
            // Serialize with finalizeNominees, which locks the same category row.
            const lockedCategory = await manager.findOne(AwardsCategory, {
                where: { id: categoryId },
                lock: { mode: "pessimistic_write" },
            });
            if (
                lockedCategory?.nomineesFinalizedAt != null ||
                getAwardsPhase(event, now) !== "nominations"
            ) {
                throw new HttpException(
                    "Nominations are not open for this event.",
                    HttpStatus.BAD_REQUEST,
                );
            }
            await manager.delete(AwardsNomination, {
                categoryId,
                profileUserId: userId,
            });
            if (gameIds.length > 0) {
                await manager.insert(
                    AwardsNomination,
                    gameIds.map((gameId) => ({
                        categoryId,
                        gameId,
                        profileUserId: userId,
                    })),
                );
            }
        });
    }

    /**
     * Every category that accepts nominations, in category order, with the user's game ids.
     */
    public async getMyNominations(
        userId: string,
        eventId: number,
    ): Promise<MyNominationsCategory[]> {
        const event = await this.awardsService.getEventById(eventId);
        if (event == null) {
            throw new HttpException(
                `No registered event for id ${eventId}.`,
                HttpStatus.NOT_FOUND,
            );
        }

        const categories = await this.awardsCategoryRepository.find({
            where: { eventId, isPersonalGOTY: false },
            order: { order: "ASC" },
        });
        if (categories.length === 0) return [];

        const nominations = await this.awardsNominationRepository.find({
            where: {
                profileUserId: userId,
                categoryId: In(categories.map((category) => category.id)),
            },
        });
        return categories.map((category) => ({
            categoryId: category.id,
            gameIds: nominations
                .filter((nomination) => nomination.categoryId === category.id)
                .map((nomination) => nomination.gameId),
        }));
    }

    /**
     * Finalizes each pending nominations-enabled category from its most-nominated games.
     * Categories that already have nominees keep them; each category commits in its own transaction.
     */
    public async finalizeNominees(eventId: number): Promise<void> {
        const categories = await this.awardsCategoryRepository.find({
            where: {
                eventId,
                isPersonalGOTY: false,
                nomineesFinalizedAt: IsNull(),
            },
        });

        for (const category of categories) {
            await this.dataSource.transaction(async (manager) => {
                const lockedCategory = await manager.findOne(AwardsCategory, {
                    where: { id: category.id },
                    lock: { mode: "pessimistic_write" },
                });
                if (
                    lockedCategory == null ||
                    lockedCategory.nomineesFinalizedAt != null
                ) {
                    return;
                }

                const hasSuggestions =
                    (await manager.countBy(AwardsCategorySuggestion, {
                        categoryId: category.id,
                    })) > 0;
                if (!hasSuggestions) {
                    // language=MySQL
                    const topGames: { gameId: number }[] = await manager.query(
                        `SELECT gameId
                         FROM awards_nomination
                         WHERE categoryId = ?
                         GROUP BY gameId
                         ORDER BY COUNT(DISTINCT profileUserId) DESC, gameId ASC
                         LIMIT ?`,
                        [category.id, lockedCategory.nomineeCount],
                    );
                    if (topGames.length > 0) {
                        await manager.insert(
                            AwardsCategorySuggestion,
                            topGames.map(({ gameId }) => ({
                                categoryId: category.id,
                                gameId: Number(gameId),
                            })),
                        );
                    }
                }

                await manager.update(
                    AwardsCategory,
                    { id: category.id },
                    { nomineesFinalizedAt: new Date() },
                );
            });
        }
    }
}
