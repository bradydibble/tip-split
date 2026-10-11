// Release-notes acknowledgement storage (server-only).
//
// The "What's new" modal must appear exactly once per user per release:
// an acknowledgement row per (user, release). INSERT OR IGNORE makes
// concurrent dismissals idempotent.

import db from './db';
import { RELEASE_VERSION } from '../release';

/** True when this user has already dismissed the notes for this release. */
export function hasSeenReleaseNotes(
  userId: number,
  release: string = RELEASE_VERSION
): boolean {
  const row = db
    .prepare('SELECT 1 AS seen FROM release_note_acks WHERE user_id = ? AND release = ?')
    .get(userId, release);
  return !!row;
}

/** Record the dismissal. Safe to call twice. */
export function ackReleaseNotes(
  userId: number,
  release: string = RELEASE_VERSION
): void {
  db.prepare(
    'INSERT OR IGNORE INTO release_note_acks (user_id, release) VALUES (?, ?)'
  ).run(userId, release);
}
