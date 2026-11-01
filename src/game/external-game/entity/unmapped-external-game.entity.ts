import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";
import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";

/**
 * Represents a external game that has not been matched internally.
 * Usually by the importer or playtime-watch services.
 */
@Entity()
@Unique(["sourceUid", "category"])
export class UnmappedExternalGame {
    @PrimaryGeneratedColumn()
    id: number;
    // The game's id in the source
    // Equivalent to GameExternalGame's uid.
    @Column({
        nullable: false,
    })
    sourceUid: string;
    @Column({
        nullable: false,
    })
    category: EGameExternalGameCategory;
    @Column({
        nullable: false,
        default: true,
    })
    isActive: boolean;
    // The game's name as the provider reports it. Null when the provider reports none.
    @Column("varchar", { length: 255, nullable: true })
    name: string | null;
}
