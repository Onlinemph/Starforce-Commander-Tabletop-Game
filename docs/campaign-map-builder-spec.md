# Campaign Map Builder (Step 0): functional specification

Status: **draft for review. No application code will be written until this is approved.**

Each requirement is tagged by where it comes from:

- **[E] Explicit requirement:** stated in the design brief.
- **[D] Derived implementation requirement:** needed to deliver an explicit one. It is not a game rule.
- **[Q-n] Open design question:** it cannot be settled safely from the brief. The questions are collected in §13.
- **[R] Resolved:** the brief marked it open but also answered it. The answer is quoted, and I will not change it without asking.

Where this spec mentions the existing app, it means this repository. That includes the existing hex
campaign "StarForce: Border Command" (`src/campaign/`, `src/campaign-ui/`, `docs/border-command.md`).

---

## 1. Purpose and scope

1.1 [E] The Map Builder is Step 0 of a campaign-creation system: the player builds and saves reusable maps.
Later steps will use them: Step 1 selects a map, Step 2 chooses forces, and Step 3 sets objectives.

1.2 [E] This work covers Step 0 only. Steps 1–3 matter here only for what the Map Builder must save for them to use.

1.3 [E] Out of scope, with nothing built for them yet:
- player forces, AI fleet behaviour, objectives, combat, detection, movement and orders;
- campaign turns, victory conditions, intelligence, ship combat and random events.

1.4 [E] The saved data must keep each object's identity and relationships, so these systems can be added later.

1.5 [E] The design goals are:
- easy for a non-programmer;
- visually clear;
- fast for placing many objects;
- reusable, persistent, and compatible with the later campaign steps.

1.6 [Q-1] **Where the Map Builder lives, and which campaign uses its maps.** The brief describes a separate
campaign application. This repository already has a hex campaign, Border Command, whose maps are
generated at random (`generateMap` in `src/campaign/hexmap.ts`). Its map model differs from this brief:

| | Border Command map today | This brief |
|---|---|---|
| Star systems | Unnamed hex terrain; owner decided by which side of the border line the hex is on | Named objects with one of four types |
| Border | One frontier line between side A and side B | Per-hex colour, four values, "primarily decorative" |
| Terrain | Systems, nebulae, dust belts | Systems and nebulae (no dust) |
| Factions | Sides A and B, plus pirates | A, B, a third AI faction and neutral |
| Shipping lanes, text | None | Both |

---

## 2. User workflow

2.1 **Create a map**
1. [E] Open the Map Builder.
2. [E] Choose *New map*.
3. [E] Set the size, X hexes by Y hexes (§6.10).
4. [D] An empty grid opens with no tool selected.

2.2 **Build**
- [E] Pick a tool from the palette. The tool is highlighted.
- [E] Click hexes to apply it.
- [R] The tool stays active until **Esc** or a **right-click**. The brief says: "the tool should remain active until the user presses ESC or performs a right click."
- [D] Esc or a right-click returns to *no tool*. In that state, hovering still shows hex information (§6.7).

2.3 **Save**
1. [E] Choose *Save* in the palette.
2. [E] The system asks for a map name.
3. [E] The map is validated (§8). An invalid map is not saved, and the user is told why.
4. [E] The map is stored as a reusable map.

2.4 [E] **Manage maps** (§10): list saved maps, open or edit, duplicate, delete, and create new.

2.5 [E] **Later, in Step 1:** a campaign chooses a saved map. [R] At that moment the campaign takes its own copy (§12).

---

## 3. Screen layout

3.1 [E] A dedicated Map Builder screen.
- [Q-1] Its home is open: a new title-menu entry in the existing app, inside Border Command's menu, or a separate application.

3.2 [E] **Map canvas:** shows the hex grid and everything placed on it.
- [D] It pans and zooms. A 60 × 60 map is about 3,600 hexes, too many to show legibly at once on most screens.
- [D] Hex coordinate labels (§6.9) can be shown or hidden.

3.3 [E] **Map palette:** the tools (§4).
- [D] It sits at the side of the canvas on a desktop. [Q-19] Phone and tablet use is open.

