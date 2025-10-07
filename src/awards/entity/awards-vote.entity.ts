import { BaseEntity } from "../../utils/db/base.entity";
import {
    Column,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { AwardsCategory } from "./awards-category.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Profile } from "../../profile/entities/profile.entity";

@Entity()
@Unique(["category", "profile"])
export class AwardsVote extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => AwardsCategory, {
        nullable: false,
    })
    category: AwardsCategory;
    @Column({
        nullable: false,
    })
    categoryId: number;
    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Column({
        nullable: false,
    })
    gameId: number;
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;
}
