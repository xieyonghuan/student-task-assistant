package cn.shike.study;

import android.content.Context;
import android.app.NotificationManager;
import android.os.ParcelFileDescriptor;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.time.LocalDate;
import java.time.DayOfWeek;
import java.time.temporal.TemporalAdjusters;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class CourseIntegrationTest {
    private Context context;
    private CourseStore store;
    private JSONObject original;
    private JSONObject fixture() throws Exception {
        JSONObject table = new JSONObject().put("id", "table-test").put("name", "测试课表").put("firstMonday", "2026-10-26").put("maxWeeks", 20)
            .put("periods", new JSONArray("[{\"start\":\"08:00\",\"end\":\"08:45\"},{\"start\":\"08:55\",\"end\":\"09:40\"},{\"start\":\"10:00\",\"end\":\"10:45\"},{\"start\":\"10:55\",\"end\":\"11:40\"}]"))
            .put("courses", new JSONArray().put(new JSONObject().put("id", "course-test").put("name", "运筹学").put("teacher", "张老师").put("room", "A201")
                .put("day", 1).put("start", 1).put("end", 2).put("weeks", new JSONArray("[1,3,5]")).put("notes", "测试")))
            .put("changes", new JSONArray());
        return CourseEngine.empty().put("tables", new JSONArray().put(table)).put("primaryId", "table-test");
    }
    @Before public void before() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext(); store = new CourseStore(context); original = store.read();
    }
    @After public void after() throws Exception {
        store.replace(original, store.read().getLong("revision"));
        new CourseAlarms(context).rebuild();
        context.getSystemService(NotificationManager.class).cancelAll();
    }
    private void shell(String command) throws Exception {
        try (ParcelFileDescriptor fd = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
             java.io.FileInputStream input = new java.io.FileInputStream(fd.getFileDescriptor())) { byte[] bytes = new byte[1024]; while (input.read(bytes) != -1) { } }
    }
    @Test public void oddWeeksAndUnscheduledCoursesUseChinaTimeWithoutDuplicateMeetings() throws Exception {
        JSONObject state = fixture(); CourseEngine.validate(state); JSONObject table = CourseEngine.table(state, "table-test");
        JSONArray first = CourseEngine.occurrences(table, LocalDate.parse("2026-10-26"), LocalDate.parse("2026-11-08"));
        assertEquals(1, first.length()); assertEquals(1792972800000L, first.getJSONObject(0).getLong("begin"));
        assertEquals(0, CourseEngine.occurrences(table, LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-08")).length());
        JSONObject second = new JSONObject(table.getJSONArray("courses").getJSONObject(0).toString()).put("id", "second-time").put("day", 3);
        table.getJSONArray("courses").put(second);
        table.getJSONArray("courses").put(new JSONObject(second.toString()).put("id", "unplaced").put("day", 0).put("weeks", new JSONArray()));
        CourseEngine.validate(state);
        assertEquals(2, CourseEngine.occurrences(table, LocalDate.parse("2026-10-26"), LocalDate.parse("2026-11-01")).length());
    }
    @Test public void moveAcrossWeeksCancelAndUndoEachAffectOnlyOneOriginalOccurrence() throws Exception {
        JSONObject state = fixture(), table = CourseEngine.table(state, "table-test");
        JSONObject change = new JSONObject().put("courseId", "course-test").put("date", "2026-10-26").put("type", "move")
            .put("targetDate", "2026-11-04").put("start", 3).put("end", 4).put("room", "B102");
        table.getJSONArray("changes").put(change); CourseEngine.validate(state);
        assertEquals(0, CourseEngine.occurrences(table, LocalDate.parse("2026-10-26"), LocalDate.parse("2026-11-01")).length());
        JSONObject moved = CourseEngine.occurrences(table, LocalDate.parse("2026-11-02"), LocalDate.parse("2026-11-08")).getJSONObject(0);
        assertEquals("2026-10-26", moved.getString("originalDate")); assertEquals(3, moved.getInt("start")); assertEquals("B102", moved.getString("room"));
        assertEquals(1, CourseEngine.occurrences(table, LocalDate.parse("2026-11-09"), LocalDate.parse("2026-11-15")).length());
        change.put("type", "cancel"); CourseEngine.validate(state);
        assertEquals(0, CourseEngine.occurrences(table, LocalDate.parse("2026-10-26"), LocalDate.parse("2026-11-08")).length());
        table.put("changes", new JSONArray());
        assertEquals(1, CourseEngine.occurrences(table, LocalDate.parse("2026-10-26"), LocalDate.parse("2026-11-01")).length());
    }
    @Test public void durableAtomicStoreRejectsStaleAndInvalidSnapshotsWithoutLosingData() throws Exception {
        JSONObject saved = store.replace(fixture(), original.getLong("revision"));
        assertEquals("运筹学", CourseEngine.table(new CourseStore(context).read(), "table-test").getJSONArray("courses").getJSONObject(0).getString("name"));
        try { store.replace(fixture(), original.getLong("revision")); fail("Stale revision must fail"); } catch (IllegalArgumentException expected) { }
        JSONObject invalid = fixture(); CourseEngine.table(invalid, "table-test").getJSONArray("courses").getJSONObject(0).put("end", 9);
        try { store.replace(invalid, saved.getLong("revision")); fail("Invalid snapshot must fail"); } catch (IllegalArgumentException expected) { }
        assertEquals(saved.toString(), store.read().toString());
    }
    @Test public void changedRulesCannotLeaveOrphanedExceptions() throws Exception {
        JSONObject state = fixture(), table = CourseEngine.table(state, "table-test");
        table.getJSONArray("changes").put(new JSONObject().put("courseId", "course-test").put("date", "2026-10-26").put("type", "cancel"));
        table.getJSONArray("courses").getJSONObject(0).put("day", 2);
        try { CourseEngine.validate(state); fail("Orphaned change must fail"); } catch (IllegalArgumentException expected) { }
        table.put("changes", new JSONArray()); CourseEngine.validate(state);
    }
    @Test public void actualAlarmsPermissionCancellationReceiptsAndStaleDeliveryWork() throws Exception {
        shell("pm grant cn.shike.study android.permission.POST_NOTIFICATIONS");
        shell("appops set cn.shike.study SCHEDULE_EXACT_ALARM allow");
        JSONObject state = fixture(), table = CourseEngine.table(state, "table-test");
        LocalDate next = LocalDate.now(CourseEngine.ZONE).plusWeeks(1).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        table.put("firstMonday", next.toString()); state.put("reminders", true);
        store.replace(state, store.read().getLong("revision"));
        CourseAlarms alarms = new CourseAlarms(context); alarms.rebuild();
        assertTrue(alarms.status().getBoolean("granted")); assertEquals(3, alarms.status().getInt("scheduled"));
        JSONObject event = CourseEngine.occurrences(table, next, next.plusDays(6)).getJSONObject(0);
        String oldToken = CourseAlarms.token(event, 10);
        assertFalse(alarms.deliver(oldToken, event.getLong("begin") - 11 * 60000));
        JSONObject changed = store.read(); CourseEngine.table(changed, "table-test").getJSONArray("changes").put(new JSONObject()
            .put("courseId", "course-test").put("date", next.toString()).put("type", "move").put("targetDate", next.plusDays(1).toString()).put("start", 3).put("end", 4).put("room", "新教室"));
        store.replace(changed, changed.getLong("revision")); alarms.rebuild();
        assertFalse(alarms.deliver(oldToken, event.getLong("begin") - 10 * 60000));
        JSONObject moved = CourseEngine.occurrences(CourseEngine.table(store.read(), "table-test"), next, next.plusDays(6)).getJSONObject(0);
        String newToken = CourseAlarms.token(moved, 10);
        assertTrue(alarms.deliver(newToken, moved.getLong("begin") - 10 * 60000));
        assertFalse(new CourseAlarms(context).deliver(newToken, moved.getLong("begin") - 10 * 60000));
        changed = store.read(); changed.put("reminders", false); store.replace(changed, changed.getLong("revision")); alarms.rebuild();
        assertEquals(0, alarms.status().getInt("scheduled"));
        assertFalse(alarms.deliver(newToken, moved.getLong("begin")));
    }
    @Test public void systemAlarmActuallyDeliversOneNotificationWhileNoWebViewIsOpen() throws Exception {
        shell("pm grant cn.shike.study android.permission.POST_NOTIFICATIONS");
        shell("appops set cn.shike.study SCHEDULE_EXACT_ALARM allow");
        java.time.ZonedDateTime begin = java.time.ZonedDateTime.now(CourseEngine.ZONE).plusMinutes(1).withSecond(0).withNano(0);
        if (begin.toInstant().toEpochMilli() - System.currentTimeMillis() < 10000) begin = begin.plusMinutes(1);
        JSONObject state = fixture(), table = CourseEngine.table(state, "table-test");
        LocalDate date = begin.toLocalDate();
        table.put("firstMonday", date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).toString());
        table.put("periods", new JSONArray().put(new JSONObject().put("start", begin.toLocalTime().toString()).put("end", begin.plusMinutes(10).toLocalTime().toString())));
        table.getJSONArray("courses").getJSONObject(0).put("id", "real-alarm").put("day", date.getDayOfWeek().getValue()).put("start", 1).put("end", 1).put("weeks", new JSONArray("[1]"));
        state.put("reminders", true).put("leadMinutes", 0); store.replace(state, store.read().getLong("revision"));
        CourseAlarms alarms = new CourseAlarms(context); alarms.rebuild(); assertTrue(alarms.status().getBoolean("exact"));
        JSONObject event = CourseEngine.occurrences(table, date, date).getJSONObject(0); String key = CourseAlarms.token(event, 0);
        long until = begin.toInstant().toEpochMilli() + 15000; boolean found = false;
        while (System.currentTimeMillis() < until && !found) {
            for (android.service.notification.StatusBarNotification notice : context.getSystemService(NotificationManager.class).getActiveNotifications())
                if (key.equals(notice.getTag())) { found = true; assertEquals("运筹学", notice.getNotification().extras.getString(android.app.Notification.EXTRA_TITLE)); }
            if (!found) Thread.sleep(250);
        }
        assertTrue("AlarmManager must deliver a notification without WebView timers", found);
        assertFalse(alarms.deliver(key, System.currentTimeMillis()));
    }
}
