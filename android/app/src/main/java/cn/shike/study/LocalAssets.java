package cn.shike.study;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Loopback-only static assets: no personal data, file writes, or network-facing API. */
final class LocalAssets {
    static final int PORT = 48731;
    private static LocalAssets instance;
    private final Context context;
    private final ServerSocket server;
    private final ExecutorService readers = Executors.newFixedThreadPool(8);
    static synchronized void start(Context context) throws Exception { if (instance == null) instance = new LocalAssets(context.getApplicationContext()); }
    private LocalAssets(Context context) throws Exception {
        this.context = context;
        server = new ServerSocket(PORT, 24, InetAddress.getByName("127.0.0.1"));
        Thread accept = new Thread(() -> {
            while (!server.isClosed()) try { Socket socket = server.accept(); readers.execute(() -> serve(socket)); }
            catch (Exception ignored) { }
        }, "shike-local-assets"); accept.setDaemon(true); accept.start();
    }
    private String line(InputStream input) throws Exception {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        for (int i=0;i<4096;i++) { int b=input.read(); if(b<0||b=='\n') return result.toString("US-ASCII").trim(); if(b!='\r')result.write(b); }
        throw new IllegalArgumentException("Header too long");
    }
    private String mime(String file) {
        if(file.endsWith(".html"))return "text/html; charset=utf-8";
        if(file.endsWith(".js"))return "text/javascript; charset=utf-8";
        if(file.endsWith(".css"))return "text/css; charset=utf-8";
        if(file.endsWith(".json")||file.endsWith(".webmanifest"))return "application/json";
        if(file.endsWith(".wasm"))return "application/wasm";
        if(file.endsWith(".png"))return "image/png";
        if(file.endsWith(".svg"))return "image/svg+xml";
        return "application/octet-stream";
    }
    private void error(OutputStream output, int code) throws Exception {
        output.write(("HTTP/1.1 "+code+" Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
    }
    private void serve(Socket socket) {
        try (socket) {
            socket.setSoTimeout(5000);
            InputStream input=socket.getInputStream(); OutputStream output=socket.getOutputStream();
            String[] request=line(input).split(" "); if(request.length!=3){error(output,400);return;}
            String host=""; int headerBytes=0;
            while(true){String h=line(input);headerBytes+=h.length();if(headerBytes>16384){error(output,431);return;}if(h.isEmpty())break;if(h.toLowerCase(java.util.Locale.ROOT).startsWith("host:"))host=h.substring(5).trim();}
            if(!host.equals("127.0.0.1:"+PORT)){error(output,403);return;}
            if(!request[0].equals("GET")&&!request[0].equals("HEAD")){error(output,405);return;}
            String file=request[1].split("\\?",2)[0];
            if(!file.matches("/[A-Za-z0-9_./-]*")||file.contains("..")||file.contains("//")){error(output,403);return;}
            if(file.equals("/"))file="/index.html";
            String asset="web"+file;
            InputStream body; long length;
            try {
                // Large WASM/model assets are stored uncompressed in the APK and streamed.
                try { AssetFileDescriptor fd=context.getAssets().openFd(asset); length=fd.getLength(); body=fd.createInputStream(); }
                catch (java.io.IOException compressed) {
                    try(InputStream original=context.getAssets().open(asset);ByteArrayOutputStream copy=new ByteArrayOutputStream()){
                        byte[] buffer=new byte[16384];int n;while((n=original.read(buffer))!=-1)copy.write(buffer,0,n);
                        byte[] bytes=copy.toByteArray();length=bytes.length;body=new ByteArrayInputStream(bytes);
                    }
                }
            } catch (java.io.IOException missing) {error(output,404);return;}
            try(InputStream data=body){
                String policy=file.equals("/voice/recognizer-worker.js") ? "Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self' data:; worker-src 'none'\r\n" : "";
                output.write(("HTTP/1.1 200 OK\r\nContent-Type: "+mime(file)+"\r\nContent-Length: "+length+"\r\nConnection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\n"+policy+"\r\n").getBytes(StandardCharsets.US_ASCII));
                if(request[0].equals("GET")){byte[] buffer=new byte[65536];long left=length;while(left>0){int n=data.read(buffer,0,(int)Math.min(left,buffer.length));if(n<0)break;output.write(buffer,0,n);left-=n;}}
            }
        } catch (Exception ignored) { /* A closed WebView request must not affect other resources. */ }
    }
}