3.4 [E] **Hex information box:** a small box that follows the pointer (§6.7).

3.5 [E] **Shipping-lane prompt bar:** shown only while a lane is being made (§7). It shows the current instruction plus *Cancel* and *Complete Shipping Lane*.

3.6 [E] **Map management view:** the list of saved maps (§10).

3.7 [D] **Status line:** shows the map name, its size, whether there are unsaved changes, and the active tool.

---

## 4. Map palette

4.1 [E] The palette has these tools, each with its own icon:

| Tool | What a click on a hex does |
|---|---|
| Border hex: Player A | Colours the hex RED (§5.1) |
| Border hex: Player B | Colours the hex BLUE |
| Border hex: third AI faction | Colours the hex GREEN |
| Border hex: neutral | Colours the hex GREY |
| Player A star system | Places a star system and asks for its name (§5.2) |
| Player B star system | ″ |
| Neutral star system | ″ |
| Unexplored star system | ″ |
| Nebula | Marks the hex as nebula (§5.3) |
| Shipping lane | Starts lane creation (§7) |
| Text box | Creates a text box (§5.5) |
| Erase | Opens the erase menu for the hex (§6.6) |
| Save | Saves the map (§2.3). This is an action, not a mode. |

4.2 [E] The active tool is clearly highlighted.

4.3 [D] Each tool has a tooltip.

4.4 [D] Keyboard shortcuts are optional. Esc always clears the active tool.

4.5 [Q-6] The palette has a GREEN border for the third AI faction but no third-faction star system. Is one needed?

4.6 [Q-17] Moving, selecting or editing existing objects needs a way to pick them: a text box, a star system's name, or a lane's waypoints or ships. The palette has no *Select / Move* tool. Should one be added?

---

## 5. Map objects

5.1 **Border designation**
- [E] There are four values: RED for Player A, BLUE for Player B, GREEN for the third AI faction, and GREY for neutral.
- [E] The colour is very light, highly transparent, and fills the whole hex.
- [E] It is "primarily decorative" and has no game effect of its own.
- [E] A hex has at most one border. A different colour replaces the existing one.
- [D] The four colours are drawn from the app's existing side colours, at low opacity, so they match the rest of the game.
- [Q-8] Clicking a hex with the same colour it already has: do nothing, or remove the colour?
- [Q-8] Can the user drag across hexes to colour many at once? This would help the "fast for placing many objects" goal.

5.2 **Star system**
- [E] There are four types: Player A, Player B, neutral and unexplored.
- [E] Placing one:
  1. the system is created in the hex;
  2. a dialog asks for its name;
  3. the name is stored with the system;
  4. the system's icon appears in the hex.
- [E] A hex has at most one star system.
- [Q-4] The brief says two different things about placing a system in a hex that already has one. See Q-4.
- [Q-5] Name rules: required or not, unique or not, and what Cancel does in the name dialog.
- [Q-5] Whether an *unexplored* system needs a name.
- [Q-5] Whether the name and type can be edited after placing.
- [Q-23] The brief names a "Player A star system" but gives it no meaning beyond its icon. Whether the type means A owns the system when a campaign starts is a campaign rule, so it is left for Step 1 to decide. The type is recorded as given.

5.3 **Nebula**
- [E] A hex either is nebula or is not. Nebula hexes are shown light purple.
- [E] A hex has at most one nebula. A second application creates no duplicate. Erase (§6.6) removes it.
- [Q-7] The feedback when the user applies Nebula to a hex that already is one.
- [Q-8] Whether drag-painting applies to nebulae as well.

5.4 **Shipping lane**
- [E] A lane is an ordered list of waypoints plus the civilian/cargo ships assigned to it.
- [E] Any number of lanes may pass through one hex.
- See §7 for creating a lane, and Q-10 for which hexes a lane counts as passing through.

