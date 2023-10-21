import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Library } from "./entities/library.entity";
import { FindOptionsRelations, Repository } from "typeorm";

@Injectable()
export class LibrariesService {
    private relations: FindOptionsRelations<Library> = {
        collections: {
            entries: true,
            library: false,
        },
    };
    constructor(
        @InjectRepository(Library)
        private libraryRepository: Repository<Library>,
    ) {}

    /**
     * The calling user is guaranteed to be the owner of the library by Supertokens Session at the controller level.
     *
     * This method should not be called from a controller. Use findOneByIdWithPermissions instead.
     * @param userId
     * @param handleUnitialized
     */
    async findOneById(
        userId: string,
        handleUnitialized = false,
    ): Promise<Library | null> {
        const library = await this.libraryRepository.findOne({
            where: {
                userId,
            },
            relations: this.relations,
        });

        if (!library && handleUnitialized) {
            await this.handleUninitializedLibrary(userId);
            return await this.findOneById(userId);
        }

        return library;
    }

    /**
     * Returns a Library with content that is accessible to the user (excludes non-public / non-own collections).
     *
     * If trying to get a user's own library, internally, prefer the findOneById method.
     * @param userId
     * @param targetId
     */
    async findOneByIdWithPermissions(userId: string, targetId: string) {
        const library = await this.findOneById(targetId);

        if (!library) {
            throw new HttpException("Library not found.", HttpStatus.NOT_FOUND);
        }

        const accessibleCollections = library.collections.filter(
            (collection) => {
                return (
                    collection.isPublic || collection.library.userId === userId
                );
            },
        );

        library.collections = accessibleCollections;

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
        await this.create(userId);
    }
}
