# Card FX

A three.js showcase of digital card game effects. There are no game rules here, only the
visuals, built so they can be lifted into a game later.

```bash
npm install
npm run dev
```

Then open http://localhost:5192. Keys 1 to 5 switch scenes.

Pushing to `main` publishes the site to https://teriyakisaurusrex2.github.io/card-fx/ through
`.github/workflows/deploy.yml`. `npm run build` followed by `npx vite preview` runs the built
version locally at that same `/card-fx/` path.

| Scene | What it shows |
| --- | --- |
| Finishes | 15 card textures side by side: partial foil, chromatic, metal, holographic, animated |
| Inspector | One card you can tilt, flip and zoom, plus sliders for building a finish |
| Booster | Choose a pack, tear it, burst, reveal one by one with rarity teases, then a summary row |
| Hand | The fan on its own, with every layout value on a slider |
| Board | Draw, play, cast, discard and destroy on a table, with an opponent and a demo loop |

## How it fits together

- `src/core/`: the renderer and post-processing (`stage.ts`), tweens and springs (`anim.ts`),
  synthesised sound (`audio.ts`) and panel widgets (`ui.ts`).
- `src/cards/`: everything about a card. `CardView` is the object you place in a scene,
  `finishes.ts` holds the finishes as plain data, `shaders.ts` is the one shader that reads them.
- `src/fx/`: GPU particles and one-shot effects (rings, flashes, rays).
- `src/scenes/`: one file per tab. These are the examples of how to use everything else.

## Reusing it in a game

The parts a game would call are in `src/cards/`:

- `CardView`: a card with a definition and a finish. Call `update(dt)` each frame.
- `moves.ts`: `flyTo`, `trail`, `impact`, `dissolveOut` (burn, shatter, sand).
- `HandController`: fan layout, hover and drag. Its `onDrag` and `onRelease` events are where
  game rules would decide whether a play is legal.
- `CardPile`: decks and graveyards.
- `BoosterPack`: the pack mesh and its tear.

Cards paint in layers (`CardLayer`: table, hand, air, top) instead of sorting by the depth
buffer, so moving cards never cut through each other. `setLayer` moves a card between them;
within a layer, the card nearer the camera paints last. `HandController` and `CardPile` set
this themselves, and scene code only needs it when a card lands on the table.

`src/scenes/board.ts` shows them working together. Its `playUnit`, `castSpell`, `draw` and
`destroyOnBoard` functions are the closest thing to a game's animation layer.

To add a finish, add an entry to the list in `finishes.ts`. Every value is a uniform, so most
new looks need no shader changes, and the Inspector's "Finish lab" is a quick way to find values.

Card data is in `src/cards/data.ts`. The art in `public/art` is copied from Sovereign TCG.
