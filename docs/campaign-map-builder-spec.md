# Campaign Map Builder (Step 0): functional specification

Status: **revision 2, draft for review. No application code will be written until this is approved.**
Revision 2 adds the answers from the first review (§13).

Each requirement is tagged by where it comes from:

- **[E] Explicit requirement:** stated in the design brief.
- **[D] Derived implementation requirement:** needed to deliver an explicit one. It is not a game rule.
- **[Q-n] Open design question:** it cannot be settled safely from what we have. The questions are collected in §13.
- **[R] Resolved:** answered in the brief or in review. I will not change it without asking.

Where this spec mentions the existing app, it means this repository. That includes the existing hex
campaign "StarForce: Border Command" (`src/campaign/`, `src/campaign-ui/`, `docs/border-command.md`).

---

## 1. Purpose and scope

1.1 [E] The Map Builder is Step 0 of campaign creation: the player builds and saves reusable maps.
- [R] Maps are kept in a list, the same way ship designs are designed and saved.

1.2 [R] **Designing a campaign** happens later, in three steps:
1. choose a map from the list;
2. choose the forces for each side;
3. choose the objectives for each side.

1.3 [R] **Built maps feed Border Command** and replace its randomly generated maps. §12 covers what that changes.

1.4 [E] This work covers Step 0 only. Later steps matter here only for what the Map Builder must save for them to use.

1.5 [E] Out of scope, with nothing built for them yet:
- player forces, AI fleet behaviour, objectives, combat, detection, movement and orders;
- campaign turns, victory conditions, intelligence, ship combat and random events.

1.6 [E] The saved data must keep each object's identity and relationships, so these systems can be added later.

1.7 [E] The design goals are:
- easy for a non-programmer;
- visually clear;
- fast for placing many objects;
- reusable, persistent, and compatible with the later campaign steps.

---

## 2. User workflow

2.1 **Create a map**
1. [E] Open the Map Builder.
2. [E] Choose *New map*.
3. [E] Set the size, X hexes by Y hexes (§6.10).
4. [D] An empty grid opens with the Select tool active.

2.2 **Build**
- [E] Pick a tool from the palette. The tool is highlighted.
- [E] Click hexes to apply it.
- [R] The tool stays active until **Esc** or a **right-click**.
- [D] Esc or a right-click goes back to the Select tool. Hovering always shows hex information (§6.7).

2.3 **Save**
1. [E] Choose *Save* in the palette.
2. [E] The system asks for a map name.
3. [E] The map is validated (§8). An invalid map is not saved, and the user is told why.
4. [E] The map is stored as a reusable map.

2.4 [E] **Manage maps** (§10): list saved maps, open or edit, duplicate, delete, and create new.

2.5 [R] **Later, in campaign design:** the player picks a map. The campaign then takes its own copy of the map (§12.1).

---

## 3. Screen layout

3.1 [E] A dedicated Map Builder screen in this app.
- [D] It is opened from Border Command's menu, next to where a campaign is set up. [Q-27] A title-menu button as well is open.

3.2 [E] **Map canvas:** shows the hex grid and everything placed on it.
- [R] Hexes are flat-topped.
- [D] It pans and zooms. A 60 × 60 map has 3,600 hexes, too many to show legibly at once on most screens.
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

| Tool | What it does |
|---|---|
| **Select** [R] | Picks up a text box to move, resize, rotate or edit it (§5.5). |
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

4.4 [D] Keyboard shortcuts are optional. Esc always returns to Select.

4.5 [R] There are four kinds of star system: Player A, Player B, neutral and unexplored. There is no third-faction star system.

---

## 5. Map objects

5.1 **Border designation**
- [E] There are four values:
  - RED: Player A;
  - BLUE: Player B;
  - GREEN: [R] a third player, controlled by the AI;
  - GREY: [R] the border of neutral space.
- [E] The colour is very light, highly transparent, and fills the whole hex.
- [R] The colours are for map design only. They may be tied to objectives later. They carry no game rule now.
- [E] A hex has at most one border. A different colour replaces the existing one.
- [D] The colours are drawn from the app's existing side colours, at low opacity, so they match the rest of the game.
- [Q-8] Clicking a hex with the same colour it already has: do nothing, or remove the colour?
- [Q-8] Can the user drag across hexes to colour many at once? This would help the "fast for placing many objects" goal.

5.2 **Star system**
- [R] There are four types: Player A, Player B, neutral and unexplored.
- [E] Placing one:
  1. the system is created in the hex;
  2. a dialog asks for its name;
  3. the name is stored with the system;
  4. the system's icon appears in the hex.
