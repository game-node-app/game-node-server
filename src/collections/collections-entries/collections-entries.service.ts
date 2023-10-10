import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { CollectionEntry } from "../entities/collection-entry.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsRelations, In, Repository } from "typeorm";
import { CollectionsService } from "../collections.service";
import { CreateCollectionEntryDto } from "../dto/create-collectionEntry.dto";
import { UpdateCollectionEntryDto } from "../dto/update-collectionEntry.dto";

@Injectable()
export class CollectionsEntriesService {
    private readonly relations: FindOptionsRelations<CollectionEntry> = {
        collection: true,
        review: true,
    };
    constructor(
        @InjectRepository(CollectionEntry)
        private collectionEntriesRepository: Repository<CollectionEntry>,
        private collectionsService: CollectionsService,
    ) {}

    /**
     * This is mainly used to check if a given entry exists in a given user's library.
     * @param userId
     * @param igdbId
     */
    async findOneByUserIdAndIgdbId(userId: string, igdbId: number) {
        return await this.collectionEntriesRepository.findOne({
            // Where igdbId (entry id) === igdbId (param) and libraryId (which is the Supertokens userId) === userId
            where: {
                igdbId,
                collection: {
                    library: {
                        userId,
                    },
                },
            },
            relations: this.relations,
        });
    }

    async findOneByUserIdAndIgdbIdOrFail(userId: string, igdbId: number) {
        const entry = await this.findOneByUserIdAndIgdbId(userId, igdbId);
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
        const { igdbId } = createEntryDto;

        const collectionEntryEntity = this.collectionEntriesRepository.create({
            igdbId: igdbId,
            // TODO: Reimplement with Games
            // data: games[0],
            collection,
            dataSources: createEntryDto.dataSources,
        });

        try {
            await this.collectionEntriesRepository.save(collectionEntryEntity);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }

    async update(
        userId: string,
        igdbId: number,
        updateEntryDto: UpdateCollectionEntryDto,
    ) {
        const entry = await this.findOneByUserIdAndIgdbIdOrFail(userId, igdbId);
        const updatedEntry = this.collectionEntriesRepository.merge(
            entry,
            updateEntryDto,
        );

        await this.collectionEntriesRepository.save(updatedEntry);
    }
}
