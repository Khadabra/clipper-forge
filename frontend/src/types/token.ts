/**
 * types/token.ts — TypeScript interfaces for Gemini AI Token Usage Tracker & Quota Monitor.
 */

export interface TokenLogItem {
  id: number;
  feature_name: string;
  model_name: string;
  prompt_tokens: number;
  candidate_tokens: number;
  total_tokens: number;
  created_at: string;
}

export interface FeatureBreakdownItem {
  tokens: number;
  requests: number;
  all_time_tokens: number;
  percentage: number;
}

export interface TokenSummaryResponse {
  today_tokens: number;
  today_requests: number;
  all_time_tokens: number;
  all_time_requests: number;
  free_quota_limit: number;
  quota_used_percent: number;
  breakdown: Record<string, FeatureBreakdownItem>;
  recent_logs: TokenLogItem[];
}
