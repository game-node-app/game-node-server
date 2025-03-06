import { Entity, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import { PersistedImageDetails } from "../../utils/db/persisted-image-details.entity";
import { Profile } from "./profile.entity";

@Entity()
export class ProfileBanner extends PersistedImageDetails {
    @PrimaryGeneratedColumn()
    id: number;
    @OneToOne(() => Profile, (profile) => profile.avatar)
    profile: Profile;
}