5.5 **Text box**
- [E] Text boxes label objects or give other map information. They can be moved and edited after creation.
- [R] The brief answers these points:
  - text may overlap map objects;
  - font size can be changed;
  - the font can be changed, limited to basic fonts such as Arial, Calibri and Arial Black;
  - text colour can be changed;
  - text can be rotated;
  - boxes can be resized;
  - text is free-floating, not tied to a hex;
  - deleting what is under a text box does not delete the box.
- [D] A text box's position and size are stored in map units, not screen pixels, so it stays in place at any zoom level.
- [Q-18] Details still open:
  - Calibri is not installed on every device, so a substitute font would sometimes be used;
  - free rotation or fixed steps;
  - how a text box is erased, since the Erase tool works on hexes.

---

## 6. Map-editing behaviour

6.1 [E] Selecting a tool makes it active and highlights it.
- [E] Clicking a hex performs the tool's action.
- [R] The tool stays active until Esc or a right-click.

6.2 [E] A hex can hold several kinds of object at once: a border, a star system, a nebula, any number of lanes, and text over it.

6.3 [E] Drawing a hex that has both a border colour and a nebula: the **left half** of the hex is the border colour and the **right half** is nebula purple.
- [D] A hex with only one of the two is filled entirely with that colour.

6.4 [E] Icons may be drawn smaller so that several fit in one hex.
- [E] Each object is still stored separately, however it is drawn.
- [D] Drawing order, back to front: fill, lanes, star system, text.

6.5 [E] One star system, one border and one nebula per hex at most.
- [D] The editor enforces this at the moment of the click, so invalid data never builds up and has to be caught at save.

6.6 **Erase**
- [R] The brief chose Option C: clicking a hex opens a small menu listing that hex's objects, and the user chooses which to remove.
- [D] Choosing a menu item removes only that object.
- [D] A hex with nothing in it opens no menu and gives a brief "nothing to erase" notice.
- [Q-15] What erasing a lane from the menu does:
  - remove only the waypoint in this hex;
  - remove the whole lane; or
  - remove the whole lane, with the menu showing which lane it is.
- [Q-15] What happens to a lane whose only star-system waypoint is erased.

6.7 **Hex information box**
- [E] Hovering over a hex shows a small box listing what the hex actually holds. The brief's example layout is not binding.
- [D] The box leaves out empty fields.
  - It shows the coordinate (XXYY), the star system's name and type, the territory, whether the hex is nebula, and each lane passing through.
  - It does not list text boxes, since they are not part of the hex (§5.5).

6.8 [D] **Unsaved changes:** leaving the screen or opening another map with unsaved changes asks for confirmation first.
- [Q-20] Whether undo/redo is wanted.

6.9 **Coordinates**
- [R] Hexes are labelled XXYY. The first two digits are the column and the last two the row, and the top-left hex is **0101**.
- [D] Internally, hexes are stored as whole-number column and row, both counted from 1. XXYY is how they are written.
- [D] Any conversion to the existing campaign's internal hex coordinates happens only where a campaign uses the map.
- [Q-3] Hex orientation, and which columns are offset (see §13).

6.10 **Map size**
- [E] The user sets the width and height in hexes.
- [Q-2] The maximum size (the brief says both 60 × 60 and 40 × 60) and the minimum size.
- [Q-2] Whether a map can be resized after objects are placed, and what happens to objects outside the new edge.

---

## 7. Shipping lane creation

7.1 [E] Choosing the Shipping Lane tool starts lane creation. The prompt bar shows **SELECT STARTING WAYPOINT** and a **CANCEL** button.

7.2 [E] The first hex clicked is the first waypoint. Each further click adds the next waypoint.
- [D] The lane is drawn as it grows, joining the waypoints in order.

7.3 [E] Once there are two waypoints, **COMPLETE SHIPPING LANE** appears.
- [E] The user may keep adding waypoints for as long as they like.

7.4 [E] On *Complete*, the lane is checked (§8.4). If it fails, the system lists what is missing and the lane stays open for more waypoints.

