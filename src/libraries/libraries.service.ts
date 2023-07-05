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

    async findByUserId(userId: string) {
        return this.libraryRepository.findOne({
            where: {
                userId,
            },
            relations: this.relations,
        });
    }

    async findById(id: string) {
        return this.libraryRepository.findOne({
            where: {
                id,
            },
            relations: this.relations,
        });
    }

    async create(userId: string) {
        const possibleLibrary = await this.libraryRepository.findOneBy({
            userId,
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
            return await this.libraryRepository.save(createdLibrary);
        } catch (e) {
            throw new HttpException(e, 500);
        }
    }
}
