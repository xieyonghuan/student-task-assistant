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
        fail("Open/paste did not complete: "+script+"; "+eval("JSON.stringify({focused:document.hasFocus(),titles:[...document.querySelectorAll('[name=title]')].map(e=>e.value),sources:[...document.querySelectorAll('.source-reference pre')].map(e=>e.textContent),page:document.body.innerText.slice(-1800)})"));
    }
    @Test public void clipboardTextAndOpenWithGenericMimeImagesEnterRealExtractionWithoutStartingWasm() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        try {
            int pending=ShareStore.pending(context).length();
            try {ShareStore.receive(context,new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://cn.shike.study.test.images/invalid"),"application/octet-stream"));fail("Non-image accepted");}catch(IOException expected){}
            assertEquals(pending,ShareStore.pending(context).length());
            assertEquals(1,context.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://cn.shike.study.test.images/image"),"application/octet-stream").setPackage(context.getPackageName()),0).size());
            activity=(MainActivity)InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitFor("!!document.querySelector('.home-capture')");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.browserForTests().requestFocus());
            waitFor("document.hasFocus()");
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
    @Test public void sharedCardImageExtractsBothTasksOnceDespiteNestedExamTimes() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        try {
            activity=(MainActivity)InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitFor("!!document.querySelector('.home-capture')");
            eval("document.querySelector('[data-action=import]').click()");
            waitFor("!!document.querySelector('#ocr-accuracy')");
            eval("(()=>{const select=document.querySelector('#ocr-accuracy');select.value='stable';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-action=exit-import]').click();})()");
            waitFor("!!document.querySelector('.home-capture')");
            eval("window.__stableWorkers=0;(()=>{const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);if(String(args[0]).includes('/ocr/'))window.__stableWorkers++}}})()");
            Intent open=new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://cn.shike.study.test.images/card"),"application/octet-stream").setClass(context,ShareReceiverActivity.class).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.startActivity(open));
            waitFor("[...document.querySelectorAll('[name=title]')].some(e=>e.value==='第三章练习') && [...document.querySelectorAll('[name=title]')].some(e=>e.value==='概率报告')");
            assertEquals("1",eval("[...document.querySelectorAll('[name=title]')].filter(e=>e.value==='第三章练习').length"));
            assertEquals("1",eval("[...document.querySelectorAll('[name=title]')].filter(e=>e.value==='概率报告').length"));
            assertEquals("true",eval("[...document.querySelectorAll('[name=title]')].filter(e=>['第三章练习','概率报告'].includes(e.value)).every(e=>e.form.querySelector('[name=dueDate]').value===(e.value==='第三章练习'?'2026-12-30':'2027-01-04'))"));
            assertEquals("true",eval("window.__stableWorkers>0"));
        } finally { if(activity!=null)InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.finish()); }
    }

    @Test public void pastedSharedTasksWithMarkdownBreaksKeepBothOuterDeadlines() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        try {
            activity=(MainActivity)InstrumentationRegistry.getInstrumentation().startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            waitFor("!!document.querySelector('.home-capture')");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.browserForTests().requestFocus());
            waitFor("document.hasFocus()");
            String text="[拾课课程任务\n1. 线性代数报告\\\n 截止时间：2026-12-30 23:59\\\n 要求：开始时间：2026-12-01\\\n 截止时间：2026-12-30\n2. 英语阅读\\\n 截止时间：2027-01-04（当天 00:00）\\\n 要求：100.9 KB\\\n 下周一交作业]";
            InstrumentationRegistry.getInstrumentation().runOnMainSync(()->((ClipboardManager)context.getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("test",text)));
            eval("document.querySelector('[data-action=receive-share]').click()");
            waitFor("[...document.querySelectorAll('[name=title]')].some(e=>e.value==='线性代数报告') && [...document.querySelectorAll('[name=title]')].some(e=>e.value==='英语阅读')");
            assertEquals("true",eval("['线性代数报告','英语阅读'].every(title=>[...document.querySelectorAll('[name=title]')].filter(e=>e.value===title).length===1)"));
            assertEquals("true",eval("[...document.querySelectorAll('[name=title]')].filter(e=>['线性代数报告','英语阅读'].includes(e.value)).every(e=>e.form.querySelector('[name=dueDate]').value===(e.value==='线性代数报告'?'2026-12-30':'2027-01-04'))"));
        } finally { if(activity!=null)InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.finish()); }
    }
}
