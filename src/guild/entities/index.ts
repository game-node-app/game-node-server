export * from "./game-time-to-beat.entity";
export * from "./guild-board-entry.entity";
export * from "./guild-community-bounty-claim.entity";
export * from "./guild-community-bounty-contribution.entity";
export * from "./guild-community-bounty-translation.entity";
export * from "./guild-community-bounty.entity";
export * from "./guild-consumable-inventory.entity";
export * from "./guild-contract.entity";
export * from "./guild-emporium-item.entity";
export * from "./guild-emporium-purchase.entity";
export * from "./guild-event-translation.entity";
export * from "./guild-event.entity";
export * from "./guild-passport-month.entity";
export * from "./guild-profile.entity";
export * from "./guild-reward.entity";
export * from "./guild-seal-ledger.entity";
export * from "./guild-user-chain.entity";
export * from "./user-guild-reward.entity";

import { GameTimeToBeat } from "./game-time-to-beat.entity";
import { GuildBoardEntry } from "./guild-board-entry.entity";
import { GuildCommunityBountyClaim } from "./guild-community-bounty-claim.entity";
import { GuildCommunityBountyContribution } from "./guild-community-bounty-contribution.entity";
import { GuildCommunityBountyTranslation } from "./guild-community-bounty-translation.entity";
import { GuildCommunityBounty } from "./guild-community-bounty.entity";
import { GuildConsumableInventory } from "./guild-consumable-inventory.entity";
import { GuildContract } from "./guild-contract.entity";
import { GuildEmporiumItem } from "./guild-emporium-item.entity";
import { GuildEmporiumPurchase } from "./guild-emporium-purchase.entity";
import { GuildEventTranslation } from "./guild-event-translation.entity";
import { GuildEvent } from "./guild-event.entity";
import { GuildPassportMonth } from "./guild-passport-month.entity";
import { GuildProfile } from "./guild-profile.entity";
import { GuildReward } from "./guild-reward.entity";
import { GuildSealLedger } from "./guild-seal-ledger.entity";
import { GuildUserChain } from "./guild-user-chain.entity";
import { UserGuildReward } from "./user-guild-reward.entity";

/** Every Guild entity, for module registration and tests. */
export const GUILD_ENTITIES = [
    GameTimeToBeat,
    GuildBoardEntry,
    GuildCommunityBounty,
    GuildCommunityBountyClaim,
    GuildCommunityBountyContribution,
    GuildCommunityBountyTranslation,
    GuildConsumableInventory,
    GuildContract,
    GuildEmporiumItem,
    GuildEmporiumPurchase,
    GuildEvent,
    GuildEventTranslation,
    GuildPassportMonth,
    GuildProfile,
    GuildReward,
    GuildSealLedger,
    GuildUserChain,
    UserGuildReward,
] as const;
