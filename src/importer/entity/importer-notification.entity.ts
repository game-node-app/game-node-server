import {
    Column,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { Library } from "../../libraries/entities/library.entity";
import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
import { EImporterSource } from "../importer.constants";

@Entity()
export class ImporterWatchNotification {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Library, {
        nullable: false,
    })
    library: Library;
    @Column({
        nullable: false,
    })
    libraryUserId: string;

    @Column({
        nullable: false,
    })
    source: EImporterSource;

    @ManyToMany(() => GameExternalGame, {
        nullable: true,
    })
    @JoinTable()
    games: GameExternalGame[] | null;
}
