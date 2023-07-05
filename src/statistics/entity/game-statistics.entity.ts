import { Entity, OneToMany, PrimaryColumn } from "typeorm";
import { UserLike } from "./user-like.entity";

@Entity()
export class GameStatistics {
    @PrimaryColumn()
    igdbId: number;
    @OneToMany(() => UserLike, (userLike) => userLike.gameStatistics)
    likes: UserLike[];
}
