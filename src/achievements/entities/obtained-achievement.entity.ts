import { Entity, ManyToOne, PrimaryColumn } from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

/**
 * Entity to track a user's obtained achievements
 */
@Entity()
export class ObtainedAchievement {
    @PrimaryColumn()
    id: string;
    @ManyToOne(() => Profile)
    profile: Profile;
}
