import { Collection } from "./collection.entity";
import { GameMetadata } from "../../utils/game-metadata.dto";
export declare class CollectionEntry {
    id: number;
    data: GameMetadata;
    collection: Collection;
}