7.5 [E] **Assigning ships**
- [E] After completion, a pull-down offers eligible cargo ships: those with **at least 6 cargo boxes**.
- [E] Choosing one adds it to the lane, and another pull-down appears for the next ship.
- [E] *COMPLETE SHIPPING LANE* finishes the lane.
- [D] Each chosen ship can be removed again before finishing.
- [Q-12] *COMPLETE SHIPPING LANE* is used twice: once to end the waypoints, once to end the ship list. Confirm this two-stage flow.
- [Q-13] Which designs count as eligible (see §13).

7.6 [D] *Cancel* or Esc at any stage throws away the unfinished lane, with a confirmation once at least one waypoint exists.
- [D] A right-click also cancels. This follows from Esc or right-click leaving a tool.

7.7 [Q-14] How lanes are named or numbered, and whether each has its own colour.

7.8 [Q-15] Whether a finished lane can be edited later (waypoints or ships), and how.

7.9 [E] **What gets saved for later.** The campaign engine, not the Map Builder, will:
- start each cargo ship at a random waypoint;
- choose its destination from the first waypoint, the last waypoint, or any waypoint with a star system;
- hold it at its destination for 2 to 16 phases, at random;
- then send it to another destination on the lane.

- [D] The ordered waypoints, and the star-system link at each waypoint, are all that is needed for this. The Map Builder runs none of it.
- [D] The Map Builder does not save the cargo-ship movement rules or their numbers (destination choices, 2–16 phases). The later campaign engine holds them.

---

## 8. Validation

8.1 **Map**
- [E] The dimensions are valid. [Q-2] The limits are open.
- [E] A map name exists before saving.

8.2 [E] **Star systems:** at most one per hex.

8.3 [E] **Border and nebula:** at most one of each per hex.

8.4 **Shipping lane**
- [E] It has:
  - a starting waypoint;
  - an ending waypoint;
  - at least one waypoint on a star system;
  - at least one eligible cargo ship.
- [E] Only ships with 6 or more cargo boxes can be assigned.
- [E] The brief warns not to assume the start and end must be different hexes.
- [Q-11] Open points:
  - whether the star-system waypoint may also be the start or end;
  - the minimum number of waypoints;
  - whether a hex may appear twice in one lane.

8.5 [E] **General:** invalid data is never saved.
- [D] All checks run again on save, and again on load.
- [D] A loaded file that fails them opens with the problems listed, not silently "repaired" (§11).

8.6 [Q-16] Whether a map with an unfinished or invalid lane can be saved as a draft. The brief says to prevent invalid saves, so the default is no.

---

## 9. Saved data model

9.1 [E] The map is an independent, reusable object. [D] It is shown below as TypeScript, the language of this codebase.

```ts
/** One saved map, in the shape it is stored and exported. */
interface SavedMap {
  formatVersion: 1            // [D] lets later versions upgrade old maps
  mapId: string               // [E] stable unique id (created once; duplicating creates a new one)
  name: string                // [E]
  width: number               // [E] hexes across
  height: number              // [E] hexes down
  createdAt: string           // [D] ISO time
  updatedAt: string           // [D] ISO time
  hexes: HexRecord[]          // [E] per-hex data; only hexes holding something are listed [D]
  starSystems: StarSystem[]   // [E]
  shippingLanes: ShippingLane[] // [E]
  textBoxes: TextBox[]        // [E]
}

/** A hex position: column then row, from 1. Written XXYY, so { col: 1, row: 1 } is 0101. */
interface HexCoord { col: number; row: number }   // [R] XXYY  [Q-3] orientation

interface HexRecord {
  coord: HexCoord                        // [E]
  border?: 'A' | 'B' | 'third' | 'neutral' // [E] at most one
  starSystemId?: string                  // [E] at most one
  nebula?: true                          // [E] at most one
  laneIds?: string[]                     // [E] lanes through this hex  [Q-10] which hexes count
}

interface StarSystem {
  id: string                                        // [E]
  name: string                                      // [E]  [Q-5] required/unique?
  type: 'player-a' | 'player-b' | 'neutral' | 'unexplored' // [E]  [Q-6] third faction?
  coord: HexCoord                                   // [E]
}

interface ShippingLane {
  id: string                 // [E]
  label: string              // [D] what the info box shows, e.g. "Lane 3"  [Q-14]
  waypoints: HexCoord[]      // [E] in order; first = start, last = end
  cargoShips: CargoAssignment[] // [E]
}

interface CargoAssignment {
  formId: string             // [D] the ship design, by its id in the game's ship list  [Q-13]
}

interface TextBox {
  id: string                 // [D]
  text: string               // [E]
  x: number; y: number       // [E] position, in map units (hex widths) [D]
  width: number; height: number // [R] resizable
  rotationDeg: number        // [R] rotatable  [Q-18] free or stepped
  fontFamily: 'Arial' | 'Calibri' | 'Arial Black' // [R]
  fontSizePt: number         // [R]
  color: string              // [R] e.g. '#ffd27a'
}
```

