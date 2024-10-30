import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Game } from "../../game-repository/entities/game.entity";
import { Profile } from "../../../profile/entities/profile.entity";

@Entity()
@Unique(["targetGameId"])
export class GameExclusion {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
    })
    targetGameId: number;
    @Column({
        nullable: false,
    })
    issuerUserId: string;
    @Column({
        nullable: false,
        default: true,
    })
    isActive: boolean;

    @ManyToOne(() => Game, { onDelete: "CASCADE", nullable: false })
    targetGame: Game;
    @ManyToOne(() => Profile, { onDelete: "CASCADE", nullable: false })
    issuer: Profile;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
