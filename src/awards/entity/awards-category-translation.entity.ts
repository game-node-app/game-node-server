import {
    Column,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { AwardsCategory } from "./awards-category.entity";

export type AwardsCategoryLocale = "en" | "pt-BR";

/**
 * One locale's name and description for an Awards category.
 */
@Entity()
@Unique("UQ_awards_category_translation_category_locale", [
    "categoryId",
    "locale",
])
export class AwardsCategoryTranslation extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => AwardsCategory, {
        nullable: false,
        onDelete: "CASCADE",
    })
    category: AwardsCategory;
    @Column({
        nullable: false,
    })
    categoryId: number;
    @Column({
        nullable: false,
        type: "varchar",
        length: 8,
    })
    locale: AwardsCategoryLocale;
    @Column({
        nullable: false,
    })
    name: string;
    @Column({
        nullable: false,
        type: "text",
    })
    description: string;
}