9.2 [D] The objects themselves are the master record. `HexRecord.starSystemId` and `laneIds` must agree with them.
- The brief asks for both to be saved, so both are.
- Loading checks that they agree (§8.5).

9.3 [D] Ids are generated values, never names. Renaming a system or lane leaves every reference to it intact.

9.4 [D] There is no separate nebula list. A nebula is a per-hex flag, which matches "one nebula per hex".
- The brief's architecture diagram lists Nebulae as its own branch. A list of nebula hexes can be built from the flags whenever it is needed.

---

## 10. Map management

10.1 [E] A management view lists the saved maps and offers *New map*. Each map has *Open/Edit*, *Duplicate* and *Delete*.

10.2 [D] Each row shows the name, size, last-edited time, and counts of star systems and lanes.

10.3 **Duplicate**
- [D] Makes a full copy with a new `mapId` and every object id renewed.
- [D] The copy is named "‹name› (copy)" and opens for editing.

10.4 **Delete**
- [R] Campaigns keep their own copy of the map (§12), so deleting a map never breaks a campaign.
- [D] Deleting still asks the user to confirm, since it cannot be undone.

10.5 [E] **Save**
- [D] Saving an existing map overwrites it.
- [Q-16] When the name is asked for: on the first save only, or on every save. Whether a "Save as new" option is needed. Whether two maps may share a name.

10.6 [Q-21] **Where maps are stored.** The existing app keeps its custom ships and scenarios in the browser, with JSON-file export and import, and an optional shared online library. Which of these do maps need?
- this browser only;
- plus export and import as a file;
- plus the shared online library.

---

## 11. Error handling

11.1 [D] A blocked placement explains itself in a brief notice and changes nothing. Examples: a second star system, a duplicate nebula, or a ship that is not eligible.

11.2 [D] Failed validation lists every problem in plain words, with the coordinates of the hexes involved. Clicking a problem centres the map on that hex.

11.3 [D] **Storage failures:** a full or blocked browser storage area, or a failed write, keeps the map open in the editor and offers *Export to file* so no work is lost.

11.4 [D] **Corrupt or newer files:** a file from a newer version, or one that fails validation, is refused with a reason, and nothing already saved is touched.

11.5 [D] **Ship designs that no longer exist:** a lane that names a ship design no longer in the game still loads. The missing ship is flagged and nothing is dropped silently.

---

## 12. Future campaign integration

12.1 [R] **Snapshot.** When a campaign is created with a map, it gets its own copy of that map. The copy records the source `mapId` and the time it was taken.
- Later edits to the saved map, or its deletion, do not change existing campaigns.
- In the brief's words: "Map Template → Campaign → Campaign-specific state".

12.2 [D] Campaign state is kept separate from the map snapshot. This covers ships moving, cargo ships travelling, and systems changing hands.
- The snapshot itself is never altered in play.

12.3 [E] What Step 3 needs from the map: a list of the ships and objects on it to attach objectives to. The stable ids for star systems, lanes and assigned cargo ships (§9.3) are what make this possible.

12.4 [Q-1] If the maps are for Border Command:
- its campaign file would accept a built map in place of a generated one;
- the differences in §1.6 would need decisions, chiefly whether the frontier comes from the border colours and what the third faction and neutral mean in play.

