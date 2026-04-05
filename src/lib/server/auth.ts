import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import db from './db';
import type { UserRow } from './db';

const SESSION_TTL_SECS = 60 * 60 * 24; // 24 hours

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 12);
}

/** Scan all users and return the one whose pin_hash matches. */
export async function findUserByPin(pin: string): Promise<UserRow | null> {
  const users = db.prepare('SELECT * FROM users').all() as UserRow[];
  for (const user of users) {
    if (await bcrypt.compare(pin, user.pin_hash)) return user;
  }
  return null;
}

export function createSession(userId: number): string {
  const id = randomBytes(32).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECS;
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, exp);
  return id;
}

export function getSession(sessionId: string): { id: number; role: 'shift_lead' | 'manager' } | null {
  const now = Math.floor(Date.now() / 1000);
  return (db.prepare(`
    SELECT u.id, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(sessionId, now) ?? null) as { id: number; role: 'shift_lead' | 'manager' } | null;
}

export function deleteSession(sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function getSettings(): Record<string, string> {
  const rows = db.prepare(
    'SELECT key, value FROM settings WHERE location_id = 1'
  ).all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
