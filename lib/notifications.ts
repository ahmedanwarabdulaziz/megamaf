// lib/notifications.ts
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@megamaf.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function sendPushNotification(targetEmployeeIds: string[], title: string, body: string, action_url: string, type: string) {
  if (!targetEmployeeIds || targetEmployeeIds.length === 0) return;

  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Insert into in-app notifications
    const notificationsToInsert = targetEmployeeIds.map((empId) => ({
      employee_id: empId,
      title,
      body,
      action_url,
      type
    }));

    await supabaseAdmin.from('notifications').insert(notificationsToInsert);

    // 2. Fetch push subscriptions for these users
    if (!VAPID_PUBLIC) return; // Skip push if no keys
    const { data: subscriptions } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, employee_id')
      .in('employee_id', targetEmployeeIds);

    if (subscriptions && subscriptions.length > 0) {
      const payload = JSON.stringify({ title, body, url: action_url });

      // 3. Dispatch web push to all endpoints
      const pushPromises = subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err: any) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
          }
        }
      });

      // Fire and forget
      Promise.all(pushPromises).catch(console.error);
    }
  } catch (error) {
    console.error('Failed to dispatch push notification', error);
  }
}