These are campaign rules, so they are left open here.

12.5 [D] The XXYY coordinates and the ordered waypoint lists hold enough for later movement and cargo-ship travel. No movement rules are implied by them.

---

## 13. Open design questions

| # | Question |
|---|---|
| Q-1 | **Home and purpose.** Should the Map Builder go into this app and feed Border Command, so a built map can replace a randomly generated one? Or should it serve a separate, new campaign game? If it feeds Border Command: does the frontier follow the border colours, and what do GREEN (third faction) and GREY (neutral) mean there, given that Border Command today has only sides A and B plus pirates? |
| Q-2 | **Map size.** Is the maximum 60 × 60, or 40 × 60 (the brief says both)? Is it a hard limit or only the largest expected size? What is the minimum? Can a map be resized after objects are placed, and if it shrinks, are objects outside the new edge deleted (with a warning) or is the shrink refused? |
| Q-3 | **Hex orientation.** Should hexes be flat-topped, in vertical columns, which suits XXYY and is how Border Command draws them? Or pointy-topped, in horizontal rows? With flat-topped hexes, are the even columns (0201, 0401…) shifted half a hex down, or the odd ones? |
| Q-4 | **A second star system in the same hex.** The brief says both "ask if you want to replace the existing star system" and "clearly inform the user that the hex already contains a star system." Which: (a) ask "Replace ‹name›?" with Yes/No, or (b) only inform, and the user must erase first? |
| Q-5 | **Star-system names.** Is a name required, or can it be left blank? Must names be unique on a map? If the user cancels the name dialog, is the placement undone? Do *unexplored* systems get a name too? Can a system's name or type be changed after placing, and with which tool? |
| Q-6 | **Third-faction star systems.** There is a GREEN border for the third AI faction but no third-faction star system. Should one be added? |
| Q-7 | **A second nebula on a nebula hex.** Should it (a) do nothing silently, (b) show "already a nebula", or (c) remove the nebula? The brief leaves this open. |
| Q-8 | **Fast painting.** Can the user drag across hexes to paint border colours and nebula, or is it one click per hex? Does clicking a hex with its current colour do nothing, or clear it? |
| Q-9 | **The split hex.** Is a hex with both border and nebula always split left and right? Or should it change, say to top and bottom, when a star-system icon or lane would be hidden? (Default: always left and right, as written.) |
| Q-10 | **Which hexes a lane passes through.** Only its waypoint hexes, or also every hex on the straight line between one waypoint and the next? This decides which hexes list the lane, and how far apart waypoints may be. Must consecutive waypoints be next to each other? |
| Q-11 | **Lane rules.** May the star-system waypoint also be the start or end waypoint, so a two-waypoint lane between two systems is valid? What is the minimum number of waypoints: 2, or 3 if the star system must be a middle waypoint? May the same hex appear twice in one lane, as a loop or a return? May start and end be the same hex? |
| Q-12 | **The two "Complete" steps.** Is it right that *Complete Shipping Lane* first ends the waypoints and then, a second time, ends the ship list? If the user cancels during ship assignment, is the whole lane thrown away? |
| Q-13 | **Eligible cargo ships.** In the current ship list, 17 designs have 6 or more cargo boxes:<br>• **8 freighters and transports:**<br>  – Union: Maersk I, Horizon, Warfarer, Galileo I, Galileo II and Runner;<br>  – Vallari: V-6H Salvage and V-5H Corsair Fast Transport.<br>• **6 stations and outposts:**<br>  – Union: Bastion I and II;<br>  – Vallari: Blackreach II and III, and Tortuga I and II.<br>• **3 pirate designs:** Reaver, Marauder and Jackal.<br>No Aurelian design qualifies. Should the menu offer all 17? Only those that can move (no stations)? Only freighters and transports? Should the ships offered depend on whose territory the lane crosses? Is an assignment a ship design, so the same design can be added several times, or an individual named ship? |
| Q-14 | **Lane names and colours.** Are lanes numbered automatically (Lane 1, Lane 2…), named by the user, or both? Does each lane get its own colour so crossing lanes can be told apart? |
| Q-15 | **Changing and erasing lanes.** Can a finished lane have waypoints added, removed or moved, and its ships changed? Does Erase on a waypoint hex offer "remove this waypoint", "remove the whole lane", or both? If erasing a star system leaves a lane with no star-system waypoint, should the erase be refused, should the user be warned and the lane flagged invalid, or should the lane be deleted? |
| Q-16 | **Save behaviour.** Is the name asked for on every save, or only the first (with a *Save as new* option)? May two maps share a name? Can an unfinished map be saved as a draft, or is every save fully validated? |
| Q-17 | **Selecting and moving things.** The palette has no Select/Move tool. How does the user move or edit a text box, or rename a star system, while another tool is active? Should a *Select* tool be added? Should text boxes always be draggable whatever the tool? |
| Q-18 | **Text-box details.** Is a substitute font acceptable on devices without Calibri? Is rotation free or in fixed steps (for example 15°)? Text boxes are not tied to hexes, so how are they erased: a delete button on the selected box, or a separate entry in the Erase menu? |
| Q-19 | **Devices.** Must the Map Builder work on phones and tablets? Pointer hover and right-click do not exist there, so it would need a tap to show hex information and a cancel button in place of right-click. Or is it desktop-only? |
| Q-20 | **Undo/redo.** Wanted? |
| Q-21 | **Storage and sharing.** Are maps kept only in this browser? Do they also export and import as a file? Should they go to a shared online library, as ships and scenarios already can? |
| Q-22 | **Other terrain.** Border Command maps also have dust belts. Should the palette have a Dust tool, or any other terrain? The brief lists only nebula, so nothing else is added. |
| Q-23 | **What the star-system types mean.** Does "Player A star system" mean A owns it at the start of a campaign, and "unexplored" that neither side knows what is there? The Map Builder records the type either way. The meaning is needed by Step 1, not here. |

