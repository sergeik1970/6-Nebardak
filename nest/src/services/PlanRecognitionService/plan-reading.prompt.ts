/**
 * What the model is asked about an uploaded plan. The server owns this text
 * so the site cannot be used to ask the model anything else. It must stay
 * identical to APARTMENT_READING_PROMPT in next/src/shared/lib/plan-recognition,
 * which the accuracy measurement uses; a test there compares the two.
 */
export const PLAN_READING_PROMPT = `You read a measured floor plan (обмерный план) of an apartment and return every room's geometry as JSON.

The sheet shows walls, partitions, window openings, door openings and dimension chains. Read sizes from the dimension numbers, not from pixels. A sheet note or the numbers' size tells the units: most sheets are in millimetres, some in centimetres or metres. Always answer in millimetres.

Return only JSON of this shape:
{
  "units_on_drawing": "mm" | "cm" | "m",
  "rooms": [
    {
      "name": string,
      "contour": [{"x": number, "y": number}, ...],
      "estimated": boolean,
      "openings": [{"kind": "window" | "door" | "entrance", "wall": number, "offset": number, "width": number}, ...]
    }
  ]
}

Rules:
- One entry per room, bathroom, corridor, storeroom, balcony or loggia that walls or partitions enclose. Use the name written on the sheet if there is one, otherwise a short description such as "room at the top right".
- contour: the room's inner wall faces, corners in order, in millimetres, in one coordinate frame shared by all rooms: put the apartment's top-left corner at x=0, y=0, x to the right, y downwards, as on the sheet, so every room sits where it is on the plan and the walls between neighbouring rooms show as gaps of the wall's thickness. Slanted and curved walls: use straight edges between their ends.
- Always give a complete contour with numbers, never null or an empty list. Where the sheet states a size, use it. Where it does not (an open-plan zone bounded by dashed lines, a room with no dimension chain), measure it on the drawing: the sheet is to scale, so take the scale from the stated dimensions nearby.
- estimated: true when any of this room's sizes was measured on the drawing rather than read from a stated number; false when every size was stated.
- wall: the index of the contour edge holding the opening; edge i runs from contour[i] to contour[i+1], the last edge closes to contour[0].
- offset: millimetres along that edge from contour[wall] to the nearer end of the opening; width: the opening's width in millimetres.
- kind: "window" for windows, "door" for doors and doorways between rooms or onto a balcony, "entrance" for the apartment's front door (list it once, in the room it opens into).
- No other keys, no comments.`;
