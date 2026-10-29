package cn.shike.study;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/** Native home-screen content; reads the same authoritative data as alarms. */
public final class CourseWidget extends AppWidgetProvider {
    static final String REFRESH="cn.shike.study.WIDGET_REFRESH";
    static JSONObject preview(JSONObject state,long now) throws Exception {
        JSONArray tables=state.getJSONArray("tables"),rows=new JSONArray();
        JSONObject result=new JSONObject().put("title","拾课课程表").put("tableId","widget-empty").put("rows",rows);
        if(tables.length()==0)return result;
        String selected=state.optString("primaryId");
        JSONObject table=selected.isEmpty()?tables.getJSONObject(0):CourseEngine.table(state,selected);
        result.put("title",table.getString("name")).put("tableId",table.getString("id"));
        LocalDate today=Instant.ofEpochMilli(now).atZone(CourseEngine.ZONE).toLocalDate();
        JSONArray all=CourseEngine.occurrences(table,today,today.plusDays(7));
        for(int i=0;i<all.length()&&rows.length()<3;i++)if(all.getJSONObject(i).getLong("finish")>now)rows.put(all.getJSONObject(i));
        return result;
    }
    static PendingIntent open(Context context,String table,String date,String key,int request) {
        Intent intent=new Intent(context,MainActivity.class).setData(Uri.parse("shike-widget://open/"+request))
            .putExtra("courseTableId",table).putExtra("courseDate",date).putExtra("courseKey",key)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context,request,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static RemoteViews views(Context context,JSONObject data,long now) throws Exception {
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.course_widget);
        String today=Instant.ofEpochMilli(now).atZone(CourseEngine.ZONE).toLocalDate().toString();
        view.setTextViewText(R.id.widget_title,data.getString("title"));
        view.setTextViewText(R.id.widget_date,today+" · 接下来三次课");
        view.setOnClickPendingIntent(R.id.widget_title,open(context,data.getString("tableId"),today,"",0));
        view.setOnClickPendingIntent(R.id.widget_refresh,PendingIntent.getBroadcast(context,0,new Intent(context,CourseWidget.class).setAction(REFRESH),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
        JSONArray rows=data.getJSONArray("rows");int[] ids={R.id.widget_first,R.id.widget_second,R.id.widget_third};
        DateTimeFormatter time=DateTimeFormatter.ofPattern("HH:mm");
        for(int i=0;i<3;i++){
            view.setViewVisibility(ids[i],i<rows.length()?View.VISIBLE:View.GONE);
            if(i<rows.length()){
                JSONObject c=rows.getJSONObject(i);
                String start=Instant.ofEpochMilli(c.getLong("begin")).atZone(CourseEngine.ZONE).format(time),end=Instant.ofEpochMilli(c.getLong("finish")).atZone(CourseEngine.ZONE).format(time);
                view.setTextViewText(ids[i],c.getString("name")+"\n"+c.getString("date").substring(5)+"  "+start+"–"+end+"  "+c.optString("room","未填写地点"));
                view.setOnClickPendingIntent(ids[i],open(context,data.getString("tableId"),c.getString("date"),c.getString("key"),i+1));
            }
        }
        view.setViewVisibility(R.id.widget_empty,rows.length()==0?View.VISIBLE:View.GONE);
        view.setOnClickPendingIntent(R.id.widget_empty,open(context,data.getString("tableId"),today,"",0));
        return view;
    }
    static void refresh(Context context) {
        AppWidgetManager manager=AppWidgetManager.getInstance(context);int[] ids=manager.getAppWidgetIds(new ComponentName(context,CourseWidget.class));
        if(ids.length==0)return;
        try {long now=System.currentTimeMillis();manager.updateAppWidget(ids,views(context,preview(new CourseStore(context).read(),now),now));}
        catch(Exception error){RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.course_widget);view.setTextViewText(R.id.widget_empty,"课表暂时无法读取，请打开拾课检查");view.setOnClickPendingIntent(R.id.widget_empty,open(context,"widget-empty",LocalDate.now(CourseEngine.ZONE).toString(),"",0));manager.updateAppWidget(ids,view);}
    }
    @Override public void onReceive(Context context,Intent intent){super.onReceive(context,intent);if(REFRESH.equals(intent.getAction()))update(context);}
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){update(context);}
    @Override public void onAppWidgetOptionsChanged(Context context,AppWidgetManager manager,int id,android.os.Bundle options){update(context);}
    private void update(Context context){final PendingResult pending=goAsync();new Thread(()->{try{refresh(context);}finally{pending.finish();}},"shike-widget").start();}
}
