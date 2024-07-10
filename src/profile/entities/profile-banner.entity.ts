import {
    CreateDateColumn,
    Entity,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { PersistedImageDetails } from "../../utils/persisted-image-details.entity";
import { Profile } from "./profile.entity";

@Entity()
export class ProfileBanner extends PersistedImageDetails {
    @PrimaryGeneratedColumn()
    id: number;
    @OneToOne(() => Profile, (profile) => profile.avatar)
    profile: Profile;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
