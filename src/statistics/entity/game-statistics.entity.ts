import {
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { UserLike } from "./user-like.entity";
import { UserView } from "./user-view.entity";

/**
 * Statistics for a single game
 *
 * Since IGDB games are not stored in our end, no relationship is needed.
 * The primary key is the IGDB id.
 */
@Entity()
export class GameStatistics {
    @PrimaryColumn()
    igdbId: number;
    @OneToMany(() => UserLike, (userLike) => userLike.gameStatistics)
    likes: UserLike[];
    @OneToMany(() => UserView, (userView) => userView.gameStatistics)
    views: UserView[];
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
