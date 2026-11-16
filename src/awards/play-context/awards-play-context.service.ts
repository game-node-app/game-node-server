import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { UserPlaytime } from "../../playtime/entity/user-playtime.entity";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import { Review } from "../../reviews/entities/review.entity";

export type AwardsPlayStatus = "played" | "planned" | "not_played";

export interface AwardsPlayContextEntry {
    status: AwardsPlayStatus;
    playtimeSeconds: number;
    rating: number | null;
}

const PLAYED_STATUSES: CollectionEntryStatus[] = [
    CollectionEntryStatus.PLAYING,
    CollectionEntryStatus.FINISHED,
    CollectionEntryStatus.DROPPED,
];

@Injectable()
export class AwardsPlayContextService {
    constructor(
        @InjectRepository(UserPlaytime)
        private readonly userPlaytimeRepository: Repository<UserPlaytime>,
        @InjectRepository(CollectionEntry)
        private readonly collectionEntryRepository: Repository<CollectionEntry>,
        @InjectRepository(Review)
        private readonly reviewRepository: Repository<Review>,
    ) {}

    /**
     * Played status, recorded playtime and rating for each requested game.
     * Shared by the ballot, the scoreboard and the Recap community highlights.
     */
    public async getUserPlayContext(
        userId: string,
        gameIds: number[],
    ): Promise<Map<number, AwardsPlayContextEntry>> {
        const ids = [...new Set(gameIds)];
        const context = new Map<number, AwardsPlayContextEntry>(
            ids.map((gameId) => [
                gameId,
                { status: "not_played", playtimeSeconds: 0, rating: null },
            ]),
        );
        if (ids.length === 0) return context;

        const [playtimes, entries, reviews] = await Promise.all([
            this.userPlaytimeRepository
                .createQueryBuilder("up")
                .select("up.gameId", "gameId")
                .addSelect("SUM(up.totalPlaytimeSeconds)", "seconds")
                .where("up.profileUserId = :userId", { userId })
                .andWhere("up.gameId IN (:...gameIds)", { gameIds: ids })
                .groupBy("up.gameId")
                .getRawMany<{ gameId: number; seconds: string }>(),
            this.collectionEntryRepository.find({
                select: {
                    gameId: true,
                    status: true,
                    startedAt: true,
                    finishedAt: true,
                },
                where: { libraryUserId: userId, gameId: In(ids) },
            }),
            this.reviewRepository.find({
                select: { gameId: true, rating: true },
                where: { profileUserId: userId, gameId: In(ids) },
            }),
        ]);

        for (const { gameId, seconds } of playtimes) {
            const entry = context.get(Number(gameId));
            if (!entry) continue;
            entry.playtimeSeconds = Number(seconds);
            if (entry.playtimeSeconds > 0) entry.status = "played";
        }

        for (const entry of entries) {
            const contextEntry = context.get(Number(entry.gameId));
            if (!contextEntry) continue;
            const played =
                contextEntry.playtimeSeconds > 0 ||
                PLAYED_STATUSES.includes(entry.status) ||
                entry.startedAt != null ||
                entry.finishedAt != null;
            if (played) {
                contextEntry.status = "played";
            } else if (contextEntry.status !== "played") {
                contextEntry.status = "planned";
            }
        }

        for (const review of reviews) {
            const contextEntry = context.get(Number(review.gameId));
            if (contextEntry) contextEntry.rating = review.rating;
        }

        return context;
    }
}
