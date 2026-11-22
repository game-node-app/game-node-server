export * from "./game-time-to-beat.entity";
export * from "./guild-board-entry.entity";
export * from "./guild-contract.entity";
export * from "./guild-event.entity";
export * from "./guild-event-translation.entity";
export * from "./guild-profile.entity";
export * from "./guild-reward.entity";
export * from "./user-guild-reward.entity";

import { GameTimeToBeat } from "./game-time-to-beat.entity";
import { GuildBoardEntry } from "./guild-board-entry.entity";
import { GuildContract } from "./guild-contract.entity";
import { GuildEvent } from "./guild-event.entity";
import { GuildEventTranslation } from "./guild-event-translation.entity";
import { GuildProfile } from "./guild-profile.entity";
import { GuildReward } from "./guild-reward.entity";
import { UserGuildReward } from "./user-guild-reward.entity";

/** Every Guild entity, for module registration and tests. */
export const GUILD_ENTITIES = [
    GameTimeToBeat,
    GuildBoardEntry,
    GuildContract,
    GuildEvent,
    GuildEventTranslation,
    GuildProfile,
    GuildReward,
    UserGuildReward,
] as const;
