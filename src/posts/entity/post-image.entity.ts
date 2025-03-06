import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { PersistedImageDetails } from "../../utils/db/persisted-image-details.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { Post } from "./post.entity";

/**
 * User upload images that are attached to a post
 */
@Entity()
export class PostImage extends PersistedImageDetails {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => Profile, (profile) => profile.avatar)
    profile: Profile;
    @Column()
    profileUserId: string;
    @ManyToOne(() => Post, {
        nullable: true,
    })
    post: Post | null;
    @Column({
        nullable: true,
    })
    postId: string | null;
}
