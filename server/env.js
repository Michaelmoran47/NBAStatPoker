// @ts-check
// Loads server/.env into process.env. Import this before any module that reads process.env at load time
// (auth.js reads GOOGLE_CLIENT_ID that way). Imports run in order, so importing this first is enough.
// A bare 'dotenv/config' import reads from the directory the server was launched in, which silently
// ignored server/.env when the server was started from the repo root.

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '.env') });
