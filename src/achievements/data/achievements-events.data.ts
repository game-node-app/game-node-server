import { AwardsVote } from "src/awards/entity/awards-vote.entity";
import { AchievementCategory } from "../achievements.constants";
import { Achievement } from "../models/achievement.model";

export const achievementsEventsData:Achievement[] = [{
    id: "awards_2025",
    name: "Awards 2025",
    description: "Participate in the 2025 Game Awards event",
    expGainAmount: 150,
    category: AchievementCategory.EVENTS,
    checkEligibility: async (dataSource, targetUserId) => {
      const awardsVote = dataSource.getRepository(AwardsVote);
      return awardsVote.existsBy({
        profileUserId: targetUserId,
        category: {
            event: {
                year: 2025
            }
        }
      })
    }   
}];