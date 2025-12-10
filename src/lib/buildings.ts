// src/lib/buildings.ts

// Core list of buildings you operate in
export const BUILDINGS = ["DC1", "DC5", "DC11", "DC14", "DC18", "DC301"] as const;

// For dropdowns that need an "ALL" option
export const BUILDING_FILTER_OPTIONS = ["ALL", ...BUILDINGS] as const;

export type BuildingCode = (typeof BUILDINGS)[number] | "ALL";
