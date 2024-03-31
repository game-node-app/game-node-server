/**
 * Look-up table that matches a icon file to a set of platform abbreviations. <br>
 * Check /public/icons for reference.
 */
export const platformAbbreviationToIconMap: { [p: string]: string[] } = {
    windows: ["PC"],
    linux: ["Linux"],
    ps1: ["PS1"],
    ps2: ["PS2"],
    ps3: ["PS3"],
    ps4: ["PS4"],
    ps5: ["PS5"],
    psp: ["PSP"],
    psvita: ["Vita"],
    playstation: ["PSVR", "PSVR2"],
    x360: ["X360"],
    xone: ["XONE"],
    xseriesx: ["Series X"],
    xbox: ["XBOX"],
    nswitch: ["Switch"],
    n64: ["N64"],
    nwii: ["Wii"],
    nwiiu: ["WiiU"],
    nds: ["NDS", "3DS"],
    ngamecube: ["NGC"],
    nintendo: ["NES", "SNES"],
    sega: [
        "SMS",
        "segacd",
        "Sega32",
        "Saturn",
        "Genesis/Megadrive",
        "Game Gear",
    ],
};
