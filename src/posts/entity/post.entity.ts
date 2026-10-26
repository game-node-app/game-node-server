import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { StatisticsTarget } from "../../statistics/entity/statistics-target.entity";

@Entity()
// Include id to avoid "tie-breaker" issues in pagination
// SELECT * FROM post ORDER BY createdAt DESC LIMIT 20;
@Index(["createdAt", "id"])
// SELECT * FROM post WHERE profileUserId = 'user123' ORDER BY createdAt DESC LIMIT 20;
@Index(["profileUserId", "createdAt"])
// SELECT * FROM post WHERE gameId = 1942 ORDER BY createdAt DESC LIMIT 20;
@Index(["gameId", "createdAt"])
@Index("UQ_post_statistics_target", ["statisticsTargetId"], { unique: true })
export class Post extends BaseEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    /**
     * The post HTML content
     */
    @Column({
        nullable: false,
        type: "longtext",
    })
    content: string;

    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column()
    profileUserId: string;

    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Column()
    gameId: number;

    @OneToOne(() => StatisticsTarget, { nullable: true, onDelete: "RESTRICT" })
    @JoinColumn({ name: "statisticsTargetId" })
    statisticsTarget: StatisticsTarget | null;
    @Column({ type: "bigint", unsigned: true, nullable: true })
    statisticsTargetId: number | null;
}
