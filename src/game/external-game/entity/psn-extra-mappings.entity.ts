import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { BaseEntity } from "../../../utils/db/base.entity";
import { GameExternalGame } from "./game-external-game.entity";

@Entity()
@Unique(["externalGame", "npCommunicationId", "npServiceName"])
export class PsnExtraMappings extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => GameExternalGame, (geg) => geg.psnExtraMappings, {
        onDelete: "CASCADE",
        nullable: false,
    })
    @JoinColumn({
        name: "externalGameId",
    })
    externalGame: GameExternalGame;
    @Column({
        nullable: false,
    })
    externalGameId: number;
    @Column({
        nullable: false,
    })
    npCommunicationId: string;
    /**
     * 'trophy' or 'trophy2'
     */
    @Column({
        nullable: false,
    })
    npServiceName: string;
}
