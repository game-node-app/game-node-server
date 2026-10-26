import {
    IsEnum,
    IsNotEmpty,
    ValidationArguments,
    ValidatorConstraint,
    ValidatorConstraintInterface,
    Validate,
    isUUID,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { StatisticsSourceType } from "../statistics.constants";

@ValidatorConstraint({ name: "isValidReactionSourceId", async: false })
export class IsValidReactionSourceIdConstraint
    implements ValidatorConstraintInterface
{
    validate(sourceId: any, args: ValidationArguments) {
        const obj = args.object as ReactionRequestDto;
        if (sourceId === undefined || sourceId === null || sourceId === "") {
            return false;
        }

        if (obj.sourceType === StatisticsSourceType.GAME) {
            if (
                typeof sourceId !== "number" &&
                (typeof sourceId !== "string" || !/^[1-9]\d*$/.test(sourceId))
            )
                return false;
            const num = Number(sourceId);
            return Number.isSafeInteger(num) && num > 0;
        }

        if (typeof sourceId !== "string") {
            return false;
        }
        return isUUID(sourceId);
    }

    defaultMessage(args: ValidationArguments) {
        const obj = args.object as ReactionRequestDto;
        if (obj.sourceType === StatisticsSourceType.GAME) {
            return "Game sourceId must be a positive integer";
        }
        return `${obj.sourceType || "Source"} sourceId must be a valid UUID`;
    }
}

export class ReactionRequestDto {
    @ApiProperty({
        enum: StatisticsSourceType,
        description: "The source type to like/unlike",
        example: StatisticsSourceType.REVIEW,
    })
    @IsEnum(StatisticsSourceType)
    @IsNotEmpty()
    sourceType: StatisticsSourceType;

    @ApiProperty({
        description:
            "Source identifier: UUID for content, positive integer for game",
        example: "123e4567-e89b-12d3-a456-426614174000",
    })
    @IsNotEmpty()
    @Validate(IsValidReactionSourceIdConstraint)
    sourceId: string | number;
}

export class ReactionResponseDto {
    @ApiProperty({
        description: "Whether the source is currently liked by the user",
        example: true,
    })
    isLiked: boolean;

    @ApiProperty({
        description: "Current total like count for the source",
        example: 1,
    })
    likesCount: number;
}
