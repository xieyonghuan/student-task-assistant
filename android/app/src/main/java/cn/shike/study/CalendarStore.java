package cn.shike.study;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Calendars;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Reminders;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** All writes are scoped to our local calendar and tagged events, never other calendars. */
public final class CalendarStore {
    static final String ACCOUNT = "shike.local";
    static final String NAME = "拾课 · 学习任务";
    static final int[] ALERTS = {4320, 1440, 300, 60};
    private final Context context;
    private final ContentResolver resolver;
    private final SharedPreferences preferences;
    public CalendarStore(Context context) {
        this.context = context;
        resolver = context.getContentResolver();
        preferences = context.getSharedPreferences("calendar-sync", Context.MODE_PRIVATE);
    }
    boolean granted() {
        return context.checkSelfPermission(Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
            && context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED;
    }
    public JSONObject status() throws Exception {
        return new JSONObject().put("available", context.getPackageManager().resolveContentProvider(CalendarContract.AUTHORITY, 0) != null)
            .put("enabled", preferences.getBoolean("enabled", false)).put("granted", granted()).put("calendarName", NAME);
    }
    public JSONObject enable() throws Exception {
        if (!granted()) throw new SecurityException("请允许日历权限后再开启。任务仍保存在拾课中。");
        calendarId();
        preferences.edit().putBoolean("enabled", true).commit();
        return status();
    }
    public JSONObject disable() throws Exception {
        preferences.edit().putBoolean("enabled", false).commit();
        return status();
    }
    private Uri adapterUri(Uri uri) {
        return uri.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
            .appendQueryParameter(Calendars.ACCOUNT_NAME, ACCOUNT)
            .appendQueryParameter(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL).build();
    }
    long calendarId() {
        try (Cursor cursor = resolver.query(Calendars.CONTENT_URI, new String[]{Calendars._ID},
                Calendars.ACCOUNT_NAME + "=? AND " + Calendars.ACCOUNT_TYPE + "=? AND " + Calendars.NAME + "=?",
                new String[]{ACCOUNT, CalendarContract.ACCOUNT_TYPE_LOCAL, "shike-tasks"}, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getLong(0);
        }
        ContentValues values = new ContentValues();
        values.put(Calendars.ACCOUNT_NAME, ACCOUNT); values.put(Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
        values.put(Calendars.NAME, "shike-tasks"); values.put(Calendars.CALENDAR_DISPLAY_NAME, NAME);
        values.put(Calendars.CALENDAR_COLOR, 0xff7b7ce8); values.put(Calendars.CALENDAR_ACCESS_LEVEL, Calendars.CAL_ACCESS_OWNER);
        values.put(Calendars.OWNER_ACCOUNT, ACCOUNT); values.put(Calendars.VISIBLE, 1); values.put(Calendars.SYNC_EVENTS, 1);
        values.put(Calendars.CALENDAR_TIME_ZONE, "Asia/Shanghai"); values.put(Calendars.ALLOWED_REMINDERS, "1");
        values.put(Calendars.MAX_REMINDERS, 4);
        Uri created = resolver.insert(adapterUri(Calendars.CONTENT_URI), values);
        if (created == null) throw new IllegalStateException("系统未能建立拾课本地日历，请检查日历服务。");
        return ContentUris.parseId(created);
    }
    private String marker(String id) { return "shike://task/" + Uri.encode(id); }
    private String ownSelection() { return Events.CALENDAR_ID + "=? AND " + Events.CUSTOM_APP_PACKAGE + "=?"; }
    private String[] ownArgs(long calendar) { return new String[]{String.valueOf(calendar), context.getPackageName()}; }
    private Map<String, List<Long>> ownedEvents(long calendar) {
        Map<String, List<Long>> map = new HashMap<>();
        try (Cursor cursor = resolver.query(Events.CONTENT_URI, new String[]{Events._ID, Events.CUSTOM_APP_URI}, ownSelection() + " AND " + Events.DELETED + "=0", ownArgs(calendar), null)) {
            if (cursor != null) while (cursor.moveToNext()) {
                String key = cursor.getString(1);
                if (key != null && key.startsWith("shike://task/")) map.computeIfAbsent(key, ignored -> new ArrayList<>()).add(cursor.getLong(0));
            }
        }
        return map;
    }
    private void remove(long id, long calendar) {
        resolver.delete(adapterUri(Events.CONTENT_URI), Events._ID + "=? AND " + ownSelection(), new String[]{String.valueOf(id), String.valueOf(calendar), context.getPackageName()});
    }
    public JSONObject sync(JSONArray tasks) throws Exception {
        if (!preferences.getBoolean("enabled", false)) return new JSONObject().put("enabled", false);
        if (!granted()) throw new SecurityException("日历权限已关闭，请在设置中重新授权并同步。");
        if (tasks == null || tasks.length() > 10000) throw new IllegalArgumentException("任务列表无效。");
        // Validate the entire snapshot before any insertion or removal.
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject task = tasks.getJSONObject(i);
            String id = task.getString("id"), title = task.getString("title");
            long begin = task.getLong("begin");
            if (id.trim().isEmpty() || id.length() > 512 || !ids.add(id) || title.trim().isEmpty() || title.length() > 500
                    || begin < 946656000000L || begin > 7289625599999L || task.optString("details").length() > 30000)
                throw new IllegalArgumentException("任务日期或内容无效，尚未执行日历同步。");
        }
        long calendar = calendarId();
        Map<String, List<Long>> existing = ownedEvents(calendar);
        int written = 0, removed = 0;
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject task = tasks.getJSONObject(i);
            String key = marker(task.getString("id"));
            List<Long> found = existing.remove(key);
            Long eventId = found == null ? null : found.get(0);
            boolean completed = task.optBoolean("completed");
            ContentValues values = new ContentValues();
            values.put(Events.CALENDAR_ID, calendar);
            values.put(Events.TITLE, (completed ? "已完成 · " : "") + task.getString("title"));
            values.put(Events.DESCRIPTION, task.optString("details") + (task.optBoolean("dateOnly") ? "\n仅记录日期，按当天 00:00（中国标准时间）截止。" : ""));
            values.put(Events.DTSTART, task.getLong("begin")); values.put(Events.DTEND, task.getLong("begin") + 60000);
            values.put(Events.EVENT_TIMEZONE, "Asia/Shanghai"); values.put(Events.ALL_DAY, 0);
            values.put(Events.AVAILABILITY, Events.AVAILABILITY_FREE); values.put(Events.STATUS, Events.STATUS_CONFIRMED);
            values.put(Events.HAS_ALARM, completed ? 0 : 1);
            values.put(Events.CUSTOM_APP_PACKAGE, context.getPackageName()); values.put(Events.CUSTOM_APP_URI, key);
            if (!matches(eventId, values)) {
                ArrayList<ContentProviderOperation> ops = new ArrayList<>();
                if (eventId == null) ops.add(ContentProviderOperation.newInsert(Events.CONTENT_URI).withValues(values).build());
                else {
                    ops.add(ContentProviderOperation.newUpdate(Events.CONTENT_URI)
                        .withSelection(Events._ID + "=? AND " + ownSelection(), new String[]{eventId.toString(), String.valueOf(calendar), context.getPackageName()}).withValues(values).withExpectedCount(1).build());
                    ops.add(ContentProviderOperation.newDelete(Reminders.CONTENT_URI).withSelection(Reminders.EVENT_ID + "=?", new String[]{eventId.toString()}).build());
                }
                if (!completed) for (int minute : ALERTS) {
                    ContentProviderOperation.Builder alert = ContentProviderOperation.newInsert(Reminders.CONTENT_URI)
                        .withValue(Reminders.MINUTES, minute).withValue(Reminders.METHOD, Reminders.METHOD_ALERT);
                    if (eventId == null) alert.withValueBackReference(Reminders.EVENT_ID, 0); else alert.withValue(Reminders.EVENT_ID, eventId);
                    ops.add(alert.build());
                }
                resolver.applyBatch(CalendarContract.AUTHORITY, ops); written++;
            }
            if (found != null) for (int j = 1; j < found.size(); j++) { remove(found.get(j), calendar); removed++; }
        }
        for (List<Long> stale : existing.values()) for (Long id : stale) { remove(id, calendar); removed++; }
        return new JSONObject().put("enabled", true).put("written", written).put("removed", removed).put("total", tasks.length());
    }
    private boolean matches(Long id, ContentValues expected) {
        if (id == null) return false;
        String[] columns = expected.keySet().toArray(new String[0]);
        try (Cursor cursor = resolver.query(ContentUris.withAppendedId(Events.CONTENT_URI, id), columns, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) return false;
            for (int i = 0; i < columns.length; i++) if (!String.valueOf(expected.get(columns[i])).equals(cursor.getString(i))) return false;
        }
        Set<Integer> alarms = new HashSet<>();
        try (Cursor cursor = resolver.query(Reminders.CONTENT_URI, new String[]{Reminders.MINUTES, Reminders.METHOD}, Reminders.EVENT_ID + "=?", new String[]{id.toString()}, null)) {
            if (cursor != null) while (cursor.moveToNext()) { if (cursor.getInt(1) != Reminders.METHOD_ALERT) return false; alarms.add(cursor.getInt(0)); }
        }
        Set<Integer> wanted = new HashSet<>();
        if (expected.getAsInteger(Events.HAS_ALARM) == 1) for (int value : ALERTS) wanted.add(value);
        return alarms.equals(wanted);
    }
}
