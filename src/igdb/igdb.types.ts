import { GameMetadata } from "../utils/game-metadata.dto";

export interface IGDBResponse {
    [key: string]: any;

    data: GameMetadata[];
}
