import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { DeepPartial, FindOptionsRelations, In, Repository } from "typeorm";
import { CollectionsService } from "../collections.service";
import { CreateCollectionEntryDto } from "./dto/create-collectionEntry.dto";
import { UpdateCollectionEntryDto } from "./dto/update-collectionEntry.dto";
import { GamePlatform } from "../../game/game-repository/entities/game-platform.entity";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";

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

    /**
     * This is mainly used to check if a given entry exists in a given user's library.
     * @param userId
     * @param gameId
     */
    async findOneByUserIdAndGameId(userId: string, gameId: number) {
        return await this.collectionEntriesRepository.findOne({
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
            relations: this.relations,
        });
    }

    async findOneByUserIdAndGameIdOrFail(userId: string, gameId: number) {
        const entry = await this.findOneByUserIdAndGameId(userId, gameId);
        if (!entry) {
            throw new HttpException(
                "Collection entry not found.",
                HttpStatus.NOT_FOUND,
            );
        }
        return entry;
    }

    async findAllByIdIn(collectionEntryIds: string[]) {
        return await this.collectionEntriesRepository.find({
            where: {
                id: In(collectionEntryIds),
            },
        });
    }

    async create(createEntryDto: CreateCollectionEntryDto) {
        const collection = await this.collectionsService.findOneByIdOrFail(
            createEntryDto.collectionId,
        );

        const { gameId, platformIds } = createEntryDto;

        if (platformIds == undefined || platformIds.length === 0) {
            throw new HttpException(
                "At least one platform ID must be provided.",
                HttpStatus.BAD_REQUEST,
            );
        }

        const entry = this.collectionEntriesRepository.create({
            collection,
            // This pattern is only possible while using .save().
            game: {
                id: gameId,
            },
            ownedPlatforms: platformIds.map((platformId) => ({
                id: platformId,
            })),
        });

        await this.collectionEntriesRepository.save(entry);
    }

    /**
     * Should be called after the review has been created.
     * Should only be called from the ReviewsService.
     * @param userId
     * @param gameId
     * @param reviewId
     */
    async attachReview(userId: string, gameId: number, reviewId: string) {
        const entry = await this.findOneByUserIdAndGameIdOrFail(userId, gameId);
        const updatedEntry = this.collectionEntriesRepository.create({
            ...entry,
            review: {
                id: reviewId,
            },
            reviewId,
        });

        await this.collectionEntriesRepository.save(updatedEntry);
    }

    async update(
        userId: string,
        igdbId: number,
        updateEntryDto: UpdateCollectionEntryDto,
    ) {
        const entry = await this.findOneByUserIdAndGameIdOrFail(userId, igdbId);
        let ownedPlatforms: DeepPartial<GamePlatform>[] = entry.ownedPlatforms;
        if (updateEntryDto.platformIds) {
            ownedPlatforms = updateEntryDto.platformIds.map((platformId) => ({
                id: platformId,
            }));
        }
        const updatedEntry = this.collectionEntriesRepository.create({
            ...entry,
            ownedPlatforms: ownedPlatforms,
        });

        await this.collectionEntriesRepository.save(updatedEntry);
    }
}
