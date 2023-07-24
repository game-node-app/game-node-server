import {
    HttpException,
    HttpStatus,
    Injectable,
    UseGuards,
} from "@nestjs/common";
import { CreateLibraryDto } from "./dto/create-library.dto";
import { UpdateLibraryDto } from "./dto/update-library.dto";
import { Session } from "../auth/session.decorator";
import { SessionContainer } from "supertokens-node/recipe/session";
import { AuthGuard } from "../auth/auth.guard";
import { InjectRepository } from "@nestjs/typeorm";
import { Library } from "./entities/library.entity";
import { FindOptionsRelations, Repository } from "typeorm";
import { Collection } from "../collections/entities/collection.entity";
import { DEFAULT_COLLECTIONS } from "../collections/collections.constants";

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
     * If fetching a user's own library, prefer this method over findOneByIdWithPermissions.
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
            await this.handleUnitializedLibrary(userId);
            return await this.findOneById(userId);
        }

        return library;
    }

    /**
     * Returns a Library with content that is accessible to the user (excludes non-public / non-own collections).
     *
     * If trying to get a user's own library, prefer the findOneById method.
     * @param userId
     * @param targetId
     */
    async findOneByIdWithPermissions(userId: string, targetId: string) {
        const library = await this.findOneById(targetId);

        if (!library) {
            throw new HttpException("Library not found.", HttpStatus.NOT_FOUND);
        }

        const acessibleCollections = library.collections.filter(
            (collection) => {
                return (
                    collection.isPublic || collection.library.userId === userId
                );
            },
        );

        library.collections = acessibleCollections;

        return library;
    }

    async create(userId: string) {
        const possibleLibrary = await this.libraryRepository.findOneBy({
            userId: userId,
        });

        if (possibleLibrary) {
            throw new HttpException(
                "User already has a library defined.",
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

    async handleUnitializedLibrary(userId: string) {
        await this.create(userId);
    }
}