- [E] A hex has at most one star system.
- [R] Placing a system in a hex that already has one asks **"Replace ‹name› with a new ‹type› system?"** (Yes / No).
  - Yes replaces it, keeping the hex's other contents.
  - No leaves everything as it was.
- [Q-5] Name rules: required or not, unique or not, and what Cancel does in the name dialog.
- [Q-5] Whether an *unexplored* system needs a name.
- [Q-5] Whether the Select tool can also rename a system or change its type.
- [Q-23] What the type means in a campaign. See §12.3.

5.3 **Nebula**
- [E] A hex either is nebula or is not. Nebula hexes are shown light purple.
- [E] A hex has at most one nebula. A second application creates no duplicate. Erase (§6.6) removes it.
- [D] In Border Command, a nebula hex costs double to enter, as Border Command's existing nebulae do today.
- [Q-7] The feedback when the user applies Nebula to a hex that already is one.
- [Q-8] Whether drag-painting applies to nebulae as well.

5.4 **Shipping lane**
- [E] A lane is an ordered list of waypoints plus the civilian/cargo ships assigned to it.
- [E] Any number of lanes may pass through one hex.
- [R] A lane may cross over itself.
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
- [R] The **Select** tool moves text boxes.
- [D] With Select:
  - dragging a box moves it;
  - its corner handles resize it;
  - a handle rotates it;
  - double-clicking edits its text, font, size and colour.
- [D] A text box's position and size are stored in map units, not screen pixels, so it stays in place at any zoom level.
- [Q-18] Details still open:
  - Calibri is not installed on every device, so a substitute font would sometimes be used;
  - free rotation or fixed steps;
  - how a text box is erased.

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
- [R] Clicking a hex opens a small menu listing that hex's objects, and the user chooses which to remove.
- [D] Choosing a menu item removes only that object.
- [D] A hex with nothing in it opens no menu and gives a brief "nothing to erase" notice.
- [Q-15] What erasing a lane from the menu does:
  - remove only the waypoint in this hex; or
  - remove the whole lane.
- [Q-15] What happens to a lane whose star-system count drops below three because a system was erased.

6.7 **Hex information box**
- [E] Hovering over a hex shows a small box listing what the hex actually holds. The brief's example layout is not binding.
- [D] The box leaves out empty fields.
  - It shows the coordinate (XXYY), the star system's name and type, the territory, whether the hex is nebula, and each lane passing through.
  - It does not list text boxes, since they are not part of the hex (§5.5).

6.8 [D] **Unsaved changes:** leaving the screen or opening another map with unsaved changes asks for confirmation first.
- [Q-20] Whether undo/redo is wanted.

6.9 **Coordinates and layout**
- [R] Hexes are labelled XXYY. The first two digits are the column and the last two the row, and the top-left hex is **0101**.
- [R] Hexes are flat-topped, and the **even** columns (0201, 0401…) sit half a hex lower than the odd ones.
- [D] Internally, hexes are stored as whole-number column and row, both counted from 1. XXYY is how they are written.
- [D] Border Command's grid is already laid out this way: flat-topped, with its second, fourth and following columns half a hex lower.
  - A built map's coordinates therefore convert exactly to its internal (q, r) coordinates:

    ```
    q = col − 1
    r = (row − 1) − floor((col − 1) / 2)
    ```

6.10 **Map size**
- [E] The user sets the width and height in hexes.
- [R] The maximum is **60 × 60**.
- [Q-2] The minimum size.
- [Q-2] Whether a map can be resized after objects are placed, and what happens to objects outside the new edge.

---

## 7. Shipping lane creation

7.1 [E] Choosing the Shipping Lane tool starts lane creation. The prompt bar shows **SELECT STARTING WAYPOINT** and a **CANCEL** button.

7.2 [E] The first hex clicked is the first waypoint. Each further click adds the next waypoint.
- [R] A lane may cross over itself, so a hex can be a waypoint more than once.
- [D] The lane is drawn as it grows, joining the waypoints in order.

7.3 [E] Once there are two waypoints, **COMPLETE SHIPPING LANE** appears.
- [E] The user may keep adding waypoints for as long as they like.

7.4 [E] On *Complete*, the lane is checked (§8.4). If it fails, the system lists what is missing and the lane stays open for more waypoints.

