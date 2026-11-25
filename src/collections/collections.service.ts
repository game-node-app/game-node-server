import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
import { NotificationsLifecycleService } from "../notifications/notifications-lifecycle.service";
import { BillingService } from "../billing/billing.service";
import { Library } from "../libraries/entities/library.entity";
import { LibraryAccessService } from "../libraries/library-access.service";
import { GuildQueueService } from "../guild/guild-queue/guild-queue.service";

const FREE_COLLECTION_LIMIT = 5;

@Injectable()
export class CollectionsService {
    private relations: FindOptionsRelations<Collection> = {
        library: true,
    };

    constructor(
        @InjectRepository(Collection)
        private collectionsRepository: Repository<Collection>,
        private readonly billingService: BillingService,
        @Optional()
        @Inject(NotificationsLifecycleService)
        private readonly notificationsLifecycleService:
            | NotificationsLifecycleService
            | undefined,
        private readonly libraryAccessService: LibraryAccessService,
        @Optional()
        private readonly guildQueueService?: GuildQueueService,
    ) {}

    async findOneById(id: string) {
        return this.collectionsRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
    }

    async findOneByIdWithPermissions(
        userId: string | undefined,
        collectionId: string,
    ) {
        const collection = await this.findOneById(collectionId);
        if (!collection) {
            throw new HttpException(
                "Collection not found.",
                HttpStatus.NOT_FOUND,
            );
        }
        const access = await this.libraryAccessService.resolve(
            userId,
            collection.libraryUserId,
        );
        if (
            collection.libraryUserId !== userId &&
            (!collection.isPublic || !access.canViewLibrary)
        ) {
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
        const access = await this.libraryAccessService.resolve(
            currentUserId,
            targetUserId,
        );
        if (!access.canViewLibrary) return [];

        const targetUserCollections = await this.collectionsRepository.find({
            where: {
                library: {
                    userId: targetUserId,
                },
            },
            relations: this.relations,
        });

        return targetUserCollections.filter((collection) => {
            return (
                collection.libraryUserId === currentUserId ||
                collection.isPublic
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
        await this.collectionsRepository.manager.transaction(
            async (manager) => {
                const userLibrary = await manager
                    .getRepository(Library)
                    .findOne({
                        where: { userId },
                        lock: { mode: "pessimistic_write" },
                    });
                if (!userLibrary)
                    throw new HttpException(
                        "No library found for the given ID.",
                        HttpStatus.NOT_FOUND,
                    );

                if (
                    createCollectionDto.isFeatured &&
                    !createCollectionDto.isPublic
                ) {
                    throw new HttpException(
                        "Featured collections must be public",
                        HttpStatus.BAD_REQUEST,
                    );
                }

                const repository = manager.getRepository(Collection);
                const count = await repository.count({
                    where: { libraryUserId: userId },
                });

                if (
                    count >= FREE_COLLECTION_LIMIT &&
                    !(await this.billingService.isSupporter(userId))
                ) {
                    throw new HttpException(
                        {
                            message: "Collection limit reached.",
                            code: "collection_limit_reached",
                            limit: FREE_COLLECTION_LIMIT,
                        },
                        HttpStatus.FORBIDDEN,
                    );
                }

                const collectionEntity = repository.create({
                    name: createCollectionDto.name,
                    description: createCollectionDto.description,
                    library: userLibrary,
                    libraryUserId: userLibrary.userId,
                    isPublic: createCollectionDto.isPublic,
                    isFeatured: createCollectionDto.isFeatured,
                    defaultEntryStatus: createCollectionDto.defaultEntryStatus,
                });

                await repository.save(collectionEntity);
            },
        );

        if (createCollectionDto.isPublic)
            this.guildQueueService?.enqueueEvaluation(userId, "collection");
    }

    async update(
        userId: string,
        collectionId: string,
        updateCollectionDto: UpdateCollectionDto,
    ) {
        const saved = await this.collectionsRepository.manager.transaction(
            async (manager) => {
                const repository = manager.getRepository(Collection);
                const collection = await repository.findOne({
                    where: { id: collectionId },
                    relations: { library: true },
                    lock: { mode: "pessimistic_write" },
                });
                if (!collection)
                    throw new HttpException(
                        "Collection not found.",
                        HttpStatus.NOT_FOUND,
                    );
                if (collection.libraryUserId !== userId)
                    throw new HttpException(
                        "User is not the owner of the library.",
                        HttpStatus.FORBIDDEN,
                    );
                const wasPublic = collection.isPublic;
                const isPrivate =
                    updateCollectionDto.isPublic === false ||
                    (updateCollectionDto.isPublic === undefined && !wasPublic);
                if (
                    isPrivate &&
                    (collection.isFeatured || updateCollectionDto.isFeatured)
                ) {
                    throw new HttpException(
                        "Featured collections must be public.",
                        HttpStatus.BAD_REQUEST,
                    );
                }
                const saved = await repository.save(
                    repository.merge(collection, updateCollectionDto),
                );
                if (wasPublic && !saved.isPublic)
                    await this.notificationsLifecycleService?.invalidateCollection(
                        collectionId,
                        manager,
                    );
                return saved;
            },
        );
        if (saved.isPublic)
            this.guildQueueService?.enqueueEvaluation(userId, "collection");
        return saved;
    }

    /**
     * Removes a collection.
     * @param userId
     * @param collectionId
     */
    async delete(userId: string, collectionId: string) {
        await this.collectionsRepository.manager.transaction(
            async (manager) => {
                const repository = manager.getRepository(Collection);
                const collection = await repository.findOne({
                    where: { libraryUserId: userId, id: collectionId },
                    lock: { mode: "pessimistic_write" },
                });
                if (!collection)
                    throw new HttpException(
                        "No collection found.",
                        HttpStatus.NOT_FOUND,
                    );
                await this.notificationsLifecycleService?.invalidateCollection(
                    collectionId,
                    manager,
                );
                await repository.delete({ id: collectionId });
            },
        );
    }
}
