package cn.shike.study;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

/** Timetables are native authoritative data; task IndexedDB remains untouched. */
final class CourseStore {
    static final Object LOCK = new Object();
    private final AtomicFile file;
    CourseStore(Context context) { file = new AtomicFile(new File(context.getFilesDir(), "course-tables-v1.json")); }
    JSONObject read() throws Exception {
        synchronized (LOCK) {
            if (!file.getBaseFile().exists() && !new File(file.getBaseFile() + ".bak").exists()) return CourseEngine.empty();
            JSONObject state = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
            CourseEngine.validate(state); return state;
        }
    }
    JSONObject replace(JSONObject next, long revision) throws Exception {
        synchronized (LOCK) {
            JSONObject old = read();
            CourseEngine.require(old.getLong("revision") == revision, "课表刚刚发生变化，请重新打开后再保存。");
            // Keep only the supported root fields. A snapshot never includes credentials or screenshots.
            JSONObject state = new JSONObject().put("schema", 1).put("revision", revision + 1)
                .put("tables", next.getJSONArray("tables")).put("primaryId", next.optString("primaryId", ""))
                .put("leadMinutes", next.getInt("leadMinutes")).put("reminders", next.getBoolean("reminders"));
            CourseEngine.validate(state); byte[] bytes = state.toString().getBytes(StandardCharsets.UTF_8);
            CourseEngine.require(bytes.length <= 5000000, "课表数据过大，请减少课表数量。");
            FileOutputStream stream = null;
            try { stream = file.startWrite(); stream.write(bytes); file.finishWrite(stream); }
            catch (Exception error) { if (stream != null) file.failWrite(stream); throw error; }
            return state;
        }
    }
    JSONObject week(String id, String date) throws Exception {
        LocalDate from = LocalDate.parse(date);
        JSONObject t = CourseEngine.table(read(), id);
        return new JSONObject().put("occurrences", CourseEngine.occurrences(t, from, from.plusDays(6)));
    }
}
