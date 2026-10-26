package cn.shike.study;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.graphics.*;
import java.io.*;

/** Test APK only: models providers which send PNG data as octet-stream. */
public class OctetImageProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/octet-stream"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) || !("/image".equals(uri.getPath()) || "/invalid".equals(uri.getPath()))) throw new FileNotFoundException();
        try {
            ParcelFileDescriptor[] pipe=ParcelFileDescriptor.createPipe();
            new Thread(()->{
                try(OutputStream out=new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])){
                    if("/invalid".equals(uri.getPath()))out.write("%PDF-not-an-image".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    else{
                        Bitmap bitmap=Bitmap.createBitmap(1200,600,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(bitmap);canvas.drawColor(Color.WHITE);
                        Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);paint.setColor(Color.BLACK);paint.setTextSize(48);
                        String[] lines={"课程：物理","完成物理练习","截止时间：2026年12月30日"};
                        for(int i=0;i<lines.length;i++)canvas.drawText(lines[i],50,100+i*130,paint);
                        bitmap.compress(Bitmap.CompressFormat.PNG,100,out);bitmap.recycle();
                    }
                }catch(IOException ignored){}
            }).start();return pipe[0];
        }catch(IOException error){throw new FileNotFoundException(error.getMessage());}
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order) { return null; }
    @Override public Uri insert(Uri uri,ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri,ContentValues values,String selection,String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri,String selection,String[] args) { throw new UnsupportedOperationException(); }
}
