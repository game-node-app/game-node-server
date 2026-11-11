import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, Matches, ValidateIf } from "class-validator";

// `$` alone would accept a trailing newline; the lookahead anchors the real end.
const END = "(?![\\s\\S])";
/** `#RRGGBB` only; the client owns contrast choices. */
const ACCENT_COLOR = new RegExp(`^#[0-9a-fA-F]{6}${END}`);
/** Titles are client-side translation keys, never free text (design 3). */
const TITLE_KEY = new RegExp(`^[a-z0-9_-]{1,32}${END}`);

export class UpdateSupporterPreferencesDto {
    // `@Type(() => Object)` keeps the raw value so the global implicit
    // conversion cannot turn "true" or 1 into a boolean before validation.
    @ValidateIf((dto) => dto.showBadge !== undefined)
    @Type(() => Object)
    @IsBoolean()
    showBadge?: boolean;

    // The CLI plugin serializes a RegExp variable as its name, so Swagger gets the literal pattern.
    @ApiPropertyOptional({
        type: String,
        nullable: true,
        pattern: TITLE_KEY.source,
    })
    @ValidateIf((dto) => dto.titleKey !== undefined && dto.titleKey !== null)
    @Matches(TITLE_KEY)
    titleKey?: string | null;

    @ValidateIf((dto) => dto.showAnimatedAvatarBorder !== undefined)
    @Type(() => Object)
    @IsBoolean()
    showAnimatedAvatarBorder?: boolean;

    @ValidateIf((dto) => dto.showSupporterTheme !== undefined)
    @Type(() => Object)
    @IsBoolean()
    showSupporterTheme?: boolean;

    @ApiPropertyOptional({
        type: String,
        nullable: true,
        pattern: ACCENT_COLOR.source,
    })
    @ValidateIf(
        (dto) => dto.accentColor !== undefined && dto.accentColor !== null,
    )
    @Matches(ACCENT_COLOR)
    accentColor?: string | null;

    @ValidateIf((dto) => dto.showOnSupportersWall !== undefined)
    @Type(() => Object)
    @IsBoolean()
    showOnSupportersWall?: boolean;

    @ValidateIf((dto) => dto.showLiveProfile !== undefined)
    @Type(() => Object)
    @IsBoolean()
    showLiveProfile?: boolean;
}
