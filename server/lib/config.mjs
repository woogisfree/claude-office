// Locations and limits shared by the server modules.
import os from 'node:os';
import path from 'node:path';

// Set CLAUDE_OFFICE_CLAUDE_DIR to read a different location than ~/.claude (used by tests).
export const CLAUDE = process.env.CLAUDE_OFFICE_CLAUDE_DIR || path.join(os.homedir(), '.claude');
export const SESSIONS_DIR = path.join(CLAUDE, 'sessions');
export const PROJECTS_DIR = path.join(CLAUDE, 'projects');
export const TEAMS_DIR = path.join(CLAUDE, 'teams');
export const USAGE_FILE = path.join(CLAUDE, '.statusline-ratelimit-cache');
export const TAIL_BYTES = 256 * 1024;
export const CHUNK = 8 * 1024 * 1024;
export const WORKING_STALE_MS = 30 * 60 * 1000;
