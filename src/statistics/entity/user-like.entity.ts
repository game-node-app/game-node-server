import { Column, Entity, ManyToOne, Unique } from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { StatisticsAction } from "./statistics-action.entity";

@Entity()
@Unique(["profile", "gameStatistics"])
@Unique(["profile", "reviewStatistics"])
@Unique(["profile", "activityStatistics"])
@Unique(["profile", "commentStatistics"])
@Unique(["profile", "postStatistics"])
export class UserLike extends StatisticsAction {
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
