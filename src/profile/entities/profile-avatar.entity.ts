import { Entity, OneToOne } from "typeorm";
import { PersistedImageDetails } from "../../utils/db/persisted-image-details.entity";
import { Profile } from "./profile.entity";

@Entity()
export class ProfileAvatar extends PersistedImageDetails {
    @OneToOne(() => Profile, (profile) => profile.avatar)
    profile: Profile;
}
