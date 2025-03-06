import { Column, Entity, ManyToOne } from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { StatisticsAction } from "./statistics-action.entity";

/**
 * While it's called UserView, it also contains anonymous views (profile is set to null).
 */
@Entity()
export class UserView extends StatisticsAction {
    @ManyToOne(() => Profile, {
        nullable: true,
        onDelete: "CASCADE",
    })
    profile: Profile | null;
    @Column({
        nullable: true,
    })
    profileUserId: string | null;
}
