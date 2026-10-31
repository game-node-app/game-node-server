import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { AchievementStatus } from "../achievements.constants";

/**
 * A named time window grouping achievement definitions (e.g. a seasonal event).
 * Definitions linked to an event only count facts inside its window.
 */
@Entity()
export class AchievementEvent {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    @Column({ length: 64, unique: true })
    slug: string;
    @Column({ length: 100 })
    name: string;
    @Column({ length: 500 })
    description: string;
    @Column({ type: "datetime" })
    startsAt: Date;
    @Column({ type: "datetime" })
    endsAt: Date;
    @Column({ type: "varchar", length: 16, default: AchievementStatus.DRAFT })
    status: AchievementStatus;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
