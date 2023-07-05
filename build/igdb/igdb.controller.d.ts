import { IgdbService } from "./igdb.service";
import { FindIgdbDto } from "./dto/find-igdb.dto";
import { GameMetadata } from "../utils/game-metadata.dto";
import { FindIgdbIdDto } from "./dto/find-igdb-id.dto";
export declare class IgdbController {
    private readonly igdbService;
    constructor(igdbService: IgdbService);
    find(dto: FindIgdbDto): Promise<GameMetadata[]>;
    findByIds(dto: FindIgdbIdDto): Promise<GameMetadata[]>;
}
