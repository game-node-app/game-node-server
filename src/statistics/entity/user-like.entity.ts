import {
    Entity,
    Column,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    CreateDateColumn,
    UpdateDateColumn,
} from "typeorm";
import { Statistics } from "./statistics.entity";
import { Profile } from "../../profile/entities/profile.entity";

@Entity()
@Unique(["profile", "statistics"])
export class UserLike {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => Profile, {
        nullable: false,
    })
    profile: Profile;
    @ManyToOne(() => Statistics, (s) => s.likes, {
        nullable: false,
    })
    statistics: Statistics;
    @CreateDateColumn({
        type: "timestamp",
    })
    createdAt: Date;
    @UpdateDateColumn({
        type: "timestamp",
    })
    updatedAt: Date;
}
