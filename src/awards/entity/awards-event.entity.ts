import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { AwardsCategory } from "./awards-category.entity";

/**
 * Entity that defines an 'awards' event.
 */
@Entity()
export class AwardsEvent extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * The corresponding year this event should take place in.
     */
    @Column({
        unique: true,
        nullable: false,
    })
    year: number;
    /**
     * Voting start date
     */
    @Column({
        nullable: false,
    })
    votingStartDate: Date;
    @Column({
        nullable: false,
    })
    votingEndDate: Date;
    @Column({
        nullable: false,
    })
    resultsDate: Date;
    @OneToMany(() => AwardsCategory, (category) => category.event)
    categories: AwardsCategory[];
}
