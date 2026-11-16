import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { AwardsCategory } from "./awards-category.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Profile } from "../../profile/entities/profile.entity";

/**
 * One game a user nominated in a category during the nominations phase.
 */
@Entity()
@Unique("UQ_awards_nomination_category_profile_game", [
    "category",
    "profile",
    "game",
])
export class AwardsNomination {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => AwardsCategory, {
        nullable: false,
        onDelete: "CASCADE",
    })
    category: AwardsCategory;
    @Column({
        nullable: false,
        type: "int",
    })
    categoryId: number;
    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Column({
        nullable: false,
        type: "bigint",
    })
    gameId: number;
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
        type: "varchar",
        length: 36,
    })
    profileUserId: string;
    @CreateDateColumn()
    createdAt: Date;
}
