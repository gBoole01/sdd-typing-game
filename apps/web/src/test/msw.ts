import { setupServer } from 'msw/node';

export const server = setupServer();

/** Mirrors `API_BASE_URL` in `.env.example`; the tests set the same value. */
export const API_BASE_URL = 'http://localhost:3001/api/v1';

export const api = (path: string): string => `${API_BASE_URL}${path}`;
