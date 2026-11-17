import { ApiProperty } from "@nestjs/swagger";
import { Activity } from "../entities/activity.entity";
import { Game } from "../../../game/game-repository/entities/game.entity";

export class ActivityStatisticsSummaryDto {
    @ApiProperty({ type: Number })
    likesCount: number;

    @ApiProperty({ type: Boolean })
    isLiked: boolean;
}

export class ActivityResponseDto extends Activity {
    @ApiProperty({ type: () => Game, nullable: true })
    game: Game | null;

    @ApiProperty({ type: () => ActivityStatisticsSummaryDto })
    statistics: ActivityStatisticsSummaryDto;
}
