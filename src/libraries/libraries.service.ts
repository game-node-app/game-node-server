import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Library } from "./entities/library.entity";
import { FindOptionsRelations, Repository } from "typeorm";
import { FindCollectionEntriesDto } from "../collections/collections-entries/dto/find-collection-entries.dto";
import { GetLibraryDto } from "./dto/get-library.dto";

@Injectable()
export class LibrariesService {
    constructor(
        @InjectRepository(Library)
        private libraryRepository: Repository<Library>,
    ) {}

    /**
     * The calling user is guaranteed to be the owner of the library by Supertokens Session at the controller level.
     *
     * This method should not be called from a controller. Use findOneByIdWithPermissions instead.
     * @param userId
     * @param handleUninitialized
     * @param relations
     */
    async findOneById(
        userId: string,
        handleUninitialized = false,
        relations?: FindOptionsRelations<Library>,
    ): Promise<Library | null> {
        const library = await this.libraryRepository.findOne({
            where: {
                userId,
            },
            relations: relations,
        });

        if (!library && handleUninitialized) {
            await this.handleUninitializedLibrary(userId);
            return await this.findOneById(userId, false, relations);
        }

        return library;
    }

    async findOneByIdOrFail(
        userId: string,
        relations?: FindOptionsRelations<Library>,
    ) {
        const library = await this.findOneById(userId, false, relations);
        if (!library) {
            throw new HttpException(
                "No library found for the given ID.",
                HttpStatus.NOT_FOUND,
            );
        }
        return library;
    }

    /**
     * Returns a Library with content that is accessible to the user (excludes non-public / non-own collections).
     *
     * If trying to get a user's own library, internally, prefer the findOneById method.
     * @param userId
     * @param targetUserId
     * @param handleUninitialized
     */
    async findOneByIdWithPermissions(
        userId: string | undefined,
        targetUserId: string,
        handleUninitialized = false,
    ) {
        const library = await this.findOneById(
            targetUserId,
            handleUninitialized,
            {
                collections: {
                    library: true,
                },
            },
        );

        if (!library) {
            throw new HttpException("Library not found.", HttpStatus.NOT_FOUND);
        }

        if (library.collections) {
            library.collections = library.collections.filter((collection) => {
                return (
                    collection.isPublic || collection.library.userId === userId
                );
            });
        }

        return library;
    }

    async create(userId: string) {
        const possibleLibrary = await this.libraryRepository.findOneBy({
            userId: userId,
        });

        if (possibleLibrary) {
            throw new HttpException(
                "User already has a library.",
                HttpStatus.BAD_REQUEST,
            );
        }

        const createdLibrary = this.libraryRepository.create({
            userId: userId,
        });
        try {
            await this.libraryRepository.save(createdLibrary);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }

    async handleUninitializedLibrary(userId: string) {
        console.log("Handling initialized user: ", userId);
        await this.create(userId);
    }
}
