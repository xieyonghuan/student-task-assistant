package cn.shike.study;

import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Owns temporary copies while the sender's URI grant is still valid. */
final class ShareStore {
    static final int MAX_FILES = 20;
    static final long MAX_FILE = 20L * 1024 * 1024, MAX_BATCH = 100L * 1024 * 1024;
    static File root(Context context) { File root = new File(context.getFilesDir(), "share-inbox"); root.mkdirs(); return root; }
    static boolean supported(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction(), type = intent.getType();
        boolean imageHint = type == null || type.startsWith("image/") || "application/octet-stream".equals(type) || "*/*".equals(type);
        return (Intent.ACTION_SEND.equals(action) && ("text/plain".equals(type) || imageHint))
            || (Intent.ACTION_SEND_MULTIPLE.equals(action) && imageHint)
            || (Intent.ACTION_VIEW.equals(action) && imageHint && intent.getData() != null);
    }
    static synchronized String receive(Context context, Intent intent) throws Exception {
        if (!supported(intent)) throw new IllegalArgumentException("请选择文字或课程截图分享到拾课。");
        File root = root(context);
        // A process killed before its atomic manifest commit leaves no usable item.
        for (File file : Objects.requireNonNull(root.listFiles())) {
            if (file.isDirectory() && !new File(file, "item.json").isFile()) remove(file);
        }
        File[] items = root.listFiles(File::isDirectory);
        long occupied = 0;
        for (File item : items) for (File file : Objects.requireNonNull(item.listFiles())) occupied += file.length();
        if (items.length >= 20 || occupied >= 200L * 1024 * 1024) throw new IllegalStateException("待处理分享较多，请先在拾课保存或放弃已有导入草稿，再重试。");
        CharSequence raw = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (raw == null && "text/plain".equals(intent.getType()) && intent.getClipData() != null && intent.getClipData().getItemCount() > 0)
            raw = intent.getClipData().getItemAt(0).getText();
        String text = raw == null ? "" : raw.toString();
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (subject != null && !subject.trim().isEmpty() && !text.contains(subject)) text = subject + "\n" + text;
        if (text.length() > 100000) throw new IllegalArgumentException("分享文字超过 10 万字，请分次发送。");
        LinkedHashSet<Uri> uris = new LinkedHashSet<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> extra = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (extra != null) uris.addAll(extra);
        } else { Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM); if (uri != null) uris.add(uri); }
        Uri[] clip = MainActivity.selectedFiles(intent);
        if (clip != null) uris.addAll(Arrays.asList(clip));
        if (uris.size() > MAX_FILES) throw new IllegalArgumentException("一次最多分享 20 张截图。");
        if (uris.isEmpty() && text.trim().isEmpty()) throw new IllegalArgumentException("没有收到文字或截图，请重新分享。");
        String id = UUID.randomUUID().toString(); File dir = new File(root, id);
        if (!dir.mkdir()) throw new IOException("无法暂存分享，请检查本机空间。");
        try {
            JSONArray images = new JSONArray(); long total = 0;
            for (Uri uri : uris) {
                if (uri == null || !"content".equals(uri.getScheme())) throw new IllegalArgumentException("仅支持通过系统授权的图片分享。");
                // WeChat/QQ may label an image as application/octet-stream.
                // Validate the copied bytes below instead of trusting the MIME hint.
                String filename = UUID.randomUUID() + ".img"; File dest = new File(dir, filename);
                try (InputStream in = context.getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(dest)) {
                    if (in == null) throw new IOException("图片访问授权已失效，请重新分享。");
                    byte[] buffer = new byte[65536]; int count; long size = 0;
                    while ((count = in.read(buffer)) != -1) {
                        size += count; total += count;
                        if (size > MAX_FILE || total > MAX_BATCH || occupied + total > 200L * 1024 * 1024) throw new IOException("截图过大：单张最多 20 MB，一次合计最多 100 MB。");
                        out.write(buffer, 0, count);
                    }
                }
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(dest.getPath(), bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || (long) bounds.outWidth * bounds.outHeight > 80000000)
                    throw new IOException("图片无效或尺寸过大，请裁剪后重新分享。");
                if (!Arrays.asList("image/png", "image/jpeg", "image/webp", "image/bmp").contains(bounds.outMimeType))
                    throw new IOException("请选择 PNG、JPG、WebP 或 BMP 课程截图。");
                images.put(new JSONObject().put("name", "分享截图 " + (images.length() + 1)).put("type", bounds.outMimeType)
                    .put("url", MainActivity.ORIGIN + "/shared/" + id + "/" + filename));
            }
            JSONObject item = new JSONObject().put("id", id).put("text", text).put("images", images)
                .put("receivedAt", System.currentTimeMillis());
            AtomicFile manifest = new AtomicFile(new File(dir, "item.json"));
            FileOutputStream output = manifest.startWrite();
            try { output.write(item.toString().getBytes(StandardCharsets.UTF_8)); manifest.finishWrite(output); }
            catch (Exception error) { manifest.failWrite(output); throw error; }
            return id;
        } catch (Exception error) { remove(dir); throw error; }
    }
    static synchronized JSONArray pending(Context context) throws Exception {
        JSONArray result = new JSONArray(); File[] dirs = root(context).listFiles(File::isDirectory);
        Arrays.sort(dirs, Comparator.comparingLong(File::lastModified));
        for (File dir : dirs) {
            File manifest = new File(dir, "item.json");
            if (manifest.isFile()) result.put(new JSONObject(new String(java.nio.file.Files.readAllBytes(manifest.toPath()), StandardCharsets.UTF_8)));
        }
        return result;
    }
    static synchronized void consume(Context context, String id) throws Exception {
        if (!id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("分享编号无效。");
        remove(new File(root(context), id));
    }
    private static void remove(File target) throws IOException {
        if (!target.exists()) return;
        if (target.isDirectory()) for (File file : Objects.requireNonNull(target.listFiles())) remove(file);
        if (!target.delete()) throw new IOException("临时分享清理失败，请重试。");
    }
    static Intent outgoing(String text) {
        if (text == null || text.trim().isEmpty() || text.length() > 100000) throw new IllegalArgumentException("请选择课程任务，分享文字最多 10 万字。");
        return new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).putExtra(Intent.EXTRA_SUBJECT, "拾课课程任务");
    }
}
