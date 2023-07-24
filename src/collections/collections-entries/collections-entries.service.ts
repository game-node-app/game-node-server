import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { CollectionEntry } from "../entities/collectionEntry.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LibrariesService } from "../../libraries/libraries.service";
import { IgdbService } from "../../igdb/igdb.service";
import { CollectionsService } from "../collections.service";
import { CreateCollectionEntryDto } from "../dto/create-collectionEntry.dto";

@Injectable()
export class CollectionsEntriesService {
    constructor(
        @InjectRepository(CollectionEntry)
        private collectionEntriesRepository: Repository<CollectionEntry>,
        private collectionsService: CollectionsService,
        private readonly librariesService: LibrariesService,
        private readonly igdbService: IgdbService,
    ) {}

    async findOneByIgdbId(userId: string, igdbId: number) {
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
            relations: {
                collection: true,
            },
        });
    }

    async findOneByIgdbIdOrFail(userId: string, igdbId: number) {
        const entry = await this.findOneByIgdbId(userId, igdbId);
        if (!entry) {
            throw new HttpException(
                "Collection entry not found.",
                HttpStatus.NOT_FOUND,
            );
        }
        return entry;
    }

    async create(createEntryDto: CreateCollectionEntryDto) {
        const collection = await this.collectionsService.findOneByIdOrFail(
            createEntryDto.collectionId,
        );
        const { igdbId } = createEntryDto;

        const [games] = await this.igdbService.findByIdsOrFail({
            igdbIds: [igdbId],
        });

        const collectionEntryEntity = this.collectionEntriesRepository.create({
            igdbId: igdbId,
            data: games[0],
            collection,
        });

        try {
            await this.collectionEntriesRepository.save(collectionEntryEntity);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }
}
