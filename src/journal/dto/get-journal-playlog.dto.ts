import { JournalPlaylogItemType } from "../journal.constants";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import { GameAchievementWithObtainedInfo } from "../../game/game-achievement/dto/game-obtained-achievement.dto";

export class JournalPlaylogGroupDto {
    /**
     * Date used as criteria to group related entries.
     * In 'DD-MM-YYYY' format.
     * Entries will be grouped by this.
     */
    date: string;
    /**
     * Type used as criteria to group related entries.
     * Entries will be grouped by this.
     */
    type: JournalPlaylogItemType;
    /**
     * The {@link GamePlatform}s this entry relates to.
     * <strong>THIS IS NOT USED AS A GROUPING KEY.</strong>
     */
    platformIds: number[];
    entries: JournalPlaylogEntryDto[];
}

export class JournalPlaylogEntryDto {
    gameId: number;
    type: JournalPlaylogItemType;
    /**
     * Only available for 'type' of 'collection_entry_status'
     */
    entryStatus?: CollectionEntryStatus;
    /**
     * Only available for 'type' of 'obtained_achievement'
     */
    obtainedAchievement?: GameAchievementWithObtainedInfo;
    /**
     * The {@link GamePlatform}s this entry relates to.
     */
    platformIds: number[];
    /**
     * Date for the staus of 'collection_entry_status', and date the achievement was obtained for 'obtained_achievement'
     * In 'DD-MM-YYYY' format.
     */
    date: string;
}
