// Shared Supabase client (service role — server side only, never sent to the browser).
import { createClient } from '@supabase/supabase-js';

// Be forgiving with how SUPABASE_URL was pasted: strip a trailing "/rest/v1/"
// or "/" (that mistake causes the PGRST125 "Invalid path" error).
function cleanUrl(raw) {
  return String(raw || '')
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/, '');
}

export const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);

export const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export const MEDIA_BUCKET = 'product-media'; // public: images/videos shown in the store
export const FILES_BUCKET = 'product-files'; // private: files delivered after purchase

// Escape %, _ and \ so a value can be used with ILIKE as an exact,
// case-insensitive match (Discord/Roblox usernames contain "_").
export function likeExact(value) {
  return String(value || '').trim().replace(/[\\%_]/g, (c) => '\\' + c);
}
