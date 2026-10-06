process.env.SUPABASE_URL='https://x.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='k';process.env.SESSION_SECRET='s'.repeat(40);
import { readdirSync } from 'node:fs';
const files=['api/_lib/routes/admin-users.js','api/_lib/routes/admin-products.js','api/_lib/routes/admin-promotions.js','api/_lib/routes/admin-sales.js','api/_lib/routes/admin-misc.js','api/_lib/routes/site-config.js','api/_lib/routes/shop.js','api/_lib/routes/auth.js','api/_lib/routes/roblox.js','api/_lib/routes/public.js','api/_lib/routes/account.js','api/admin/[...path].js','api/shop/[...path].js'];
for (const f of files){ try{ await import('/home/claude/w/elvira-main/'+f); console.log('OK  ',f);}catch(e){console.log('FAIL',f,e.message.split('\n')[0]);} }
