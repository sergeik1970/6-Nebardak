import fs from "node:fs";
import path from "node:path";
import { FURNITURE_ASSETS } from "../assets";
import type { RoomLabAssetDataUrls } from "./contact-sheet";

/** Furniture images inlined for a contact sheet. Node only: run from the `next` folder. */
export const loadRoomLabAssetDataUrls = (): RoomLabAssetDataUrls =>
    Object.entries(FURNITURE_ASSETS).reduce<RoomLabAssetDataUrls>((urls, [assetKey, asset]) => {
        const assetPath = path.join(process.cwd(), "public", asset.src.replace(/^\//, ""));
        urls[assetKey as keyof RoomLabAssetDataUrls] =
            `data:image/webp;base64,${fs.readFileSync(assetPath).toString("base64")}`;
        return urls;
    }, {});
