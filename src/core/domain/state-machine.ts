/**
 * Lead & Conversation Delivery State Machine
 * Mirrors PostgreSQL monotonic rank triggers to guarantee state-machine integrity in application logic.
 */

import type { LeadStatus } from './types';

export const LEAD_STATUS_RANK: Record<LeadStatus, number> = {
  PENDING: 10,
  NEW: 10,
  DEDUPLICATED: 15,
  DISPATCHED_TO_OWNER: 20,
  SENT: 30,
  WHATSAPP_SENT: 30,
  DELIVERED: 40,
  CUSTOMER_REPLIED: 50,
  ENGAGED: 60,
  CONVERTED: 70,
  LOST: 70,
  EXPIRED_NO_RESPONSE: 70,
};

/**
 * Returns true only if transitioning from `current` to `next` does not regress
 * the monotonic lead progression (e.g. prevents delayed SENT from overwriting DELIVERED).
 */
export function canTransitionLeadStatus(current: LeadStatus, next: LeadStatus): boolean {
  if (current === next) return false;
  return LEAD_STATUS_RANK[next] >= LEAD_STATUS_RANK[current];
}

export function isLeadAlreadyDeliveredOrReplied(status: LeadStatus): boolean {
  return LEAD_STATUS_RANK[status] >= LEAD_STATUS_RANK.DELIVERED;
}
