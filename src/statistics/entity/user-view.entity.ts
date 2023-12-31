import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { Statistics } from "./statistics.entity";

/**
 * While it's called UserView, it also contains anonymous views (profile is set to null).
 */
@Entity()
export class UserView {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Profile, {
        nullable: true,
    })
    profile?: Profile;
    @ManyToOne(() => Statistics, (s) => s.views, {
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
