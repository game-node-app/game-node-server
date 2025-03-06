import {
    CreateDateColumn,
    Entity,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "./profile.entity";
import { PersistedImageDetails } from "../../utils/db/persisted-image-details.entity";

@Entity()
export class ProfileAvatar extends PersistedImageDetails {
    @PrimaryGeneratedColumn()
    id: number;
    @OneToOne(() => Profile, (profile) => profile.avatar)
    profile: Profile;
}
