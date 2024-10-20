import {
    Column,
    CreateDateColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

/**
 * Base entity for all mention-related entities.
 * Remember to include UNIQUE constraints when extending.
 * @usage
 * ```typescript
 * @Entity()
 * @Unique(["mentionedProfile", "comment"])
 * export class CommentMention extends BaseMentionEntity {}
 * ```
 */
export abstract class BaseMentionEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    mentionedProfile: Profile;

    @Column()
    mentionedProfileUserId: string;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
