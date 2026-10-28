package cn.shike.study;

import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;

/** One occurrence calculation for the week view, exceptions and Android alarms. */
final class CourseEngine {
    static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    static JSONObject empty() throws Exception {
        return new JSONObject().put("schema", 1).put("revision", 0).put("tables", new JSONArray())
            .put("primaryId", "").put("reminders", false).put("leadMinutes", 10);
    }
    static void require(boolean ok, String message) { if (!ok) throw new IllegalArgumentException(message); }
    static String text(JSONObject obj, String key, int max) {
        String value = obj.optString(key, "").trim();
        require(value.length() <= max, "课程字段过长：" + key); return value;
    }
    static int number(JSONObject obj, String key, int min, int max) throws Exception {
        double value = obj.getDouble(key);
        require(Double.isFinite(value) && value == Math.floor(value) && value >= min && value <= max, "课程字段无效：" + key);
        return (int)value;
    }
    static String id(JSONObject obj) {
        String id = text(obj, "id", 80); require(id.matches("[A-Za-z0-9_-]{1,80}"), "课程标识无效。"); return id;
    }
    static JSONObject table(JSONObject state, String id) throws Exception {
        JSONArray tables = state.getJSONArray("tables");
        for (int i = 0; i < tables.length(); i++) if (id.equals(tables.getJSONObject(i).getString("id"))) return tables.getJSONObject(i);
        throw new IllegalArgumentException("课表不存在，请重新打开。");
    }
    static JSONObject course(JSONObject table, String id) throws Exception {
        JSONArray courses = table.getJSONArray("courses");
        for (int i = 0; i < courses.length(); i++) if (id.equals(courses.getJSONObject(i).getString("id"))) return courses.getJSONObject(i);
        throw new IllegalArgumentException("课程不存在，请重新打开。");
    }
    static boolean scheduled(JSONObject course) throws Exception {
        return course.getInt("day") > 0 && course.getInt("start") > 0 && course.getJSONArray("weeks").length() > 0;
    }
    static void validate(JSONObject state) throws Exception {
        require(state.getInt("schema") == 1, "课表数据版本不受支持。");
        number(state, "leadMinutes", 0, 120);
        JSONArray tables = state.getJSONArray("tables"); require(tables.length() <= 30, "最多保留 30 份课表。");
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < tables.length(); i++) {
            JSONObject t = tables.getJSONObject(i); require(ids.add(id(t)), "课表标识重复。");
            require(!text(t, "name", 80).isEmpty(), "请填写课表名称。");
            LocalDate first = LocalDate.parse(t.getString("firstMonday"));
            require(first.getDayOfWeek().getValue() == 1 && first.getYear() >= 2000 && first.getYear() <= 2200, "开学日期应为第一教学周的星期一。");
            int maxWeek = number(t, "maxWeeks", 1, 60);
            JSONArray periods = t.getJSONArray("periods"); require(periods.length() > 0 && periods.length() <= 20, "请设置 1 至 20 节作息。");
            if (t.has("lessonMinutes")) number(t, "lessonMinutes", 5, 180);
            if (t.has("periodGroups")) {
                JSONObject groups = t.getJSONObject("periodGroups");
                int total = number(groups, "morning", 0, 20) + number(groups, "afternoon", 0, 20) + number(groups, "evening", 0, 20);
                require(total == periods.length(), "各时段节数之和应与作息总节数一致。");
            }
            LocalTime previous = LocalTime.MIN;
            for (int p = 0; p < periods.length(); p++) {
                JSONObject period = periods.getJSONObject(p);
                LocalTime start = LocalTime.parse(period.getString("start")), end = LocalTime.parse(period.getString("end"));
                require(start.isBefore(end) && !start.isBefore(previous), "节次时间应递增，且下课时间晚于上课时间。"); previous = end;
            }
            JSONArray courses = t.getJSONArray("courses"); require(courses.length() <= 500, "单份课表最多 500 个上课安排。");
            Set<String> courseIds = new HashSet<>();
            for (int c = 0; c < courses.length(); c++) {
                JSONObject course = courses.getJSONObject(c); require(courseIds.add(id(course)), "课程标识重复。");
                require(!text(course, "name", 120).isEmpty(), "请填写课程名称。");
                text(course, "teacher", 120); text(course, "room", 160); text(course, "notes", 2000);
                number(course, "day", 0, 7); int start = number(course, "start", 0, periods.length()), end = number(course, "end", 0, periods.length());
                require((start == 0 && end == 0) || (start > 0 && end >= start), "结束节次不能早于开始节次。");
                JSONArray weeks = course.getJSONArray("weeks"); Set<Integer> seen = new HashSet<>();
                for (int w = 0; w < weeks.length(); w++) {
                    double value = weeks.getDouble(w); require(value == Math.floor(value) && value >= 1 && value <= maxWeek && seen.add((int)value), "课程周次超出学期范围或重复。");
                }
            }
            JSONArray changes = t.getJSONArray("changes"); require(changes.length() <= 2000, "调课记录过多。"); Set<String> changed = new HashSet<>();
            for (int c = 0; c < changes.length(); c++) {
                JSONObject change = changes.getJSONObject(c); String courseId = change.getString("courseId");
                JSONObject course = course(t, courseId); LocalDate date = LocalDate.parse(change.getString("date"));
                require(isOriginal(t, course, date), "调课记录对应的原课程已改变，请先撤销调课再编辑课程或学期。");
                require(changed.add(courseId + "/" + date), "同一次上课存在重复调课记录。");
                String type = change.getString("type"); require(type.equals("cancel") || type.equals("move"), "调课类型无效。");
                if (type.equals("move")) {
                    LocalDate target = LocalDate.parse(change.getString("targetDate"));
                    require(target.getYear() >= 2000 && target.getYear() <= 2200, "调课日期无效。");
                    int start = number(change, "start", 1, periods.length()); number(change, "end", start, periods.length()); text(change, "room", 160);
                }
            }
        }
        require(state.optString("primaryId", "").isEmpty() || ids.contains(state.getString("primaryId")), "提醒课表不存在。");
        require(!state.optBoolean("reminders") || !state.optString("primaryId", "").isEmpty(), "请先选择提醒课表。");
    }
    static boolean isOriginal(JSONObject table, JSONObject course, LocalDate date) throws Exception {
        long days = ChronoUnit.DAYS.between(LocalDate.parse(table.getString("firstMonday")), date);
        if (days < 0 || date.getDayOfWeek().getValue() != course.getInt("day")) return false;
        long week = days / 7 + 1;
        JSONArray weeks = course.getJSONArray("weeks");
        for (int w = 0; w < weeks.length(); w++) if (weeks.getInt(w) == week) return course.getInt("start") > 0;
        return false;
    }
    static JSONObject occurrence(JSONObject t, JSONObject c, LocalDate original, LocalDate actual, int start, int end, String room, boolean changed) throws Exception {
        JSONArray periods = t.getJSONArray("periods");
        return new JSONObject().put("key", t.getString("id") + "/" + c.getString("id") + "/" + original)
            .put("tableId", t.getString("id")).put("courseId", c.getString("id")).put("name", c.getString("name"))
            .put("teacher", c.optString("teacher")).put("notes", c.optString("notes")).put("room", room)
            .put("originalDate", original.toString()).put("date", actual.toString()).put("start", start).put("end", end).put("changed", changed)
            .put("begin", actual.atTime(LocalTime.parse(periods.getJSONObject(start - 1).getString("start"))).atZone(ZONE).toInstant().toEpochMilli())
            .put("finish", actual.atTime(LocalTime.parse(periods.getJSONObject(end - 1).getString("end"))).atZone(ZONE).toInstant().toEpochMilli());
    }
    static JSONArray occurrences(JSONObject t, LocalDate from, LocalDate through) throws Exception {
        ArrayList<JSONObject> result = new ArrayList<>();
        JSONArray courses = t.getJSONArray("courses"), changes = t.getJSONArray("changes");
        LocalDate first = LocalDate.parse(t.getString("firstMonday"));
        for (int c = 0; c < courses.length(); c++) {
            JSONObject course = courses.getJSONObject(c); if (!scheduled(course)) continue;
            JSONArray weeks = course.getJSONArray("weeks");
            for (int w = 0; w < weeks.length(); w++) {
                LocalDate original = first.plusWeeks(weeks.getInt(w) - 1).plusDays(course.getInt("day") - 1);
                LocalDate actual = original; int start = course.getInt("start"), end = course.getInt("end"); String room = course.optString("room"); boolean moved = false, cancelled = false;
                for (int k = 0; k < changes.length(); k++) {
                    JSONObject change = changes.getJSONObject(k);
                    if (!course.getString("id").equals(change.getString("courseId")) || !original.toString().equals(change.getString("date"))) continue;
                    cancelled = change.getString("type").equals("cancel");
                    if (!cancelled) { actual = LocalDate.parse(change.getString("targetDate")); start = change.getInt("start"); end = change.getInt("end"); room = change.optString("room"); moved = true; }
                    break;
                }
                if (!cancelled && !actual.isBefore(from) && !actual.isAfter(through)) result.add(occurrence(t, course, original, actual, start, end, room, moved));
            }
        }
        result.sort(Comparator.comparingLong(o -> o.optLong("begin")));
        return new JSONArray(result);
    }
}
