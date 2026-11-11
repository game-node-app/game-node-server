export interface SupporterPreferencesValues {
    showBadge: boolean;
    titleKey: string | null;
    showAnimatedAvatarBorder: boolean;
    showSupporterTheme: boolean;
    accentColor: string | null;
    showOnSupportersWall: boolean;
    showLiveProfile: boolean;
}

/** Mirrored by the column defaults of `profile_supporter_preferences` (design 2). */
export const SUPPORTER_PREFERENCES_DEFAULTS: SupporterPreferencesValues = {
    showBadge: true,
    titleKey: null,
    showAnimatedAvatarBorder: true,
    showSupporterTheme: true,
    accentColor: null,
    showOnSupportersWall: true,
    showLiveProfile: false,
};
