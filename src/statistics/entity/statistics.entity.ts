import { Column, PrimaryGeneratedColumn } from "typeorm";

/**
 * Base class for all Statistics entities <br>
 * Make sure to add the 'OneToOne' relation manually on each inheritor. <br>
 * History: we used to have a single 'Statistics' table for everything, but this resulted in a lot of performance problems. <br>
 */
export abstract class Statistics {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        type: "bigint",
        nullable: false,
        default: 0,
    })
    viewsCount: number;
    @Column({
        type: "bigint",
        nullable: false,
        default: 0,
    })
    likesCount: number;
}