7.5 **Assigning ships**
- [E] After completion, a pull-down offers eligible cargo ships.
- [E] Choosing one adds it to the lane, and another pull-down appears for the next ship.
- [E] *COMPLETE SHIPPING LANE* finishes the lane.
- [D] Each chosen ship can be removed again before finishing.
- [Q-13] Which ships are eligible. Two rules have been offered, and they give different lists (see §13).
- [Q-12] *COMPLETE SHIPPING LANE* is used twice: once to end the waypoints, once to end the ship list. Confirm this two-stage flow.

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
- [R] The dimensions are at most 60 × 60. [Q-2] The minimum is open.
- [E] A map name exists before saving.

8.2 [E] **Star systems:** at most one per hex.

8.3 [E] **Border and nebula:** at most one of each per hex.

8.4 **Shipping lane**
- [E] It has:
  - a starting waypoint;
  - an ending waypoint;
  - [R] **at least three star systems** among its waypoints;
  - at least one eligible cargo ship.
- [D] Each star system counts once, however many times the lane passes it.
- [Q-11] Open points:
  - whether the first and last waypoints may themselves be star systems that count toward the three (the default is yes);
  - whether start and end may be the same hex.
- [Q-13] Only eligible ships can be assigned.

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
  width: number               // [E] hexes across, at most 60 [R]
  height: number              // [E] hexes down, at most 60 [R]
  createdAt: string           // [D] ISO time
  updatedAt: string           // [D] ISO time
  hexes: HexRecord[]          // [E] per-hex data; only hexes holding something are listed [D]
  starSystems: StarSystem[]   // [E]
  shippingLanes: ShippingLane[] // [E]
  textBoxes: TextBox[]        // [E]
}

/** A hex position: column then row, from 1. Written XXYY, so { col: 1, row: 1 } is 0101. */
interface HexCoord { col: number; row: number }   // [R] flat-topped, even columns half a hex lower

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
  type: 'player-a' | 'player-b' | 'neutral' | 'unexplored' // [R]
  coord: HexCoord                                   // [E]
}

