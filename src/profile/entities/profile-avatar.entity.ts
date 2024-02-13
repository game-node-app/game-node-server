import {
    Column,
    CreateDateColumn,
    Entity,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "./profile.entity";

@Entity()
export class ProfileAvatar {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({ nullable: false })
    mimetype: string;
    @Column({ nullable: false })
    extension: string;
    @Column({ nullable: false })
    size: number;
    @Column({ nullable: false })
    filename: string;
    @Column({ nullable: false })
    encoding: string;
    @OneToOne(() => Profile, (profile) => profile.avatar)
    profile: Profile;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
