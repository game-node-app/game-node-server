import {
    Column,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from "typeorm";
import { ApiProperty } from "@nestjs/swagger";
import { BaseEntity } from "../../utils/db/base.entity";
import { AwardsCategoryTranslationDto } from "../dto/awards-category-translation.dto";
import { AwardsEvent } from "./awards-event.entity";
import { AwardsCategorySuggestion } from "./awards-category-suggestion.entity";
import { AwardsCategoryTranslation } from "./awards-category-translation.entity";

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
    /**
     * How many nominees finalization keeps for this category.
     */
    @Column({
        nullable: false,
        type: "smallint",
        default: 6,
    })
    nomineeCount: number;
    /**
     * Set once finalization ran, so a later tick never rewrites admin edits.
     */
    @Column({
        nullable: true,
        type: "datetime",
    })
    nomineesFinalizedAt: Date | null;
    @OneToMany(
        () => AwardsCategorySuggestion,
        (suggestion) => suggestion.category,
    )
    suggestions: AwardsCategorySuggestion[];
    @OneToMany(
        () => AwardsCategoryTranslation,
        (translation) => translation.category,
    )
    @ApiProperty({ type: [AwardsCategoryTranslationDto] })
    translations: AwardsCategoryTranslation[];
}
