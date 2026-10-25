package cn.shike.study;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.provider.CalendarContract.Events;
import android.provider.CalendarContract.Reminders;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.HashSet;
import java.util.Set;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class CalendarIntegrationTest {
    private Context context;
    private CalendarStore store;
    private final long deadline = 1793289600000L;
    @Before public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        for (String permission : new String[]{"READ_CALENDAR", "WRITE_CALENDAR"}) {
            try (android.os.ParcelFileDescriptor result = InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .executeShellCommand("pm grant " + context.getPackageName() + " android.permission." + permission)) {
                try (java.io.InputStream stream = new android.os.ParcelFileDescriptor.AutoCloseInputStream(result)) { stream.readAllBytes(); }
            }
        }
        store = new CalendarStore(context); store.enable(); store.sync(new JSONArray());
    }
    private JSONObject task(String id, String title, boolean completed) throws Exception {
        return new JSONObject().put("id", id).put("title", title).put("details", "写出计算过程")
            .put("begin", deadline).put("dateOnly", true).put("completed", completed);
    }
    private long eventId(String id) {
        try (Cursor rows = context.getContentResolver().query(Events.CONTENT_URI, new String[]{Events._ID},
            Events.CALENDAR_ID + "=? AND " + Events.CUSTOM_APP_URI + "=? AND " + Events.DELETED + "=0",
            new String[]{String.valueOf(store.calendarId()), "shike://task/" + id}, null)) {
            assertNotNull(rows); return rows.moveToFirst() ? rows.getLong(0) : -1;
        }
    }
    private Set<Integer> alarms(long event) {
        Set<Integer> result = new HashSet<>();
        try (Cursor rows = context.getContentResolver().query(Reminders.CONTENT_URI, new String[]{Reminders.MINUTES}, Reminders.EVENT_ID + "=?", new String[]{String.valueOf(event)}, null)) {
            assertNotNull(rows); while (rows.moveToNext()) result.add(rows.getInt(0));
        }
        return result;
    }
    @Test public void createsUpdatesCompletesRestoresAndRemovesWithoutDuplicates() throws Exception {
        JSONArray tasks = new JSONArray().put(task("math", "数学第三章习题", false));
        assertEquals(1, store.sync(tasks).getInt("written")); long id = eventId("math"); assertTrue(id > 0);
        assertEquals(Set.of(4320, 1440, 300, 60), alarms(id));
        assertEquals(0, store.sync(tasks).getInt("written")); assertEquals(id, eventId("math"));
        JSONObject changed = task("math", "修改后的数学作业", false).put("begin", deadline + 86400000);
        store.sync(new JSONArray().put(changed)); assertEquals(id, eventId("math"));
        try (Cursor row = context.getContentResolver().query(Events.CONTENT_URI, new String[]{Events.TITLE, Events.DTSTART, Events.EVENT_TIMEZONE, Events.ALL_DAY}, Events._ID + "=?", new String[]{String.valueOf(id)}, null)) {
            assertTrue(row.moveToFirst()); assertEquals("修改后的数学作业", row.getString(0));
            assertEquals(deadline + 86400000, row.getLong(1)); assertEquals("Asia/Shanghai", row.getString(2)); assertEquals(0, row.getInt(3));
        }
        store.sync(new JSONArray().put(changed.put("completed", true))); assertTrue(alarms(id).isEmpty());
        store.sync(new JSONArray().put(changed.put("completed", false))); assertEquals(4, alarms(id).size());
        store.sync(new JSONArray()); assertEquals(-1, eventId("math"));
        store.sync(tasks); assertTrue(eventId("math") > 0);
        store.sync(new JSONArray());
    }
    @Test public void ignoresUnownedEventsAndValidatesSnapshotBeforeDeletion() throws Exception {
        store.sync(new JSONArray().put(task("keep", "保留任务", false))); long keep = eventId("keep");
        ContentValues manual = new ContentValues(); manual.put(Events.CALENDAR_ID, store.calendarId()); manual.put(Events.TITLE, "手动添加的其他日程");
        manual.put(Events.DTSTART, deadline); manual.put(Events.DTEND, deadline + 60000); manual.put(Events.EVENT_TIMEZONE, "Asia/Shanghai");
        android.net.Uri uri = context.getContentResolver().insert(Events.CONTENT_URI, manual); assertNotNull(uri);
        try { store.sync(new JSONArray().put(task("bad", "", false))); fail("Invalid snapshot should fail"); } catch (IllegalArgumentException expected) { }
        assertEquals(keep, eventId("keep"));
        store.sync(new JSONArray());
        try (Cursor row = context.getContentResolver().query(uri, new String[]{Events.TITLE, Events.DELETED}, null, null, null)) {
            assertTrue(row.moveToFirst()); assertEquals("手动添加的其他日程", row.getString(0)); assertEquals(0, row.getInt(1));
        }
        context.getContentResolver().delete(uri, null, null);
    }
    @Test public void pausePersistsExistingEventsUntilExplicitlyEnabledAgain() throws Exception {
        JSONArray tasks = new JSONArray().put(task("pause", "任务", false));
        store.sync(tasks); long id = eventId("pause"); store.disable();
        assertFalse(store.sync(new JSONArray()).getBoolean("enabled")); assertEquals(id, eventId("pause"));
        CalendarStore reopened = new CalendarStore(context); assertFalse(reopened.status().getBoolean("enabled"));
        reopened.enable(); reopened.sync(new JSONArray()); assertEquals(-1, eventId("pause"));
    }
}
