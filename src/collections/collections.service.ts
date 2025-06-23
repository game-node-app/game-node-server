import {
    forwardRef,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { LibrariesService } from "../libraries/libraries.service";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
import { CollectionsEntriesService } from "./collections-entries/collections-entries.service";
import { AchievementsQueueService } from "../achievements/achievements-queue/achievements-queue.service";
import { AchievementCategory } from "../achievements/achievements.constants";

@Injectable()
export class CollectionsService {
    private relations: FindOptionsRelations<Collection> = {
        library: true,
    };

    constructor(
        @InjectRepository(Collection)
        private collectionsRepository: Repository<Collection>,
        private readonly librariesService: LibrariesService,
        @Inject(forwardRef(() => CollectionsEntriesService))
        private readonly collectionEntriesService: CollectionsEntriesService,
        private readonly achievementsQueueService: AchievementsQueueService,
    ) {}

    async findOneById(id: string) {
        return this.collectionsRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
    }

    async findOneByIdWithPermissions(userId: string, collectionId: string) {
        const collection = await this.collectionsRepository.findOne({
            where: [
                {
                    id: collectionId,
                    isPublic: true,
                },
                {
                    id: collectionId,
                    library: {
                        userId,
                    },
                },
            ],
            relations: this.relations,
        });
        if (!collection) {
            throw new HttpException(
                "Collection not found.",
                HttpStatus.NOT_FOUND,
            );
        }
        return collection;
    }

    async findAllByUserIdWithPermissions(
        currentUserId: string | undefined,
        targetUserId: string,
    ) {
        const targetUserCollections = await this.collectionsRepository.find({
            where: {
                library: {
                    userId: targetUserId,
                },
            },
            relations: this.relations,
        });
        if (!targetUserCollections) {
            throw new HttpException(
                "No collection found.",
                HttpStatus.NOT_FOUND,
            );
        }
        return targetUserCollections.filter((collection) => {
            return (
                collection.isPublic ||
                collection.library.userId === currentUserId
            );
        });
    }

    /**
     * Shorthand method that fails with a HttpException.
     * @param id {string}
     * @param relations
     */
    async findOneByIdOrFail(
        id: string,
        relations?: FindOptionsRelations<Collection>,
    ) {
        const collection = await this.collectionsRepository.findOne({
            where: {
                id: id,
            },
            relations: relations ? relations : this.relations,
        });
        if (!collection) {
            throw new HttpException(
                "Collection not found.",
                HttpStatus.NOT_FOUND,
            );
        }
        return collection;
    }

    async findAllByIds(ids: string[]) {
        return this.collectionsRepository.find({
            where: {
                id: In(ids),
            },
        });
    }

    async create(userId: string, createCollectionDto: CreateCollectionDto) {
        const userLibrary =
            await this.librariesService.findOneByIdOrFail(userId);

        if (createCollectionDto.isFeatured && !createCollectionDto.isPublic) {
            throw new HttpException(
                "Featured collections must be public",
                HttpStatus.BAD_REQUEST,
            );
        }

        const collectionEntity = this.collectionsRepository.create({
            name: createCollectionDto.name,
            description: createCollectionDto.description,
            library: userLibrary,
            libraryUserId: userLibrary.userId,
            isPublic: createCollectionDto.isPublic,
            isFeatured: createCollectionDto.isFeatured,
            defaultEntryStatus: createCollectionDto.defaultEntryStatus,
        });

        await this.collectionsRepository.save(collectionEntity);

        this.achievementsQueueService.addTrackingJob({
            targetUserId: userId,
            category: AchievementCategory.COLLECTIONS,
        });
    }

    async update(
        userId: string,
        collectionId: string,
        updateCollectionDto: UpdateCollectionDto,
    ) {
        const collection = await this.findOneByIdOrFail(collectionId, {
            library: true,
        });

        if (collection.libraryUserId !== userId) {
            throw new HttpException(
                "User is not the owner of the library.",
                HttpStatus.FORBIDDEN,
            );
        }

        const privateCollectionRequest =
            !collection.isPublic ||
            (updateCollectionDto.isPublic != undefined &&
                !updateCollectionDto.isPublic);

        if (privateCollectionRequest) {
            if (collection.isFeatured || updateCollectionDto.isFeatured) {
                throw new HttpException(
                    "Featured collections must be public.",
                    HttpStatus.BAD_REQUEST,
                );
            }
        }

        const updatedCollection = this.collectionsRepository.merge(
            collection,
            updateCollectionDto,
        );

        return await this.collectionsRepository.save({
            ...updatedCollection,
            id: collection.id,
        });
    }

    /**
     * Removes a collection.
     * @param userId
     * @param collectionId
     */
    async delete(userId: string, collectionId: string) {
        const collection = await this.collectionsRepository.findOne({
            where: {
                libraryUserId: userId,
                id: collectionId,
            },
        });
        if (!collection) {
            throw new HttpException(
                "No collection found.",
                HttpStatus.NOT_FOUND,
            );
        }
        await this.collectionsRepository.delete({
            id: collection.id,
        });
        await this.collectionEntriesService.deleteDandling();
    }
}
