/**
 * services/tokensApi.ts — API client for Gemini AI Token Usage Tracker & Quota Monitor.
 */
import type { TokenSummaryResponse } from '../types/token';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export async function fetchTokenSummary(): Promise<TokenSummaryResponse> {
  const res = await fetch(`${API_BASE}/api/tokens/summary`);
  if (!res.ok) {
    throw new Error(`Failed to fetch token summary: ${res.statusText}`);
  }
  return res.json();
}
