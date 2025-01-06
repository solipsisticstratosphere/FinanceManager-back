import dotenv from 'dotenv';
import { futimes } from 'fs';

dotenv.config();

export function env(name, defaultValue) {
  const value = process.env[name];
  if (value) return value;
  if (defaultValue) return defaultValue;
  throw new Error(`Missing environment variable: ${name}`);
}
