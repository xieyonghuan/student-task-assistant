package cn.shike.study;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.Collections;

final class CourseAlarms {
    static final String CHANNEL = "shike-course-reminders-v1";
    static final String FIRE = "cn.shike.study.COURSE_ALARM", REFRESH = "cn.shike.study.COURSE_REFRESH";
    private final Context context;
    private final AlarmManager alarms;
    private final NotificationManager notifications;
    private final SharedPreferences prefs;
    CourseAlarms(Context context) {
        this.context = context.getApplicationContext(); alarms = context.getSystemService(AlarmManager.class);
        notifications = context.getSystemService(NotificationManager.class);
        prefs = context.getSharedPreferences("course-alarm-state", Context.MODE_PRIVATE);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "上课提醒", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("所选主课表的上课提醒"); channel.enableVibration(true); notifications.createNotificationChannel(channel);
    }
    boolean granted() {
        NotificationChannel channel = notifications.getNotificationChannel(CHANNEL);
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && notifications.areNotificationsEnabled() && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    boolean exact() { return Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms(); }
    JSONObject status() throws Exception {
        String error = prefs.getString("error", "");
        return new JSONObject().put("granted", granted()).put("exact", exact())
            .put("scheduled", prefs.getStringSet("scheduled", Collections.emptySet()).size()).put("error", error);
    }
    private PendingIntent pending(String action, String token) {
        Intent intent = new Intent(context, CourseAlarmReceiver.class).setAction(action)
            .setData(new Uri.Builder().scheme("shike-course").authority("alarm").appendPath(token).build());
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static String token(JSONObject occurrence, int lead) throws Exception {
        return occurrence.getString("key") + "@" + occurrence.getLong("begin") + "@" + lead;
    }
    private static String instance(String token) { return token.substring(0, token.lastIndexOf('@')); }
    private static boolean received(Set<String> receipts, String token) {
        String current = instance(token);
        for (String receipt : receipts) if (instance(receipt).equals(current)) return true;
        return false;
    }
    private void clearNotices(Set<String> valid) {
        for (android.service.notification.StatusBarNotification notice : notifications.getActiveNotifications())
            if (CHANNEL.equals(notice.getNotification().getChannelId()) && !valid.contains(notice.getTag())) notifications.cancel(notice.getTag(), notice.getId());
    }
    private void schedule(long at, PendingIntent pending) {
        if (exact()) {
            try { alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending); return; }
            catch (SecurityException denied) { /* Permission can change after canScheduleExactAlarms(). */ }
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
    }
    void rebuild() throws Exception {
        synchronized (CourseStore.LOCK) {
            Set<String> old = new HashSet<>(prefs.getStringSet("scheduled", Collections.emptySet()));
            for (String key : old) { PendingIntent p = pending(FIRE, key); alarms.cancel(p); p.cancel(); }
            alarms.cancel(pending(REFRESH, "refresh"));
            prefs.edit().putStringSet("scheduled", Collections.emptySet()).putString("error", "").commit();
            JSONObject state = new CourseStore(context).read();
            if (!state.getBoolean("reminders") || !granted()) { clearNotices(Collections.emptySet()); return; }
            JSONObject table = CourseEngine.table(state, state.getString("primaryId"));
            long now = System.currentTimeMillis(); LocalDate today = Instant.ofEpochMilli(now).atZone(CourseEngine.ZONE).toLocalDate();
            // Include moved occurrences outside the nominal term. The engine evaluates each original only once.
            JSONArray events = CourseEngine.occurrences(table, today, LocalDate.of(2200, 12, 31));
            int lead = state.getInt("leadMinutes"); Set<String> delivered = prefs.getStringSet("delivered", Collections.emptySet());
            Set<String> validNotices = new HashSet<>();
            for (int i = 0; i < events.length(); i++) if (events.getJSONObject(i).getLong("finish") > now) validNotices.add(token(events.getJSONObject(i), lead));
            clearNotices(validNotices);
            Set<String> next = new HashSet<>();
            try {
                for (int i = 0; i < events.length() && next.size() < 64; i++) {
                    JSONObject event = events.getJSONObject(i); long fire = event.getLong("begin") - lead * 60000L;
                    String receipt = token(event, lead), key = "at@" + fire;
                    if (fire <= now || received(delivered, receipt) || next.contains(key)) continue;
                    schedule(fire, pending(FIRE, key)); next.add(key);
                }
                if (!next.isEmpty()) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, now + 12 * 3600000L, pending(REFRESH, "refresh"));
            } catch (Exception error) {
                prefs.edit().putString("error", "课表已保存，但系统未完成提醒调度。请检查提醒权限并重试。").commit();
            } finally { prefs.edit().putStringSet("scheduled", next).commit(); }
        }
    }
    void deliverAt(long fire, long now) throws Exception {
        synchronized (CourseStore.LOCK) {
            JSONObject state = new CourseStore(context).read();
            if (!state.getBoolean("reminders") || !granted()) return;
            LocalDate date = Instant.ofEpochMilli(now).atZone(CourseEngine.ZONE).toLocalDate();
            JSONArray events = CourseEngine.occurrences(CourseEngine.table(state, state.getString("primaryId")), date.minusDays(1), date.plusDays(1));
            int lead = state.getInt("leadMinutes");
            // One wake-up for courses starting together avoids per-app idle alarm throttling.
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                if (event.getLong("begin") - lead * 60000L == fire) deliver(token(event, lead), now);
            }
        }
    }
    /** Re-read live rules before notifying: cancelled/moved/deleted/old-lead alarms are harmless. */
    boolean deliver(String key, long now) throws Exception {
        synchronized (CourseStore.LOCK) {
            JSONObject state = new CourseStore(context).read();
            if (!state.getBoolean("reminders") || !granted()) return false;
            Set<String> seen = new HashSet<>(prefs.getStringSet("delivered", Collections.emptySet()));
            if (received(seen, key)) return false;
            JSONObject table = CourseEngine.table(state, state.getString("primaryId"));
            LocalDate today = Instant.ofEpochMilli(now).atZone(CourseEngine.ZONE).toLocalDate();
            JSONArray events = CourseEngine.occurrences(table, today.minusDays(1), today.plusDays(1));
            int lead = state.getInt("leadMinutes");
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i); if (!token(event, lead).equals(key)) continue;
                long fire = event.getLong("begin") - lead * 60000L;
                // No backlog after a reboot or long power-off; an inexact alarm can still notify before class.
                if (now < fire || now > event.getLong("begin") + 60000L) return false;
                Intent open = new Intent(context, MainActivity.class).putExtra("courseTableId", table.getString("id"))
                    .putExtra("courseDate", event.getString("date")).putExtra("courseKey", event.getString("key"))
                    .setAction("cn.shike.study.OPEN_COURSE").setData(new Uri.Builder().scheme("shike-course").authority("open").appendPath(key).build())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                PendingIntent click = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                String time = Instant.ofEpochMilli(event.getLong("begin")).atZone(CourseEngine.ZONE).format(DateTimeFormatter.ofPattern("HH:mm"));
                String detail = time + " · 第 " + event.getInt("start") + "–" + event.getInt("end") + " 节" + (event.optString("room").isEmpty() ? "" : " · " + event.getString("room"));
                Notification notice = new Notification.Builder(context, CHANNEL).setSmallIcon(cn.shike.study.R.drawable.course_notification)
                    .setContentTitle(event.getString("name")).setContentText(detail).setStyle(new Notification.BigTextStyle().bigText(detail))
                    .setCategory(Notification.CATEGORY_EVENT).setContentIntent(click).setAutoCancel(true)
                    .setTimeoutAfter(Math.max(60000L, event.getLong("finish") - now)).build();
                notifications.notify(key, 0, notice);
                seen.add(key);
                // Old deliveries can no longer pass the time check, so keep only recent receipts.
                seen.removeIf(receipt -> {
                    try { int last = receipt.lastIndexOf('@'), before = receipt.lastIndexOf('@', last - 1); return Long.parseLong(receipt.substring(before + 1, last)) < now - 2 * 86400000L; }
                    catch (RuntimeException invalid) { return true; }
                });
                prefs.edit().putStringSet("delivered", seen).commit(); return true;
            }
            return false;
        }
    }
}
