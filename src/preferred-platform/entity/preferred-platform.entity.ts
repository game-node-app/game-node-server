import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { GamePlatform } from "../../game/game-repository/entities/game-platform.entity";
import { Library } from "../../libraries/entities/library.entity";
import { PreferredPlatformScope } from "../preferred-platform.constants";
import { BaseEntity } from "../../utils/db/base.entity";

@Entity()
@Unique(["profileUserId", "platformId"])
export class PreferredPlatform extends BaseEntity {
    @PrimaryGeneratedColumn({ type: "bigint" })
    id: number;

    @Column()
    libraryUserId: string;

    @ManyToOne(() => Library, { onDelete: "CASCADE" })
    @JoinColumn({ name: "libraryUserId", referencedColumnName: "userId" })
    @Index()
    library: Library;

    @Column({ type: "bigint" })
    platformId: number;

    @ManyToOne(() => GamePlatform, { onDelete: "CASCADE" })
    @Index()
    platform: GamePlatform;

    @Index()
    @Column({ type: "float", default: 0 })
    order: number;

    @Column({ default: true })
    enabled: boolean;

    @Column({ type: "varchar", length: 255, nullable: true })
    label?: string;

    @Column({
        default: PreferredPlatformScope.ALL,
        nullable: false,
    })
    scope: PreferredPlatformScope;
}
