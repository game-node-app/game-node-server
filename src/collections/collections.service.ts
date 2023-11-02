import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { FindOptionsRelations, Repository } from "typeorm";
import { CreateCollectionDto } from "./dto/create-collection.dto";
import { LibrariesService } from "../libraries/libraries.service";
import { UpdateCollectionDto } from "./dto/update-collection.dto";
import { GetCollectionEntriesDto } from "./collections-entries/dto/get-collection-entries.dto";

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

    async findOneById(id: string, dto?: GetCollectionEntriesDto) {
        return this.collectionsRepository.findOne({
            where: {
                id,
            },
            relations: dto?.relations,
        });
    }

    async findOneByIdWithPermissions(
        userId: string,
        collectionId: string,
        dto?: GetCollectionEntriesDto,
    ) {
        const collection = await this.collectionsRepository.findOne({
            where: {
                id: collectionId,
            },
            relations: dto?.relations,
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

    async update(id: string, updateCollectionDto: UpdateCollectionDto) {
        const collection = await this.findOneByIdOrFail(id);

        const updatedCollection = this.collectionsRepository.create({
            ...collection,
            ...updateCollectionDto,
        });

        try {
            return await this.collectionsRepository.save(updatedCollection);
        } catch (e) {
            console.error(e);
            throw new HttpException(e, 500);
        }
    }
}
