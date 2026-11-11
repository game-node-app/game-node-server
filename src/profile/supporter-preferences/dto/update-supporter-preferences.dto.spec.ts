import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateSupporterPreferencesDto } from "./update-supporter-preferences.dto";

// Mirrors main.ts: ValidationPipe({ transform, enableImplicitConversion }).
async function errors(input: Record<string, unknown>) {
    const dto = plainToInstance(UpdateSupporterPreferencesDto, input, {
        enableImplicitConversion: true,
    });
    return validate(dto);
}

describe("UpdateSupporterPreferencesDto", () => {
    it("accepts an empty body", async () => {
        expect(await errors({})).toHaveLength(0);
    });

    it.each([
        { accentColor: "#FF8800" },
        { accentColor: "#abcdef" },
        { accentColor: null },
        { titleKey: "founder" },
        { titleKey: "a" },
        { titleKey: "a".repeat(32) },
        { titleKey: "supporter_badge-2" },
        { titleKey: null },
        { showBadge: false },
        { showBadge: true },
        {
            showBadge: false,
            titleKey: null,
            showAnimatedAvatarBorder: false,
            showSupporterTheme: false,
            accentColor: null,
            showOnSupportersWall: false,
            showLiveProfile: true,
        },
    ])("accepts valid values %o", async (input) => {
        expect(await errors(input)).toHaveLength(0);
    });

    it.each([
        { accentColor: "red" },
        { accentColor: "#FFF" },
        { accentColor: "#GGGGGG" },
        { accentColor: "" },
        { accentColor: "#FF8800\n" },
        { accentColor: 0xff8800 },
    ])("rejects invalid accentColor %o", async (input) => {
        expect(await errors(input)).not.toHaveLength(0);
    });

    it.each([
        { titleKey: "GameNode Admin" },
        { titleKey: "Founder" },
        { titleKey: "" },
        { titleKey: "a".repeat(33) },
        { titleKey: "founder!" },
        { titleKey: "founder\n" },
        { titleKey: 123 },
    ])("rejects invalid titleKey %o", async (input) => {
        expect(await errors(input)).not.toHaveLength(0);
    });

    it.each([
        "showBadge",
        "showAnimatedAvatarBorder",
        "showSupporterTheme",
        "showOnSupportersWall",
        "showLiveProfile",
    ])("rejects null for %s", async (field) => {
        expect(await errors({ [field]: null })).not.toHaveLength(0);
    });

    it.each([
        ["showBadge", "true"],
        ["showAnimatedAvatarBorder", 1],
        ["showSupporterTheme", {}],
        ["showOnSupportersWall", []],
        ["showLiveProfile", "false"],
    ])("rejects a non-boolean %s", async (field, value) => {
        expect(await errors({ [field]: value })).not.toHaveLength(0);
    });
});
