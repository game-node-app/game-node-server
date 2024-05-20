import { Column, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

/**
 * Base entity for all user comment related entities.
 * Should not have its own table, but rather serve as a
 * base for other entities.
 */
export abstract class UserComment {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    /**
     * HTML content of the user's comment.
     */
    @Column({
        nullable: false,
        type: "longtext",
    })
    content: string;

    /**
     * Author of this comment
     */
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    /**
     * User id of the author of this comment
     */
    @Column({
        nullable: false,
        type: "varchar",
        length: 36,
    })
    profileUserId: string;
}
