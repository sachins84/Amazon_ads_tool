import cron from 'node-cron';
import { listAccounts } from '@/lib/db/accounts';
import { refreshAccountRecent } from '@/lib/amazon-api/refresh-service';
import { listRefreshStates } from '@/lib/db/metrics-store';

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
  const days = Math.max(1, Math.min(180, parseInt(process.env.REFRESH_DAYS || '21', 10) || 21));
  if (!cron.validate(schedule)) {
    console.error(`[cron] invalid REFRESH_CRON "${schedule}", refusing to start`);
    return;
  }

  let running = false;
  async function runDailyRefresh(trigger: 'cron' | 'startup-catchup') {
    if (running) {
      console.warn(`[cron] previous refresh still running, skipping ${trigger}`);
      return;
    }
    running = true;
    const t0 = Date.now();
    console.log(`[cron] daily refresh starting (${trigger})`, { schedule, days });
    try {
      const accounts = listAccounts();
      const results = await Promise.allSettled(
        accounts.map((a) => refreshAccountRecent(a.id, days)),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.length - ok;
      console.log(`[cron] daily refresh done in ${Math.round((Date.now() - t0) / 1000)}s`, { trigger, ok, fail });
    } catch (err) {
      console.error('[cron] daily refresh failed', err);
    } finally {
      running = false;
    }
  }

  cron.schedule(schedule, () => { void runDailyRefresh('cron'); }, { timezone: 'UTC' });

  // ── Settlement sync (hourly) ────────────────────────────────────────
  // The SP-API /reports/.../documents/{id} quota is 1/min sustained
  // (burst 15). Running hourly with maxReports=25 keeps each invocation
  // short — full backfill takes a few cycles, steady-state catches up
  // within one hour after Amazon emits the next batch.
  const settlementSchedule = process.env.SETTLEMENT_CRON || '12 * * * *';
  if (!cron.validate(settlementSchedule)) {
    console.error(`[cron] invalid SETTLEMENT_CRON "${settlementSchedule}", skipping`);
  } else {
    let settlementRunning = false;
    cron.schedule(settlementSchedule, async () => {
      if (settlementRunning) { console.warn('[cron] previous settlement sync still running, skipping'); return; }
      settlementRunning = true;
      try {
        const { syncSettlements } = await import('@/lib/sp-api/settlement-sync');
        const res = await syncSettlements({ maxReports: 25 });
        console.log('[cron] settlement sync done', res);
      } catch (e) {
        console.error('[cron] settlement sync failed', e);
      } finally { settlementRunning = false; }
    }, { timezone: 'UTC' });
    console.log(`[cron] settlement sync registered: "${settlementSchedule}" UTC`);
  }

  // ── Pause/unpause scheduler (minute tick) ──────────────────────────
  // Reads enabled pause_schedules every minute and fires any pause/resume
  // action that's due in the schedule's own timezone. Default '* * * * *'.
  const schedulerSchedule = process.env.SCHEDULER_CRON || '* * * * *';
  if (!cron.validate(schedulerSchedule)) {
    console.error(`[cron] invalid SCHEDULER_CRON "${schedulerSchedule}", skipping`);
  } else {
    cron.schedule(schedulerSchedule, async () => {
      try {
        const { runScheduleTick } = await import('@/lib/scheduler/pause-scheduler');
        await runScheduleTick('cron');
      } catch (e) {
        console.error('[cron] pause-scheduler tick failed', e);
      }
    }, { timezone: 'UTC' });
    console.log(`[cron] pause-scheduler registered: "${schedulerSchedule}" UTC`);
  }

  // ── Startup catch-up ────────────────────────────────────────────────
  // If the most-recent refresh is > 24h old, the server was probably down
  // when the daily cron fired. Run one now so users don't sit on stale
  // data until tomorrow morning. Fires once per boot, after a 30s grace
  // window so we don't compete with normal startup.
  setTimeout(() => {
    try {
      const states = listRefreshStates();
      if (states.length === 0) return; // fresh DB — let cron handle first run
      const newest = Math.max(
        ...states.map((s) => Date.parse(s.lastRefreshAt) || 0),
      );
      const ageHours = (Date.now() - newest) / (1000 * 60 * 60);
      if (ageHours > 24) {
        console.log(`[cron] last refresh was ${ageHours.toFixed(1)}h ago — firing startup catch-up`);
        void runDailyRefresh('startup-catchup');
      } else {
        console.log(`[cron] last refresh ${ageHours.toFixed(1)}h ago — no catch-up needed`);
      }
    } catch (err) {
      console.error('[cron] startup catch-up check failed', err);
    }
  }, 30_000);

  started = true;
  console.log(`[cron] daily refresh registered: "${schedule}" UTC, days=${days} (with startup catch-up if >24h stale)`);
}

startRefreshCron();
