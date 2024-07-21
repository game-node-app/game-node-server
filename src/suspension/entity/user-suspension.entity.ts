import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

@Entity()
export class UserSuspension {
    @PrimaryGeneratedColumn()
    id: number;

    /**
     * Target of suspension/ban
     */
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;

    /**
     * Issuer of suspension/ban
     */
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    issuerProfile: Profile;
    @Column({
        nullable: false,
    })
    issuerProfileUserId: string;

    @Column({
        nullable: false,
        default: false,
    })
    isSuspension: boolean;
    @Column({
        nullable: false,
        default: true,
    })
    isBan: boolean;
    /**
     * When the suspension ends.
     * While 'isBan' entities can have this set, bans are permanent.
     */
    @Column({
        type: "timestamp",
    })
    endDate: Date;
}
