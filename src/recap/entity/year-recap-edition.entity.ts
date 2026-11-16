import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/**
 * Per-year Recap opening time. Without a row, `getRecapWindow` defaults to 15 November.
 */
@Entity("year_recap_edition")
export class YearRecapEdition {
    @PrimaryColumn({ type: "int" })
    year: number;
    @Column({ type: "datetime" })
    opensAt: Date;
    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