interface ShippingLane {
  id: string                 // [E]
  label: string              // [D] what the info box shows, e.g. "Lane 3"  [Q-14]
  waypoints: HexCoord[]      // [E] in order; first = start, last = end; may repeat [R]
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
- [R] Campaigns keep their own copy of the map (§12.1), so deleting a map never breaks a campaign.
- [D] Deleting still asks the user to confirm, since it cannot be undone.

10.5 [E] **Save**
- [D] Saving an existing map overwrites it.
- [Q-16] When the name is asked for: on the first save only, or on every save. Whether a "Save as new" option is needed. Whether two maps may share a name.

10.6 [R] **Storage follows the ship designer.** [D] The Ship Builder today:
- keeps your designs in a list in this browser;
- downloads and imports them as a JSON file;
- can publish them to the shared online library.

Maps get the same three.
- [Q-21] Whether the online library is wanted for maps at first, or later.

---

## 11. Error handling

11.1 [D] A blocked placement explains itself in a brief notice and changes nothing. Examples: a duplicate nebula, or a ship that is not eligible.

11.2 [D] Failed validation lists every problem in plain words, with the coordinates of the hexes involved. Clicking a problem centres the map on that hex.

11.3 [D] **Storage failures:** a full or blocked browser storage area, or a failed write, keeps the map open in the editor and offers *Export to file* so no work is lost.

11.4 [D] **Corrupt or newer files:** a file from a newer version, or one that fails validation, is refused with a reason, and nothing already saved is touched.

11.5 [D] **Ship designs that no longer exist:** a lane that names a ship design no longer in the game still loads. The missing ship is flagged and nothing is dropped silently.

---

## 12. Border Command integration (campaign design, after Step 0)

None of this is built in Step 0. It is recorded so the saved map holds what it will need.

12.1 [R] **Snapshot.** When a campaign is created with a map, it gets its own copy of that map. The copy records the source `mapId` and the time it was taken.
- Later edits to the saved map, or its deletion, do not change existing campaigns.
- Campaign state is kept separate from the map snapshot. This covers ships moving, cargo ships travelling, and systems changing hands.
- The snapshot itself is never altered in play.

12.2 [R] **Built maps replace random ones.** [D] Border Command's campaign file already stores its map; today the map always comes from `generateMap`.
- A built map is converted into that stored map instead:
  - star systems become system hexes;
  - nebulae become nebula hexes;
  - XXYY becomes Border Command's coordinates (§6.9).
- Border Command's own map then also carries the extra built-map data: system names and types, territory colours, lanes and text.
- [D] Random maps also have **dust belts**, which the palette does not.
- [Q-22] Should the palette have a Dust tool, or do built maps simply have no dust?

12.3 **Three things in Border Command today come from the random map's border line.** They need a source on built maps:

| What | How it works on a random map | Question |
|---|---|---|
| Who owns each star system | The side of the border line the system is on | [Q-23] Does a Player A or B star system belong to that side at the start? Do neutral and unexplored systems belong to no one? |
| The solo AI's patrols | Placed along the border line | [Q-24] What should the AI patrol on a built map? |
| The frontier drawn on the campaign map | The border line | [D] Replaced by the territory colours as drawn in the Map Builder |

12.4 [R] **GREEN is a third player, controlled by the AI.** Border Command today has two sides and pirate raiders.
- [Q-25] Is the GREEN faction the existing pirates, or a new AI side?
- Either way, nothing about it is built in Step 0. The map only records which hexes are GREEN.

12.5 **The launch scenarios.** Border Command's three built-in campaigns (Border Watch, Raid on Delta Videus, The Long Patrol) each make a random map from a fixed seed, and put their forces at fixed hexes on it.
- [Q-26] When built maps replace random ones, should these three come with hand-built maps instead? Or should they be retired in favour of designing campaigns through the three steps?

12.6 [E] **What campaign design (step 3) needs from the map:** a list of the ships and objects on it to attach objectives to.
- [D] The stable ids for star systems, lanes and assigned cargo ships (§9.3) are what make this possible.

12.7 [D] **Cargo ships in play:** Border Command already has convoy units and civilian ship detection. The lanes' cargo ships are expected to become such units.
- That is campaign-engine work for later. The map stores only the lane, its waypoints and its ships.

---

## 13. Open design questions

### Answered in review 1

| # | Answer |
|---|---|
| Q-1 | Maps are designed and kept in a list like ship designs. They feed Border Command, replacing its random maps. Campaign design is: choose a map, choose forces for each side, choose objectives for each side. |
| Q-2 (part) | The maximum map size is 60 × 60. |
| Q-3 | Flat-topped hexes, with the even columns half a hex lower. |
| Q-4 | Placing a second system in a hex asks whether to replace the existing one. |
| Q-6 | Four kinds of star system: Player A, Player B, neutral and unexplored. There is no third-faction system. |
| Q-11 (part) | A lane must include at least three star systems, and it may cross over itself. |
| Q-17 | A Select tool is added, to move text boxes. |
| Colours | GREEN is a third player controlled by the AI. GREY borders neutral space. The colours are for map design only, though they may be tied to objectives later. |

### Still open

| # | Question |
|---|---|
| Q-2 | **Minimum size and resizing.** What is the smallest map allowed? Can a map be resized after objects are placed? If it shrinks, are objects outside the new edge deleted (with a warning), or is the shrink refused? |
| Q-5 | **Star-system names.** Is a name required, or can it be left blank? Must names be unique on a map? If the user cancels the name dialog, is the placement undone? Do *unexplored* systems get a name too? Should the Select tool also rename a system or change its type? |
| Q-7 | **A second nebula on a nebula hex.** Should it (a) do nothing silently, (b) show "already a nebula", or (c) remove the nebula? |
| Q-8 | **Fast painting.** Can the user drag across hexes to paint border colours and nebula, or is it one click per hex? Does clicking a hex with its current colour do nothing, or clear it? |
| Q-9 | **The split hex.** Is a hex with both border and nebula always split left and right? (Default: yes, as written.) |
| Q-10 | **Which hexes a lane passes through.** Only its waypoint hexes, or also every hex on the line between one waypoint and the next? This decides which hexes list the lane in their information box. Must consecutive waypoints be next to each other? |
| Q-11 | **The rest of the lane rules.** Can the first and last waypoints be among the three star systems? (Default: yes.) May start and end be the same hex? |
| Q-12 | **The two "Complete" steps.** Is it right that *Complete Shipping Lane* first ends the waypoints and then, a second time, ends the ship list? If the user cancels during ship assignment, is the whole lane thrown away? |
| Q-13 | **Which ships can be put on a lane.** Two rules were offered, and in today's ship list they give different results:<br>• **Name rule**, "freighter", "trader", "cargo" or "transport" in the name: **8 designs**.<br>  – Union: Runner, Maersk I, Horizon, Warfarer, Galileo I and Galileo II.<br>  – Vallari: V-6H Salvage and V-5H Corsair Fast Transport.<br>  All 8 also have 6 or more cargo boxes.<br>• **Capability rule**, 6 or more cargo boxes and speed 1 or more: **13 designs**. These are the same 8, plus the Vallari Tortuga I and II outposts (speed 1) and the pirate Reaver, Marauder and Jackal.<br>• **Recommendation:** the name rule *and* 6 or more cargo boxes. That gives today's 8 freighters and transports. A future design called "trader" with only 2 cargo boxes would still be kept out, as the brief's 6-box minimum requires.<br>Which rule should it be? |
| Q-14 | **Lane names and colours.** Are lanes numbered automatically (Lane 1, Lane 2…), named by the user, or both? Does each lane get its own colour so crossing lanes can be told apart? |
| Q-15 | **Changing and erasing lanes.** Can a finished lane have waypoints added, removed or moved, and its ships changed? Does Erase on a waypoint hex remove just that waypoint, or the whole lane? If erasing a star system leaves a lane with fewer than three, should the erase be refused, should the user be warned and the lane flagged invalid, or should the lane be deleted? |
| Q-16 | **Save behaviour.** Is the name asked for on every save, or only the first (with a *Save as new* option)? May two maps share a name? Can an unfinished map be saved as a draft? |
| Q-18 | **Text-box details.** Is a substitute font acceptable on devices without Calibri? Is rotation free or in fixed steps (for example 15°)? How is a text box erased: a delete button when it is selected, or an entry in the Erase menu? |
| Q-19 | **Devices.** Must the Map Builder work on phones and tablets? There is no hover or right-click there, so it would need a tap to show hex information and a cancel button. Or is it desktop-only? |
| Q-20 | **Undo/redo.** Wanted? |
| Q-21 | **Online library.** Should maps be publishable to the shared online library from the start, as ship designs are, or later? |
| Q-22 | **Dust.** Border Command's random maps have dust belts, which slow movement. Should the palette get a Dust tool, or do built maps have no dust? |
| Q-23 | **Who owns systems at the start.** Does a Player A or B star system belong to that side when a campaign begins? Do neutral and unexplored systems belong to no one? Today ownership comes from the random border line (§12.3). |
| Q-24 | **AI patrols.** On a random map, the solo AI patrols the border line. What should it patrol on a built map? For example, the hexes where RED and BLUE territory meet, or the GREY neutral hexes. |
| Q-25 | **The GREEN faction.** Is the AI-controlled third faction the existing pirate raiders, or a new AI side? |
| Q-26 | **The three built-in campaigns.** Should Border Watch, Raid on Delta Videus and The Long Patrol get hand-built maps, or be retired in favour of campaigns designed through the three steps? |
| Q-27 | **Entry point.** Should the Map Builder open from Border Command's menu only, or also from the title menu's workshop row next to the Ship Builder? |

---

## 14. Recommended implementation architecture

14.1 **Map model and checks, without screens:** `src/mapbuilder/`
- the types from §9;
- XXYY conversion, and conversion to Border Command coordinates (§6.9);
- the placement checks (§6.5) and save checks (§8);
- duplicating with new ids;
- loading with upgrades for older formats.

Unit-tested in the same way as the rest of the game engine.

14.2 **Screens:** `src/mapbuilder-ui/`
- **Map:** an SVG hex canvas with pan and zoom, reusing the hex drawing and pointer-to-hex helpers that Border Command's map already has (`src/campaign-ui/helpers.ts`).
- **Grid size:** a 60 × 60 grid is within what that map already draws.
- **The rest:** the palette, the hover box, the lane prompt bar, the erase menu, the text-box editor and the map list.

14.3 **Storage** (as the Ship Builder does):
- maps kept in the browser under one key, for example `sfc.campaign-maps.v1`;
- a JSON file for export and import;
- [Q-21] publishing to the shared online library.

14.4 **Ship list:** eligibility (§7.5) is computed from the game's ship list. Nothing is hard-coded, so new freighter designs appear automatically.
- [Q-13] The rule itself is still open.

14.5 **Entry point:** a *Map Builder* button.
- [Q-27] Its location is open.
- The Map Builder is its own screen, not a pop-up window, because it needs the whole screen.

14.6 **Tests**
- Unit tests:
  - every rule in §8;
  - XXYY and Border Command coordinate conversion;
  - every Erase menu case;
  - lane validation;
  - duplicate and delete;
  - saving and loading round-trips.
- A screenshot test of a sample map, alongside the existing visual checks.

14.7 **Phasing after approval**
1. Model and checks.
2. Canvas, Select tool, borders, nebulae and star systems.
3. Erase and hover.
4. Lanes and cargo ships.
5. Text boxes.
6. Map management and storage.
7. Border Command takes built maps in place of random ones (§12), once Q-22 to Q-26 are answered.

Each phase is usable and tested before the next.
