# Project management API

Project folder IDs are stable. All `:name` parameters and list `name` fields identify the folder; renaming changes only `project.name` (the display name).

The trash API uses `.trash`, which is not a valid project folder ID. An existing project whose ID is `trash` remains readable at `GET /api/projects/trash`.

- `GET /api/projects` → existing array, each row `{ name, displayName, modified, media, duration? }`. `displayName` falls back to the folder ID for legacy/invalid JSON.
- `PATCH /api/projects/:name` body `{ "name": "New display name" }` → `{ project, rev, history }` as in project GET. Uses undoable `rename_project` op. Trimmed, 1–120 characters, no control characters. Unicode and punctuation supported. Folder/media URLs remain unchanged.
- `DELETE /api/projects/:name` → `{ ok: true, trashed: { id, name, displayName, deletedAt } }`. Moves the complete project into local `projects/.trash/<uuid>/project`; no permanent delete. `deletedAt` is an ISO timestamp.
- `GET /api/projects/.trash` → array of `{ id, name, displayName, deletedAt }`, newest first. The `name` is the original folder ID.
- `POST /api/projects/.trash/:id/restore` (no body) → `{ name, project, rev, history }`. Restores the original folder ID. Never overwrites an occupied folder; collision returns 409.
- Errors → `{ error: string }`: 400 invalid input/unsafe path or symbolic link, 404 missing project/trash entry, 409 busy project or restore collision. Deletion rejects queued/running jobs and other in-flight project requests.
- WebSocket notification `{ type: "projects" }` tells clients to reload project/trash lists after creation, deletion, restoration, or a display-name change (including undo/redo). Existing `{ type: "project", name, project, rev, author, history }` remains unchanged. Deletion additionally broadcasts `{ type: "project_deleted", name }` so open editors can leave the removed project.

Trash stays on disk across server restarts; restore reloads project data and starts a fresh in-memory undo/transcript cache. No permanent-delete endpoint is provided.
