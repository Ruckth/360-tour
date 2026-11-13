import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';


const crons = cronJobs();
crons.cron('clean raw marketing after 90 days', '0 3 * * *', internal.marketing.maintenance.cleanRawMarketing, {});
crons.interval('expire unpaid bookings', { hours: 1 }, internal.bookings.maintenance.expirePending, {});
crons.interval('sync OTA calendars', { minutes: 30 }, internal.bookings.calendar.ical.syncAll, {});
crons.interval('clean rate limits', { hours: 1 }, internal.messaging.maintenance.cleanRateLimits, {});
crons.interval('clean unattached staff and service photos', { hours: 6 }, internal.services.maintenance.cleanStaffAvatarUploads, {});
crons.interval('clean pending customer displays', { minutes: 10 }, internal.pos.displays.cleanPending, {});
// 09:00 Asia/Bangkok, so guests get these in the resort's morning rather than at a deploy-relative time.
crons.cron('queue pre-arrival emails', '0 2 * * *', internal.bookings.maintenance.queueLifecycleEmails, { kind: 'preArrival' });
crons.cron('queue review emails', '0 2 * * *', internal.bookings.maintenance.queueLifecycleEmails, { kind: 'review' });
crons.interval('recover messaging turns', { minutes: 1 }, internal.messaging.worker.recover, {});
export default crons;
