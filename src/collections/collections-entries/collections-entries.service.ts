import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { InjectRepository } from "@nestjs/typeorm";
import {
    DeepPartial,
    FindOptionsRelations,
    In,
    Not,
    Repository,
} from "typeorm";
import { CollectionsService } from "../collections.service";
import { CreateCollectionEntryDto } from "./dto/create-collection-entry.dto";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { GetCollectionEntryDto } from "./dto/get-collection-entry.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";

@Injectable()
export class CollectionsEntriesService {
    private readonly relations: FindOptionsRelations<CollectionEntry> = {
        collection: true,
        review: true,
        game: true,
    };
    constructor(
        @InjectRepository(CollectionEntry)
        private collectionEntriesRepository: Repository<CollectionEntry>,
        private collectionsService: CollectionsService,
        private activitiesQueueService: ActivitiesQueueService,
    ) {}

    async findOneById(id: string) {
        return await this.collectionEntriesRepository.findOne({
            where: {
                id,
            },
        });
    }

    /**
     * This is mainly used to check if a given entry exists in a given user's library.
     * @param userId
     * @param gameId
     * @param dto
     */
    async findAllByUserIdAndGameId(
        userId: string,
        gameId: number,
        dto?: GetCollectionEntryDto,
    ) {
        return await this.collectionEntriesRepository.find({
            where: {
                collection: {
                    library: {
                        userId,
                    },
                },
                game: {
                    id: gameId,
                },
            },
            relations: dto?.relations,
        });
    }

    async findAllByUserIdAndGameIdOrFail(
        userId: string,
        gameId: number,
        dto?: GetCollectionEntryDto,
    ) {
        const entry = await this.findAllByUserIdAndGameId(userId, gameId, dto);
        if (!entry) {
            throw new HttpException(
                "Collection entry not found.",
                HttpStatus.NOT_FOUND,
            );
        }
        return entry;
    }

    async findAllByIdIn(
        collectionEntryIds: string[],
        dto?: GetCollectionEntryDto,
    ) {
        const findOptions = buildBaseFindOptions<CollectionEntry>(dto);
        return await this.collectionEntriesRepository.find({
            ...findOptions,
            where: {
                id: In(collectionEntryIds),
            },
        });
    }

    /**
     * Create or update a collection entry. If the game already exists for the given collection, it will be updated.
     * @param userId
     * @param createEntryDto
     */
    async createOrUpdate(
        userId: string,
        createEntryDto: CreateCollectionEntryDto,
    ) {
        const { collectionIds, gameId, platformIds, isFavorite } =
            createEntryDto;

        const queryBuilder =
            this.collectionEntriesRepository.createQueryBuilder();

        const entriesInOtherCollections =
            await this.collectionEntriesRepository.find({
                where: {
                    collection: {
                        id: Not(In(collectionIds)),
                        library: {
                            userId: userId,
                        },
                    },
                    game: {
                        id: gameId,
                    },
                },
                relations: {
                    ownedPlatforms: true,
                },
            });

        // Removes entry from other collections before proceeding
        for (const entry of entriesInOtherCollections) {
            await queryBuilder
                .relation(CollectionEntry, "ownedPlatforms")
                .of(entry)
                .remove(entry.ownedPlatforms);
            await this.collectionEntriesRepository.delete(entry.id);
        }

        for (const collectionId of collectionIds) {
            const entryInCollection =
                await this.collectionEntriesRepository.findOne({
                    where: {
                        collection: {
                            id: collectionId,
                        },
                        game: {
                            id: gameId,
                        },
                    },
                    relations: {
                        ownedPlatforms: true,
                    },
                });

            if (entryInCollection != undefined) {
                const updatedEntry = this.collectionEntriesRepository.merge(
                    entryInCollection,
                    {
                        game: {
                            id: gameId,
                        },
                        collection: {
                            id: collectionId,
                        },
                        isFavorite,
                    },
                );
                await this.collectionEntriesRepository.upsert(updatedEntry, [
                    "id",
                ]);

                // Removes previous platforms before adding the new ones
                await queryBuilder
                    .relation(CollectionEntry, "ownedPlatforms")
                    .of(entryInCollection)
                    .remove(entryInCollection.ownedPlatforms);
                await queryBuilder
                    .relation(CollectionEntry, "ownedPlatforms")
                    .of(updatedEntry)
                    .add(platformIds);

                return;
            }

            await this.collectionEntriesRepository.save({
                collection: {
                    id: collectionId,
                },
                game: {
                    id: gameId,
                },
                ownedPlatforms: platformIds.map((platformId) => ({
                    id: platformId,
                })),
            });
        }
    }

    /**
     * Should be called after the review has been created.
     * Should only be called from the ReviewsService.
     * @param userId
     * @param gameId
     * @param reviewId
     */
    async attachReview(userId: string, gameId: number, reviewId: string) {
        const entries = await this.findAllByUserIdAndGameIdOrFail(
            userId,
            gameId,
        );
        for (const entry of entries) {
            await this.collectionEntriesRepository
                .createQueryBuilder()
                .relation(CollectionEntry, "review")
                .of(entry)
                .set({
                    id: reviewId,
                });
        }
    }

    async changeFavoriteStatus(
        userId: string,
        gameId: number,
        isFavorite: boolean = false,
    ) {
        const entities = await this.findAllByUserIdAndGameIdOrFail(
            userId,
            gameId,
        );
        for (const entity of entities) {
            await this.collectionEntriesRepository.update(
                {
                    id: entity.id,
                },
                {
                    isFavorite,
                },
            );
        }
    }

    async deleteByUserIdAndGameId(userId: string, gameId: number) {
        const entities = await this.findAllByUserIdAndGameIdOrFail(
            userId,
            gameId,
            {
                relations: {
                    ownedPlatforms: true,
                },
            },
        );
        for (const entity of entities) {
            await this.collectionEntriesRepository
                .createQueryBuilder()
                .relation(CollectionEntry, "ownedPlatforms")
                .of(entity)
                .remove(entity.ownedPlatforms);
            await this.collectionEntriesRepository.delete(entity.id);
        }
    }
}
