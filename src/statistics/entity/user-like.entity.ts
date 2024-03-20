import {
    Entity,
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
        onDelete: "CASCADE",
    })
    profile: Profile;
    @ManyToOne(() => Statistics, (s) => s.likes, {
        nullable: false,
        onDelete: "CASCADE",
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
