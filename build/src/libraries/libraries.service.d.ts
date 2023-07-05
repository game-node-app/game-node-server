import { Library } from "./entities/library.entity";
import { Repository } from "typeorm";
export declare class LibrariesService {
    private libraryRepository;
    private relations;
    constructor(libraryRepository: Repository<Library>);
    findByUserId(userId: string): Promise<Library | null>;
    findById(id: string): Promise<Library | null>;
    create(userId: string): Promise<Library>;
}
