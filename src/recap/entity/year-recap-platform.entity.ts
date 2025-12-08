import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { YearRecap } from "./year-recap.entity";
import { GamePlatform } from "../../game/game-repository/entities/game-platform.entity";

@Entity()
export class YearRecapPlatform {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => YearRecap, (recap) => recap.platforms, {
        onDelete: "CASCADE",
    })
    recap: YearRecap;
    @Column({
        nullable: false,
    })
    recapId: number;
    @ManyToOne(() => GamePlatform, { nullable: false })
    platform: GamePlatform;
    @Column({
        nullable: false,
    })
    platformId: number;
    @Column({
        nullable: false,
        default: 0,
    })
    totalGames: number;
}
