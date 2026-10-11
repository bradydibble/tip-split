import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const tmp = mkdtempSync(join(tmpdir(), 'tipsplit-release-notes-test-'));
process.env.DATABASE_PATH = join(tmp, 'test.db');

let rel: typeof import('./release-notes');
let release: typeof import('../release');
let db: typeof import('./db').default;

beforeAll(async () => {
  rel = await import('./release-notes');
  release = await import('../release');
  ({ default: db } = await import('./db'));
});

afterAll(() => {
  db?.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('release-notes acknowledgements', () => {
  it('RELEASE_VERSION stays in sync with package.json (drift fails CI)', () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../package.json', import.meta.url)),
        'utf8'
      )
    ) as { version: string };
    // Direct import would couple the test to the bundler's JSON handling;
    // readFileSync keeps it config-free.
    expect(release.RELEASE_VERSION).toBe(pkg.version);
  });

  it('is unseen for a fresh user, seen after ack, and stays seen (idempotent ack)', () => {
    const userId = Number(
      db.prepare("INSERT INTO users (pin_hash, role) VALUES ('x', 'shift_lead')").run()
        .lastInsertRowid
    );

    expect(rel.hasSeenReleaseNotes(userId)).toBe(false);

    rel.ackReleaseNotes(userId);
    rel.ackReleaseNotes(userId); // double-dismiss must not throw or duplicate
    expect(rel.hasSeenReleaseNotes(userId)).toBe(true);

    // A future release shows again for the same user.
    expect(rel.hasSeenReleaseNotes(userId, '999.0.0')).toBe(false);

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  it('clears acknowledgements when the user is deleted (cascade)', () => {
    const userId = Number(
      db.prepare("INSERT INTO users (pin_hash, role) VALUES ('x', 'manager')").run()
        .lastInsertRowid
    );
    rel.ackReleaseNotes(userId);

    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM release_note_acks WHERE user_id = ?')
      .get(userId) as { n: number };
    expect(rows.n).toBe(1);

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    const after = db
      .prepare('SELECT COUNT(*) AS n FROM release_note_acks WHERE user_id = ?')
      .get(userId) as { n: number };
    expect(after.n).toBe(0);
    expect(rel.hasSeenReleaseNotes(userId)).toBe(false);
  });
});
