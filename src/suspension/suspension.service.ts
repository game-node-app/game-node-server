import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserSuspension } from "./entity/user-suspension.entity";
import { MoreThanOrEqual, Repository } from "typeorm";
import Session from "supertokens-node/recipe/session";
import { EUserRoles } from "../utils/constants";
import { UserRoleClaim } from "supertokens-node/recipe/userroles";

@Injectable()
export class SuspensionService {
    constructor(
        @InjectRepository(UserSuspension)
        private readonly userSuspensionRepository: Repository<UserSuspension>,
    ) {}

    async create(
        issuerUserId: string,
        targetUserId: string,
        type: "suspension" | "ban",
    ) {
        if (type === "ban") {
            await this.checkBanPermission(issuerUserId);
        }

        const fourteenDaysFromNow = new Date();
        fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);

        const suspension = this.userSuspensionRepository.create({
            isSuspension: type === "suspension",
            isBan: type === "ban",
            endDate: fourteenDaysFromNow,
            issuerUserId: issuerUserId,
            userId: targetUserId,
        });

        await this.userSuspensionRepository.save(suspension);
    }

    /**
     * Checks if the target user can issue bans.
     * @param userId
     */
    async checkBanPermission(userId: string) {
        const handles = await Session.getAllSessionHandlesForUser(userId);
        let hasAdminRole = false;
        for (const handle of handles) {
            const roles = await Session.getClaimValue(handle, UserRoleClaim);
            if (roles.status !== "OK") {
                continue;
            }
            if (
                roles.value != undefined &&
                roles.value.includes(EUserRoles.ADMIN)
            ) {
                hasAdminRole = true;
            }
        }

        if (!hasAdminRole) {
            throw new HttpException(
                "Only users with an admin role can issue bans.",
                HttpStatus.BAD_REQUEST,
            );
        }
    }

    async checkIsSuspendedOrBanned(userId: string) {
        const now = new Date();
        return await this.userSuspensionRepository.exists({
            where: [
                {
                    userId: userId,
                    isBan: true,
                },
                {
                    userId: userId,
                    isSuspension: true,
                    endDate: MoreThanOrEqual(now),
                },
            ],
        });
    }

    async checkIsSuspended(userId: string) {
        const now = new Date();
        return await this.userSuspensionRepository.exists({
            where: {
                userId: userId,
                isSuspension: true,
                endDate: MoreThanOrEqual(now),
            },
        });
    }

    async checkIsBanned(userId: string) {
        return await this.userSuspensionRepository.exists({
            where: {
                userId: userId,
                isBan: true,
            },
        });
    }
}
