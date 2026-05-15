import cron from 'node-cron';
import { listAccounts } from '@/lib/db/accounts';
import { refreshAccountRecent } from '@/lib/amazon-api/refresh-service';

let started = false;

export function startRefreshCron() {
  if (started) return;
  if (process.env.DISABLE_CRON === '1') {
    console.log('[cron] disabled via DISABLE_CRON=1');
    return;
  }
  if (process.env.NODE_ENV === 'development' && process.env.ENABLE_CRON_IN_DEV !== '1') {
    console.log('[cron] dev mode — refresh cron not started (set ENABLE_CRON_IN_DEV=1 to override)');
    return;
  }
  const schedule = process.env.REFRESH_CRON || '30 2 * * *';
  const days = Math.max(1, Math.min(180, parseInt(process.env.REFRESH_DAYS || '14', 10) || 14));
  if (!cron.validate(schedule)) {
    console.error(`[cron] invalid REFRESH_CRON "${schedule}", refusing to start`);
    return;
  }

  let running = false;
  cron.schedule(schedule, async () => {
    if (running) {
      console.warn('[cron] previous refresh still running, skipping');
      return;
    }
    running = true;
    const t0 = Date.now();
    console.log('[cron] daily refresh starting', { schedule, days });
    try {
      const accounts = listAccounts();
      const results = await Promise.allSettled(
        accounts.map((a) => refreshAccountRecent(a.id, days)),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.length - ok;
      console.log(`[cron] daily refresh done in ${Math.round((Date.now() - t0) / 1000)}s`, { ok, fail });
    } catch (err) {
      console.error('[cron] daily refresh failed', err);
    } finally {
      running = false;
    }
  }, { timezone: 'UTC' });

  started = true;
  console.log(`[cron] daily refresh registered: "${schedule}" UTC, days=${days}`);
}

startRefreshCron();