---

## 14. Recommended implementation architecture

This assumes Q-1 is answered "in this app". If not, the same split applies, minus the shared code.

14.1 **Map model and checks, without screens:** `src/mapbuilder/`
- the types from §9;
- XXYY conversion;
- the placement checks (§6.5) and save checks (§8);
- duplicating with new ids;
- loading with upgrades for older formats.

Unit-tested in the same way as the rest of the game engine.

14.2 **Screens:** `src/mapbuilder-ui/`
- **Map:** an SVG hex canvas with pan and zoom, reusing the hex drawing and pointer-to-hex helpers that Border Command's map already has (`src/campaign-ui/helpers.ts`).
- **Grid size:** a 60 × 60 grid is within what that map already draws.
- **The rest:** the palette, the hover box, the lane prompt bar, the erase menu, the text-box editor and the map list.

14.3 **Storage**
- Maps are kept in the browser under one key, for example `sfc.campaign-maps.v1`. This follows the app's other user-made content.
- Each map exports and imports as a JSON file, using the same pattern as custom ships and scenarios.
- [Q-21] The shared online library is optional.

14.4 **Ship list:** eligibility (§7.5) is computed from the game's ship list, `ShipForm.systems`, by counting `CRGO` boxes. Nothing is hard-coded, so new freighter designs appear automatically.
- [Q-13] The filter itself is still open.

14.5 **Entry point:** a *Map Builder* button.
- [Q-1] Its location is open: the title menu, or Border Command's own menu.
- The Map Builder is its own screen, not a pop-up window, because it needs the whole screen.

14.6 **Tests**
- Unit tests:
  - every rule in §8;
  - XXYY conversion;
  - every Erase menu case;
  - lane validation;
  - duplicate and delete;
  - saving and loading round-trips.
- A screenshot test of a sample map, alongside the existing visual checks.

14.7 **Phasing after approval**
1. Model and checks.
2. Canvas, borders, nebulae and star systems.
3. Erase and hover.
4. Lanes and cargo ships.
5. Text boxes.
6. Map management and storage.

Each phase is usable and tested before the next.
