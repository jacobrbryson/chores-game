# Quest JSON Guide

Drop quest JSON files in this directory to add new quests.

## Required structure

- `id`: stable unique quest id.
- `startNodeId`: must reference an existing node id.
- `meta.totalEndings`: must match the number of unique ending ids.
- `nodes`: each node needs a unique `id` and a `type` of `story` or `ending`.

## Story nodes

- Must include 2-5 `choices`.
- Each choice needs:
  - `id` (stable)
  - `requiredItemId` (must exist in the shared game item catalog)
  - `nextNodeId` (must reference an existing node)
  - `consumeItem` (`true` or `false`)

## Ending nodes

- Must include `ending.endingId` and it must be unique across the quest.
- Optional `ending.replayHint` is shown in replay UX.

## Media

- Use paths under `/assets/quests/...` for images/audio.
- Missing images and audio gracefully fall back in the UI.
