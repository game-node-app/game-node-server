import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { AwardsCategory } from "../entity/awards-category.entity";
import { AwardsVote } from "../entity/awards-vote.entity";
import { AwardsEvent } from "../entity/awards-event.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
import { AwardsService } from "../awards.service";
import { AwardsPlayContextService } from "../play-context/awards-play-context.service";
import { getAwardsPhase, isGameEligible } from "../awards.utils";
import { AwardsBallotDto, AwardsUserVoteDto } from "../dto/awards-ballot.dto";

@Injectable()
export class AwardsBallotService {
    constructor(
        @InjectRepository(AwardsCategory)
        private readonly awardsCategoryRepository: Repository<AwardsCategory>,
        @InjectRepository(AwardsVote)
        private readonly awardsVoteRepository: Repository<AwardsVote>,
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        @InjectRepository(CollectionEntry)
        private readonly collectionEntryRepository: Repository<CollectionEntry>,
        private readonly awardsService: AwardsService,
        private readonly awardsPlayContextService: AwardsPlayContextService,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
    ) {}

    public async getBallot(
        userId: string,
        eventId: number,
    ): Promise<AwardsBallotDto> {
        const event = await this.awardsService.getEventById(eventId);
        if (event == null) {
            throw new HttpException(
                `No registered event for id ${eventId}.`,
                HttpStatus.NOT_FOUND,
            );
        }

        const [categories, votes] = await Promise.all([
            this.awardsCategoryRepository.find({
                where: { eventId },
                order: { order: "ASC" },
                relations: { suggestions: true },
            }),
            this.awardsVoteRepository.find({
                where: {
                    profileUserId: userId,
                    category: { eventId },
                },
            }),
        ]);

        const votesByCategory = new Map(
            votes.map((vote) => [vote.categoryId, Number(vote.gameId)]),
        );
        const nomineeIds = [
            ...new Set(
                categories.flatMap((category) =>
                    category.suggestions.map((suggestion) =>
                        Number(suggestion.gameId),
                    ),
                ),
            ),
        ];
        const playContext =
            await this.awardsPlayContextService.getUserPlayContext(
                userId,
                nomineeIds,
            );

        const hasPersonalCategory = categories.some(
            (category) => category.isPersonalGOTY,
        );
        const suggestedGameId = hasPersonalCategory
            ? await this.getPersonalGotySuggestion(userId, event)
            : null;

        return {
            eventId: event.id,
            year: event.year,
            phase: getAwardsPhase(event),
            categoriesVoted: votesByCategory.size,
            categoriesTotal: categories.length,
            categories: categories.map((category) => {
                const nominees = category.suggestions
                    .map((suggestion) => Number(suggestion.gameId))
                    .sort((a, b) => a - b)
                    .map((gameId) => ({
                        gameId,
                        ...(playContext.get(gameId) ?? {
                            status: "not_played" as const,
                            playtimeSeconds: 0,
                            rating: null,
                        }),
                    }));

                return {
                    id: category.id,
                    name: category.name,
                    description: category.description,
                    order: category.order,
                    isPersonalGOTY: category.isPersonalGOTY,
                    voteGameId: votesByCategory.get(category.id) ?? null,
                    playedNomineesCount: nominees.filter(
                        (nominee) => nominee.status === "played",
                    ).length,
                    nominees,
                    suggestedGameId: category.isPersonalGOTY
                        ? suggestedGameId
                        : null,
                };
            }),
        };
    }

    public async getVotesByUserId(
        eventId: number,
        userId: string,
    ): Promise<AwardsUserVoteDto[]> {
        const event = await this.awardsService.getEventById(eventId);
        if (event == null) {
            throw new HttpException(
                `No registered event for id ${eventId}.`,
                HttpStatus.NOT_FOUND,
            );
        }

        const votes = await this.awardsVoteRepository.find({
            where: {
                profileUserId: userId,
                category: { eventId },
            },
            relations: { category: true },
            order: { category: { order: "ASC" } },
        });

        return votes.map((vote) => ({
            categoryId: vote.categoryId,
            gameId: Number(vote.gameId),
        }));
    }

    /**
     * Highest rated game the user played in the event year, ties broken by
     * playtime in that year.
     */
    private async getPersonalGotySuggestion(
        userId: string,
        event: AwardsEvent,
    ): Promise<number | null> {
        const yearStart = new Date(Date.UTC(event.year, 0, 1));
        const nextYearStart = new Date(Date.UTC(event.year + 1, 0, 1));
        // The period estimate is inclusive at the end of the range.
        const yearEnd = new Date(nextYearStart.getTime() - 1);

        const [playtimeRows, entries] = await Promise.all([
            this.playtimeHistoryService.getTotalPlaytimeForPeriod({
                userId,
                startDate: yearStart,
                endDate: yearEnd,
            }),
            this.collectionEntryRepository
                .createQueryBuilder("ce")
                .select("ce.gameId", "gameId")
                .where("ce.libraryUserId = :userId", { userId })
                .andWhere(
                    "((ce.startedAt >= :start AND ce.startedAt < :end) OR (ce.finishedAt >= :start AND ce.finishedAt < :end))",
                    { start: yearStart, end: nextYearStart },
                )
                .getRawMany<{ gameId: number }>(),
        ]);

        const playtimeByGame = new Map<number, number>();
        for (const row of playtimeRows) {
            if (row.totalPlaytimeInPeriodSeconds <= 0) continue;
            playtimeByGame.set(
                row.gameId,
                (playtimeByGame.get(row.gameId) ?? 0) +
                    row.totalPlaytimeInPeriodSeconds,
            );
        }
        for (const entry of entries) {
            const gameId = Number(entry.gameId);
            if (!playtimeByGame.has(gameId)) playtimeByGame.set(gameId, 0);
        }
        if (playtimeByGame.size === 0) return null;

        const games = await this.gameRepository.findBy({
            id: In([...playtimeByGame.keys()]),
        });
        const eligibleGames = games.filter((game) =>
            isGameEligible(event, game),
        );
        if (eligibleGames.length === 0) return null;

        const playContext =
            await this.awardsPlayContextService.getUserPlayContext(
                userId,
                eligibleGames.map((game) => Number(game.id)),
            );

        const [best] = eligibleGames
            .map((game) => ({
                gameId: Number(game.id),
                rating: playContext.get(Number(game.id))?.rating ?? null,
                playtimeSeconds: playtimeByGame.get(Number(game.id)) ?? 0,
            }))
            .sort(
                (a, b) =>
                    (b.rating ?? -1) - (a.rating ?? -1) ||
                    b.playtimeSeconds - a.playtimeSeconds ||
                    a.gameId - b.gameId,
            );

        return best?.gameId ?? null;
    }
}
