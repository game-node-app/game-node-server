import {
    Column,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { AwardsEvent } from "./awards-event.entity";
import { AwardsCategorySuggestion } from "./awards-category-suggestion.entity";

/**
 * Defines a category to be voted in the Awards events.
 */
@Entity()
export class AwardsCategory extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => AwardsEvent)
    event: AwardsEvent;
    @Column({
        nullable: false,
    })
    eventId: number;
    @Column({
        nullable: false,
    })
    name: string;
    @Column({
        nullable: false,
        default: 0,
    })
    order: number;
    @Column({
        nullable: false,
    })
    description: string;
    /**
     * If this category corresponds to the 'global' goty award.
     */
    @Column({
        nullable: false,
        default: false,
    })
    isGOTY: boolean;
    @Column({
        nullable: false,
        default: false,
    })
    /**
     * If this category corresponds to the 'personal goty' award.
     */
    isPersonalGOTY: boolean;
    @OneToMany(
        () => AwardsCategorySuggestion,
        (suggestion) => suggestion.category,
    )
    suggestions: AwardsCategorySuggestion[];
}
