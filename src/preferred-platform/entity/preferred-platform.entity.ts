import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { GamePlatform } from "../../game/game-repository/entities/game-platform.entity";
import { Library } from "../../libraries/entities/library.entity";

@Entity()
@Unique(["libraryUserId", "platformId"])
@Index(["libraryUserId", "order"])
export class PreferredPlatform {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    libraryUserId: string;

    @ManyToOne(() => Library, { onDelete: "CASCADE" })
    @JoinColumn({ name: "libraryUserId", referencedColumnName: "userId" })
    @Index()
    library: Library;

    @Column({
        nullable: false,
    })
    platformId: number;

    @ManyToOne(() => GamePlatform, { onDelete: "CASCADE", nullable: false })
    platform: GamePlatform;

    @Column({ type: "float", default: 0 })
    order: number;

    @Column({ default: true })
    enabled: boolean;

    @Column({ type: "varchar", length: 255, nullable: true })
    label?: string;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
