package cn.shike.study;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String START = ORIGIN + "/assets/web/index.html";
    static final StringBuilder debugRequests = new StringBuilder();
    private WebView web;
    private CalendarStore calendar;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Reply calendarPermissionReply, saveReply;
    private String saveContent;
    private PermissionRequest microphone;
    private ValueCallback<Uri[]> chooser;
    interface Reply { void send(Object value, Exception error); }
    interface Work { Object run() throws Exception; }
    private boolean local(Uri uri) { return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost()) && uri.getPort() == -1; }
    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        calendar = new CalendarStore(this);
        web = new WebView(this);
        FrameLayout root = new FrameLayout(this); root.setBackgroundColor(Color.rgb(242, 245, 252));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1)); setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                boolean keyboard = insets.isVisible(WindowInsets.Type.ime());
                web.post(() -> web.evaluateJavascript("document.documentElement?.classList.toggle('keyboard-open', " + keyboard + ")", null));
                if (keyboard) web.postDelayed(() -> web.evaluateJavascript("(()=>{const e=document.activeElement;if(e&&/^(INPUT|TEXTAREA)$/.test(e.tagName))e.scrollIntoView({block:'nearest',inline:'nearest'});})()", null), 100);
                // The native container already avoids bars, cutouts and IME.
                // Forward zero values so newer WebViews do not apply them twice.
                return new WindowInsets.Builder(insets)
                    .setInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime(), android.graphics.Insets.NONE)
                    .setDisplayCutout(null).build();
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        web.setBackgroundColor(Color.rgb(242, 245, 252));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setTextZoom(Math.round(100 * getResources().getConfiguration().fontScale));
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebViewAssetLoader.AssetsPathHandler assets = new WebViewAssetLoader.AssetsPathHandler(this);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder().addPathHandler("/assets/", asset -> {
            if(BuildConfig.DEBUG) synchronized(debugRequests) { if(debugRequests.length()<10000)debugRequests.append(asset).append('\n'); }
            return assets.handle(asset.endsWith(".gz") ? asset+".bin" : asset);
        }).build();
        web.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if ("data".equals(request.getUrl().getScheme()) || "blob".equals(request.getUrl().getScheme())) return null;
                if (!local(request.getUrl())) return blocked();
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                return response == null ? blocked() : response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !local(request.getUrl()) || !request.getUrl().getPath().startsWith("/assets/web/");
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat() {
                @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    if ("data".equals(request.getUrl().getScheme()) || "blob".equals(request.getUrl().getScheme())) return null;
                    if (!local(request.getUrl())) return blocked();
                    WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                    return response == null ? blocked() : response;
                }
            });
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this); message.setText("请先在系统设置或应用商店更新 Android System WebView，再打开拾课。");
            message.setPadding(48, 64, 48, 48); setContentView(message); return;
        }
        WebViewCompat.addWebMessageListener(web, "ShikeNative", Collections.singleton(ORIGIN),
            (view, message, sourceOrigin, isMainFrame, proxy) -> {
                if (!isMainFrame || !local(sourceOrigin)) return;
                try {
                    String raw = message.getData();
                    if (raw == null || raw.length() > 25000000) throw new IllegalArgumentException("请求内容过大。");
                    JSONObject data = new JSONObject(raw);
                    String id = data.getString("id");
                    Reply reply = (value, error) -> runOnUiThread(() -> {
                        if (isFinishing() || isDestroyed()) return;
                        try {
                            JSONObject result = new JSONObject().put("id", id).put("ok", error == null);
                            if (error == null) result.put("result", value == null ? JSONObject.NULL : value);
                            else result.put("error", error instanceof SecurityException ? "日历权限未允许，请授权后再同步。任务仍保存在拾课中。" : error.getMessage() == null ? "系统操作未完成，请重试。" : error.getMessage());
                            proxy.postMessage(result.toString());
                        } catch (Exception ignored) { }
                    });
                    dispatch(data.getString("method"), data.optJSONObject("args"), reply);
                } catch (Exception ignored) { /* Invalid messages cannot invoke a platform operation. */ }
            });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                if(BuildConfig.DEBUG) android.util.Log.i("ShikeWeb", message.message());
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!local(request.getOrigin()) || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    else if (microphone == null) { microphone = request; requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 101); }
                    else request.deny();
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (microphone == request) microphone = null; }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                String accept = String.join(",", params.getAcceptTypes());
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                if (accept.contains("image/")) intent.setType("image/*");
                else if (accept.contains("json")) intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                try { startActivityForResult(intent, 201); }
                catch (Exception error) { chooser.onReceiveValue(null); chooser = null; }
                return true;
            }
        });
        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(START);
    }
    private void background(Reply reply, Work action) {
        worker.execute(() -> { try { reply.send(action.run(), null); } catch (Exception error) { reply.send(null, error); } });
    }
    private void dispatch(String method, JSONObject args, Reply reply) throws Exception {
        switch (method) {
            case "calendarStatus": background(reply, () -> calendar.status()); break;
            case "calendarSync": background(reply, () -> calendar.sync(args == null ? null : args.optJSONArray("tasks"))); break;
            case "calendarDisable": background(reply, () -> calendar.disable()); break;
            case "calendarEnable":
                if (calendar.granted()) background(reply, () -> calendar.enable());
                else if (calendarPermissionReply != null) reply.send(null, new IllegalStateException("正在等待日历授权，请稍候。"));
                else { calendarPermissionReply = reply; requestPermissions(new String[]{Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR}, 100); }
                break;
            case "saveFile":
                if (saveReply != null) { reply.send(null, new IllegalStateException("请先完成当前文件的保存。")); break; }
                String content = args.getString("content"), type = args.getString("type"), name = args.getString("filename");
                if (content.length() > 20000000 || !(type.startsWith("application/json") || type.startsWith("text/calendar"))) { reply.send(null, new IllegalArgumentException("文件类型或大小无效。")); break; }
                saveContent = content; saveReply = reply;
                try {
                    startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(type.split(";")[0]).putExtra(Intent.EXTRA_TITLE, name.replaceAll("[\\\\/:*?\"<>|]", "_")), 202);
                } catch (Exception error) { saveReply = null; saveContent = null; reply.send(null, error); }
                break;
            default: reply.send(null, new IllegalArgumentException("不支持的系统操作。"));
        }
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 100 && calendarPermissionReply != null) {
            Reply reply = calendarPermissionReply; calendarPermissionReply = null;
            background(reply, () -> calendar.enable());
        }
        if (code == 101 && microphone != null) {
            PermissionRequest request = microphone; microphone = null;
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else request.deny();
        }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == 201 && chooser != null) { chooser.onReceiveValue(result == RESULT_OK ? selectedFiles(data) : null); chooser = null; }
        if (code == 202 && saveReply != null) {
            Reply reply = saveReply; String content = saveContent; saveReply = null; saveContent = null;
            if (result != RESULT_OK || data == null || data.getData() == null) { reply.send(null, new IllegalStateException("已取消保存文件。")); return; }
            Uri uri = data.getData();
            background(reply, () -> { try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) { if (stream == null) throw new IllegalStateException("无法写入选中的文件。"); stream.write(content.getBytes(StandardCharsets.UTF_8)); } return new JSONObject().put("saved", true); });
        }
    }
    static Uri[] selectedFiles(Intent data) {
        if (data == null) return null;
        java.util.LinkedHashSet<Uri> files = new java.util.LinkedHashSet<>();
        if (data.getClipData() != null) {
            for (int index = 0; index < data.getClipData().getItemCount(); index++) {
                Uri uri = data.getClipData().getItemAt(index).getUri();
                if (uri != null && "content".equals(uri.getScheme())) files.add(uri);
            }
        }
        Uri uri = data.getData();
        if (uri != null && "content".equals(uri.getScheme())) files.add(uri);
        return files.isEmpty() ? null : files.toArray(new Uri[0]);
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); if (web != null) web.saveState(state); }
    WebView browserForTests() { return web; }
    @Override public void onBackPressed() {
        web.evaluateJavascript("(() => { const d=document.querySelector('dialog[open]'); if(d){d.close();return true;} return false; })()", closed -> {
            if (!"true".equals(closed)) { if (web.canGoBack()) web.goBack(); else moveTaskToBack(true); }
        });
    }
    @Override protected void onDestroy() { if (web != null) web.destroy(); worker.shutdown(); super.onDestroy(); }
}
