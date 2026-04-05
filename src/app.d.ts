declare global {
  namespace App {
    interface Locals {
      user: { id: number; role: 'shift_lead' | 'manager' } | null;
      sessionId: string | null;
    }
    interface PageData {}
    interface Error {}
    interface Platform {}
  }
}

export {};
