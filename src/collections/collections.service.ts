import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Library } from "../libraries/entities/library.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { Repository } from "typeorm";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { LibrariesService } from "../libraries/libraries.service";
import { IgdbService } from "../igdb/igdb.service";
import { CreateCollectionEntryDto } from "./dto/create-collectionEntry.dto";
import { GameMetadata } from "../utils/game-metadata.dto";
import { CollectionEntry } from "./entities/collectionEntry.entity";
import { UpdateCollectionDto } from "./dto/update-collection.dto";

function formatCollectionName(name: string) {
    if (!name) {
        return undefined;
    }
    if (name[0] === name[0].toUpperCase()) {
        return name;
    } else {
        return name[0].toUpperCase() + name.slice(1);
    }
}

@Injectable()
export class CollectionsService {
    constructor(
        @InjectRepository(Collection)
        private collectionsRepository: Repository<Collection>,
        @InjectRepository(CollectionEntry)
        private collectionEntriesRepository: Repository<CollectionEntry>,
        private readonly librariesService: LibrariesService,
        private readonly igdbService: IgdbService,
    ) {}

    async findOneById(id: string) {
        return this.collectionsRepository.findOne({
            where: {
                id,
            },
            relations: {
                entries: true,
                library: true,
            },
        });
    }

    async findOneEntryById(id: number) {
        return this.collectionEntriesRepository.findOne({
            where: {
                id,
            },
            relations: {
                collection: true,
            },
        });
    }

    async findOneEntryByIgdbId(igdbId: number) {
        return this.collectionEntriesRepository.findOne({
            where: {
                data: {
                    igdbId,
                },
            },
            relations: {
                collection: true,
            },
        });
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
        return collection;
    }

    async create(userId: string, createCollectionDto: CreateCollectionDto) {
        const userLibrary = await this.librariesService.findByUserId(userId);
        if (!userLibrary) {
            throw new HttpException(
                "User has no library defined.",
                HttpStatus.PRECONDITION_REQUIRED,
            );
        }
        const collectionEntity = this.collectionsRepository.create({
            name: formatCollectionName(createCollectionDto.name),
            description: createCollectionDto.description,
            library: userLibrary,
        });

        try {
            return await this.collectionsRepository.save(collectionEntity);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }

    async update(id: string, updateCollectionDto: UpdateCollectionDto) {
        const collection = await this.findOneByIdOrFail(id);
        const updatedCollection = this.collectionsRepository.create({
            ...collection,
            ...updateCollectionDto,
        });
        try {
            return this.collectionsRepository.save(updatedCollection);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }

    async createEntry(
        collectionId: string,
        createEntryDto: CreateCollectionEntryDto,
    ) {
        const collection = await this.findOneByIdOrFail(collectionId);
        const { igdbId } = createEntryDto;
        const games: GameMetadata[] = await this.igdbService.findByIdsOrFail({
            igdbIds: [igdbId],
        });

        const collectionEntryEntity = this.collectionEntriesRepository.create({
            igdbId: igdbId,
            data: games[0],
            collection,
        });
        try {
            return await this.collectionEntriesRepository.save(
                collectionEntryEntity,
            );
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }
}
