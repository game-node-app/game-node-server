import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { FindOptionsRelations, Repository } from "typeorm";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { LibrariesService } from "../libraries/libraries.service";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
import { CollectionsEntriesService } from "./collections-entries/collections-entries.service";

@Injectable()
export class CollectionsService {
    private relations: FindOptionsRelations<Collection> = {
        entries: true,
        library: true,
    };

    constructor(
        @InjectRepository(Collection)
        private collectionsRepository: Repository<Collection>,
        private readonly librariesService: LibrariesService,
        private readonly collectionEntriesService: CollectionsEntriesService,
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
     * @param dto
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

    async create(userId: string, createCollectionDto: CreateCollectionDto) {
        const userLibrary = await this.librariesService.findOneById(userId);
        if (!userLibrary) {
            throw new HttpException(
                "User has no library defined.",
                HttpStatus.PRECONDITION_REQUIRED,
            );
        }

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
            isPublic: createCollectionDto.isPublic,
            isFeatured: createCollectionDto.isFeatured,
        });

        try {
            return await this.collectionsRepository.save(collectionEntity);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }

    async update(
        userId: string,
        collectionId: string,
        updateCollectionDto: UpdateCollectionDto,
    ) {
        const collection = await this.findOneByIdOrFail(collectionId, {
            library: true,
        });

        if (collection.library.userId !== userId) {
            throw new HttpException(
                "User is not the owner of the library.",
                HttpStatus.NOT_ACCEPTABLE,
            );
        }

        const updatedCollection = this.collectionsRepository.merge(
            collection,
            updateCollectionDto,
        );

        try {
            return await this.collectionsRepository.save({
                ...updatedCollection,
                id: collection.id,
            });
        } catch (e) {
            console.error(e);
            throw new HttpException(e, 500);
        }
    }

    /**
     * Removes a collection and it's entities.
     * @param userId
     * @param collectionId
     */
    async delete(userId: string, collectionId: string) {
        const collection = await this.collectionsRepository.findOne({
            where: {
                library: {
                    userId,
                },
                id: collectionId,
            },
            relations: {
                entries: {
                    collections: true,
                },
            },
        });
        if (!collection) {
            throw new HttpException(
                "No collection found.",
                HttpStatus.NOT_FOUND,
            );
        }

        const queryBuilder = this.collectionsRepository.createQueryBuilder();
        // Detaches entries from this collection
        await queryBuilder
            .relation(Collection, "entries")
            .of(collection)
            .remove(collection.entries);

        if (collection.entries.length > 0) {
            // Only delete entries that are only in this collection
            const entriesToRemove = collection.entries.filter(
                (entry) => entry.collections && entry.collections.length <= 1,
            );
            for (const collectionEntry of entriesToRemove) {
                try {
                    await this.collectionEntriesService.delete(
                        userId,
                        collectionEntry.id,
                        true,
                    );
                } catch (e) {
                    console.error(e);
                }
            }
        }

        await this.collectionsRepository.delete({
            id: collection.id,
        });
    }
}
