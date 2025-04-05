import { Entity, OneToOne } from "typeorm";
import { PersistedImageDetails } from "../../utils/db/persisted-image-details.entity";
import { Profile } from "./profile.entity";

@Entity()
export class ProfileBanner extends PersistedImageDetails {
    @OneToOne(() => Profile, (profile) => profile.banner)
    profile: Profile;
}
