import {
    Column,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { EConnectionType } from "../connections.constants";
import { Profile } from "../../profile/entities/profile.entity";

@Entity()
@Unique(["profile", "type"])
export class UserConnection {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
    })
    type: EConnectionType;
    @ManyToOne(() => Profile, {
        nullable: false,
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;

    @Column({
        nullable: false,
    })
    sourceUserId: string;
    @Column({
        nullable: false,
    })
    sourceUsername: string;
    @Column({
        nullable: false,
        default: false,
    })
    isImporterEnabled: boolean;
}
