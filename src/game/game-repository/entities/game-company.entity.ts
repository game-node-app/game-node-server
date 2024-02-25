import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Game } from "./game.entity";
import { GameCompanyLogo } from "./game-company-logo.entity";

@Entity()
export class GameCompany {
    @PrimaryGeneratedColumn({ type: "bigint" })
    id: number;

    @Column({ type: "datetime", nullable: true })
    changeDate?: Date;

    @Column({
        nullable: true,
    }) // Add Enum type here
    changeDateCategory?: string;

    @ManyToOne(() => GameCompany, {
        nullable: true,
    })
    changedCompany?: GameCompany;

    @Column({ type: "uuid", nullable: true })
    checksum?: string;

    @Column({ type: "int", nullable: true })
    country?: number;

    @CreateDateColumn({ type: "datetime" })
    createdAt: Date;

    @Column({ type: "text", nullable: true })
    description?: string;

    @ManyToOne(() => GameCompanyLogo, {
        nullable: true,
    }) // Assuming CompanyLogo as another entity
    logo?: GameCompanyLogo;

    @Column({ type: "varchar", length: 255 })
    name: string;

    @ManyToOne(() => GameCompany, {
        nullable: true,
    })
    @JoinColumn()
    parent?: GameCompany;

    @Column({ type: "varchar", length: 255 })
    slug: string;

    @Column({ type: "datetime", nullable: true })
    startDate?: Date;

    @Column({
        nullable: true,
    }) // Add Enum type here
    startDateCategory?: string;

    @UpdateDateColumn({ type: "datetime" })
    updatedAt: Date;

    @Column({ type: "varchar", length: 255, nullable: true })
    url?: string;
}
