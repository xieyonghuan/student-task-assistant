package cn.shike.study;

import android.content.*;
import android.graphics.*;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class OpenAndPasteTest {
    private MainActivity activity;
    private String eval(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>(); CountDownLatch ready = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.browserForTests().evaluateJavascript(script, value -> { result.set(value); ready.countDown(); }));
        assertTrue(ready.await(15,TimeUnit.SECONDS)); return result.get();
    }
    private void waitFor(String script) throws Exception {
        long until = System.currentTimeMillis()+90000;
        while(System.currentTimeMillis()<until){if("true".equals(eval(script)))return;Thread.sleep(200);}
        fail("Open/paste did not complete: "+eval("document.body.innerText.slice(-1800)"));
    }
    @Test public void clipboardTextAndOpenWithGenericMimeImagesEnterRealExtractionWithoutStartingWasm() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        try {
            int pending=ShareStore.pending(context).length();
            try {ShareStore.receive(context,new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://cn.shike.study.test.images/invalid"),"application/octet-stream"));fail("Non-image accepted");}catch(IOException expected){}
            assertEquals(pending,ShareStore.pending(context).length());
            assertEquals(1,context.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://cn.shike.study.test.images/image"),"application/octet-stream").setPackage(context.getPackageName()),0).size());
            activity=(MainActivity)InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitFor("!!document.querySelector('.home-capture') && document.hasFocus()");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->((ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("test","课程：统计学\n完成统计学练习\n下周一提交")));
            eval("document.querySelector('[data-action=receive-share]').click()");
            waitFor("[...document.querySelectorAll('[name=course]')].some(e=>e.value==='统计学')");
            eval("const date=document.querySelector('#notice-date');date.value='2026-10-23';date.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#recalculate-date').click()");
            waitFor("[...document.querySelectorAll('[name=dueDate]')].some(e=>e.value==='2026-10-26')");
            eval("const accuracy=document.querySelector('#ocr-accuracy');accuracy.value='fast';accuracy.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-action=exit-import]').click()");
            waitFor("!!document.querySelector('.home-capture')");
            eval("window.__fastWorkers=0;const OriginalWorker=window.Worker;window.Worker=class extends OriginalWorker{constructor(...args){super(...args);if(String(args[0]).includes('/ocr/'))window.__fastWorkers++}};");
            long start=android.os.SystemClock.elapsedRealtime();
            Intent open=new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://cn.shike.study.test.images/image"),"application/octet-stream").setClass(context,ShareReceiverActivity.class).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.startActivity(open));
            waitFor("[...document.querySelectorAll('[name=title]')].some(e=>e.value.includes('物理练习')) && [...document.querySelectorAll('[name=course]')].some(e=>e.value==='物理')");
            assertEquals("0",eval("window.__fastWorkers"));
            System.out.println("SHIKE_FAST_OPEN ms="+(android.os.SystemClock.elapsedRealtime()-start));
            assertEquals(0,ShareStore.pending(context).length());
        } finally {
            if(activity!=null)InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.finish());
        }
    }
}
