import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { minutes } from "@nestjs/throttler";
import { Cacheable } from "../../utils/cacheable";
import { Profile } from "../../profile/entities/profile.entity";
import { Game } from "../game-repository/entities/game.entity";
import { GameCover } from "../game-repository/entities/game-cover.entity";
import { GameCoverOption } from "./entities/game-cover-option.entity";
import { UserGameCover } from "./entities/user-game-cover.entity";
import { CustomCoverMode, GameCoverOrigin } from "./game-cover.constants";
import { coverOptionImage } from "./game-cover-option.upsert";
import { GameCoverOptionResponseDto } from "./dto/game-cover-option-response.dto";
import { GameCoverChoiceResponseDto } from "./dto/game-cover-choice.dto";

@Injectable()
export class GameCoverService {
    constructor(
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        @InjectRepository(GameCoverOption)
        private readonly optionRepository: Repository<GameCoverOption>,
        @InjectRepository(UserGameCover)
        private readonly choiceRepository: Repository<UserGameCover>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
    ) {}

    @Cacheable(GameCoverService.name, minutes(5))
    async findOptions(gameId: number): Promise<GameCoverOptionResponseDto[]> {
        return await this.listOptions(await this.findGameOrFail(gameId));
    }

    async findChoice(
        userId: string,
        gameId: number,
    ): Promise<GameCoverChoiceResponseDto> {
        const choice = await this.choiceRepository.findOneBy({
            userId,
            gameId,
        });
        return { coverOptionId: choice?.coverOptionId ?? null };
    }

    async setChoice(
        userId: string,
        gameId: number,
        coverOptionId: number,
    ): Promise<GameCoverChoiceResponseDto> {
        const game = await this.findGameOrFail(gameId);
        const option = await this.optionRepository.findOneBy({
            id: coverOptionId,
        });
        if (!option) throw new NotFoundException("Cover option not found.");

        const listed = await this.listOptions(game);
        if (!listed.some((item) => item.id === option.id)) {
            throw new BadRequestException(
                "Cover option is not available for this game.",
            );
        }

        await this.choiceRepository.upsert(
            { userId, gameId, coverOptionId: option.id },
            ["userId", "gameId"],
        );
        return { coverOptionId: option.id };
    }

    async removeChoice(userId: string, gameId: number): Promise<void> {
        await this.choiceRepository.delete({ userId, gameId });
    }

    /**
     * Design 5: applies the effective cover to a page of games, returning copies of the games it
     * changes. Games come from the shared cache, so the input is never mutated.
     */
    async applyEffectiveCovers(
        games: Game[],
        viewerUserId?: string,
        ownerUserId?: string,
    ): Promise<Game[]> {
        if (games.length === 0) return games;

        const mode = viewerUserId
            ? ((
                  await this.profileRepository.findOneBy({
                      userId: viewerUserId,
                  })
              )?.customCoverMode ?? CustomCoverMode.Any)
            : CustomCoverMode.Any;
        if (mode === CustomCoverMode.None) return games;

        const userIds = [...new Set([viewerUserId, ownerUserId])].filter(
            (userId): userId is string => !!userId,
        );
        if (userIds.length === 0) return games;

        const choices = await this.choiceRepository.find({
            where: {
                userId: In(userIds),
                gameId: In(games.map((game) => game.id)),
            },
            relations: { coverOption: true },
        });
        const byUser = new Map<string, Map<number, GameCoverOption>>();
        for (const choice of choices) {
            const chosen = byUser.get(choice.userId) ?? new Map();
            chosen.set(choice.gameId, choice.coverOption);
            byUser.set(choice.userId, chosen);
        }
        const pick = (userId: string | undefined, gameId: number) =>
            userId ? byUser.get(userId)?.get(gameId) : undefined;

        return games.map((game) => {
            const option =
                mode === CustomCoverMode.PreferYours
                    ? (pick(viewerUserId, game.id) ??
                      pick(ownerUserId, game.id))
                    : ownerUserId
                      ? pick(ownerUserId, game.id)
                      : pick(viewerUserId, game.id);
            if (!option) return game;

            return {
                ...game,
                cover: {
                    id: option.igdbId,
                    ...coverOptionImage(option),
                } as GameCover,
            };
        });
    }

    private async findGameOrFail(gameId: number): Promise<Game> {
        const game = await this.gameRepository.findOne({
            where: { id: gameId },
            relations: { cover: true },
        });
        if (!game) throw new NotFoundException("Game not found.");
        return game;
    }

    /** Design 6: the game and its base game offer the options, minus its own cover. */
    private async listOptions(
        game: Game,
    ): Promise<GameCoverOptionResponseDto[]> {
        const query = this.optionRepository
            .createQueryBuilder("option")
            .where("option.gameId IN (:...gameIds)", {
                gameIds: [
                    ...new Set([game.id, game.versionParentId ?? game.id]),
                ],
            })
            .andWhere(
                "NOT (option.origin = :origin AND option.igdbId = :gameId)",
                { origin: GameCoverOrigin.Game, gameId: game.id },
            );
        if (game.cover?.imageId) {
            query.andWhere(
                "(option.imageId IS NULL OR option.imageId <> :imageId)",
                { imageId: game.cover.imageId },
            );
        }

        const options = await query.orderBy("option.id", "ASC").getMany();
        return options.map((option) => ({
            id: option.id,
            kind: option.kind,
            label: option.label,
            image: {
                id: option.igdbId,
                imageId: option.imageId,
                url: option.url,
                width: option.width,
                height: option.height,
                alphaChannel: option.alphaChannel,
                animated: option.animated,
                checksum: option.checksum,
            },
        }));
    }
}
