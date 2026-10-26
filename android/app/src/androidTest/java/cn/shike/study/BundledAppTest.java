package cn.shike.study;

import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class BundledAppTest {
    private MainActivity activity;
    private String eval(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>(); CountDownLatch ready = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.browserForTests().evaluateJavascript(script, value -> {result.set(value);ready.countDown();}));
        assertTrue("JavaScript callback timed out", ready.await(20, TimeUnit.SECONDS)); return result.get();
    }
    private void waitFor(String expression, int seconds) throws Exception {
        long until = System.currentTimeMillis() + seconds * 1000L;
        while (System.currentTimeMillis() < until) {
            if ("true".equals(eval(expression))) return;
            if ("true".equals(eval("document.querySelector('#review-panel')?.innerText.includes('这次没有识别完成') || (!!window.__voice && !['loading','ready'].includes(window.__voice))"))) break;
            Thread.sleep(250);
        }
        System.out.println("SHIKE_ASSETS " + MainActivity.debugRequests);
        System.out.println("SHIKE_WORKERS " + eval("JSON.stringify(window.__workerTrace)"));
        System.out.println("SHIKE_VOICE " + eval("window.__voice"));
        fail("App did not become ready: " + expression + "; page: " + eval("document.body.innerText.slice(-2000)"));
    }
    @Test public void localWebViewBridgeChineseOCRAndRealVoiceModelWorkWithoutRemoteAssets() throws Exception {
        Intent intent = new Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity = (MainActivity) InstrumentationRegistry.getInstrumentation().startActivitySync(intent);
        try {
            waitFor("!!document.querySelector('.home-capture') && !!window.ShikeNative", 40);
            eval("window.__probe=null; const prior=ShikeNative.onmessage; ShikeNative.onmessage=e=>{const m=JSON.parse(e.data);if(m.id==='probe')window.__probe=m;else prior?.(e)}; ShikeNative.postMessage(JSON.stringify({id:'probe',method:'calendarStatus',args:{}}));");
            waitFor("window.__probe?.ok===true", 15);
            assertEquals("true", eval("window.__probe.result.available"));
            assertEquals("true", eval("location.origin==='https://appassets.androidplatform.net' && isSecureContext"));
            eval("window.__workerTrace=[];const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);window.__workerTrace.push(String(args[0]));this.addEventListener('message',e=>{if(window.__workerTrace.length<100)window.__workerTrace.push(JSON.stringify(e.data).slice(0,500))});this.addEventListener('error',e=>window.__workerTrace.push(e.message))}};");
            eval("document.querySelector('[data-action=import]').click()");
            waitFor("!!document.querySelector('#screenshot-file')", 10);
            eval("(() => {const c=document.createElement('canvas');c.width=1400;c.height=450;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1400,450);x.fillStyle='#111';x.font='48px sans-serif';['完成数学第三章习题','截止时间：2026年12月30日 23:59','要求：写出计算过程。'].forEach((line,i)=>x.fillText(line,60,90+i*100));c.toBlob(blob=>{const d=new DataTransfer();d.items.add(new File([blob],'notice.png',{type:'image/png'}));const input=document.querySelector('#screenshot-file');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}));});})();");
            waitFor("document.querySelector('#review-form [name=dueDate]')?.value==='2026-12-30'", 180);
            assertEquals("true", eval("document.querySelector('#notification-text').value.includes('数学')"));
            assertEquals("true", eval("location.hash==='#/import/review' && document.querySelector('.source-panel').hidden && !document.querySelector('#review-panel').hidden"));
            eval("document.querySelector('[data-action=exit-import]').click()");
            waitFor("!!document.querySelector('.home-capture')", 10);
            eval("window.__voice='loading'; const script=document.createElement('script');script.src=new URL('voice/vosk.js',document.baseURI).href;script.onerror=()=>window.__voice='script-error';script.onload=()=>{try{const model=new Vosk.Model(new URL('voice/cn-small-0.22.tar.gz',document.baseURI).href,-1);model.on('load',message=>{window.__voice=message.result?'ready':'load-error';model.terminate()});model.on('error',message=>window.__voice=JSON.stringify(message));}catch(error){window.__voice=error.message}};document.head.append(script);");
            waitFor("window.__voice==='ready'", 180);
        } finally { InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.finish()); }
    }
}
