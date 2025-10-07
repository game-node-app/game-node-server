import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { DEFAULT_TENANT_ID } from "../../auth/auth.constants";

@Entity()
export class UserSuspension {
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * Supertokens UserId (same as Profile and Library's PK), but will remain active when the user is deleted.
     */
    @Column({
        nullable: false,
    })
    userId: string;
    @Column({
        nullable: false,
        default: DEFAULT_TENANT_ID,
    })
    tenantId: string;
    /**
     * User who issued the suspension/ban.
     */
    @Column({
        nullable: false,
    })
    issuerUserId: string;
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
