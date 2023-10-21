import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { FindOptionsRelations, Repository } from "typeorm";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { LibrariesService } from "../libraries/libraries.service";
import { CollectionEntry } from "./collections-entries/entities/collection-entry.entity";
import { UpdateCollectionDto } from "./dto/update-collection.dto";

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
    ) {}

    async findOneById(id: string) {
        return this.collectionsRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
    }

    async findOneByIdWithPermissions(userId: string, targetUserId: string) {
        const collection = await this.collectionsRepository.findOne({
            where: {
                id: targetUserId,
            },
            relations: {
                entries: true,
                library: true,
            },
        });
        if (!collection) {
            throw new HttpException(
                "Collection not found.",
                HttpStatus.NOT_FOUND,
            );
        }

        if (collection.library.userId !== userId && !collection.isPublic) {
            throw new HttpException(
                "Collection is not accessible.",
                HttpStatus.FORBIDDEN,
            );
        }
        return collection;
    }

    async findFavoritesCollection(userId: string) {
        const favoritesCollection = await this.collectionsRepository.findOne({
            where: {
                library: {
                    userId: userId,
                },
                isFavoritesCollection: true,
            },
            relations: this.relations,
        });

        if (!favoritesCollection) {
            throw new HttpException(
                "User has no favorites collection.",
                HttpStatus.NOT_FOUND,
            );
        }

        return favoritesCollection;
    }

    /**
     * Shorthand method that fails with a HttpException.
     * @param id {string}
     */
    async findOneByIdOrFail(id: string) {
        const collection = await this.collectionsRepository.findOne({
            where: {
                id,
            },
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

    async create(userId: string, createCollectionDto: CreateCollectionDto) {
        const userLibrary = await this.librariesService.findOneById(
            userId,
            true,
        );
        if (!userLibrary) {
            throw new HttpException(
                "User has no library defined.",
                HttpStatus.PRECONDITION_REQUIRED,
            );
        }
        const collectionEntity = this.collectionsRepository.create({
            name: createCollectionDto.name,
            description: createCollectionDto.description,
            library: userLibrary,
            isPublic: createCollectionDto.isPublic,
            isFavoritesCollection: createCollectionDto.isFavoritesCollection,
        });

        if (collectionEntity.isFavoritesCollection) {
            const possibleFavoriteCollection =
                await this.collectionsRepository.findOne({
                    where: {
                        library: {
                            userId: userId,
                        },
                        isFavoritesCollection: true,
                    },
                });
            if (possibleFavoriteCollection) {
                throw new HttpException(
                    "User already has a favourite collection.",
                    HttpStatus.CONFLICT,
                );
            }
        }

        try {
            return await this.collectionsRepository.save(collectionEntity);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }

    async update(id: string, updateCollectionDto: UpdateCollectionDto) {
        const collection = await this.findOneByIdOrFail(id);
        const libraryId = collection.library.userId;

        const updatedCollection = this.collectionsRepository.create({
            ...collection,
            ...updateCollectionDto,
        });

        if (updatedCollection.isFavoritesCollection) {
            const possibleFavouriteCollection =
                await this.collectionsRepository.findOne({
                    where: {
                        library: {
                            userId: libraryId,
                        },
                        isFavoritesCollection: true,
                    },
                });
            if (possibleFavouriteCollection) {
                throw new HttpException(
                    "User already has a favourite collection.",
                    HttpStatus.CONFLICT,
                );
            }
        }

        try {
            return await this.collectionsRepository.save(updatedCollection);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }
}
