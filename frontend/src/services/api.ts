import type { HealthResponse, SystemCheckResponse } from '../types/system';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed with status: ${response.status}`);
  }
  return response.json();
}

export async function fetchSystemCheck(): Promise<SystemCheckResponse> {
  const response = await fetch(`${API_BASE_URL}/system/check`);
  if (!response.ok) {
    throw new Error(`System diagnostics failed with status: ${response.status}`);
  }
  return response.json();
}
