import { dueTimestamp, REMINDERS } from './domain.js';

const escape = s => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function foldLine(line) {
  // RFC 5545 uses octets, so never split a multibyte Chinese character.
  const parts = [];
  let current = '', size = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (size + length > 75) { parts.push(current); current = ' '; size = 1; }
    current += char; size += length;
  }
  parts.push(current);
  return parts.join('\r\n');
}

export function createCalendar(tasks, reminders = REMINDERS, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shike//Study Task Assistant//ZH-CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:拾课 · 学习任务', 'X-WR-TIMEZONE:Asia/Shanghai'];
  const allowed = [...new Set(reminders)].filter(n => REMINDERS.includes(n));
  for (const task of tasks) {
    const due = dueTimestamp(task);
    if (due === null) continue;
    const note = `${task.details || ''}${!task.dueTime ? '\n仅记录日期：按当天 00:00（中国标准时间）截止。' : ''}`;
    lines.push('BEGIN:VEVENT', `UID:${escape(task.id)}@study-task-assistant.local`, `DTSTAMP:${stamp(now)}`, `CREATED:${stamp(new Date(task.createdAt))}`, `LAST-MODIFIED:${stamp(new Date(task.updatedAt))}`, `DTSTART:${stamp(new Date(due))}`, `DTEND:${stamp(new Date(due + 60000))}`, `SUMMARY:${escape(task.title)}`, `DESCRIPTION:${escape(note)}`, 'TRANSP:TRANSPARENT', 'STATUS:CONFIRMED', `SEQUENCE:${Math.max(0, Math.floor(new Date(task.updatedAt).getTime() / 1000))}`);
    for (const minute of allowed) {
      lines.push('BEGIN:VALARM', `TRIGGER:-PT${minute}M`, 'ACTION:DISPLAY', `DESCRIPTION:${escape(`学习任务：${task.title}`)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
