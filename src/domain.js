export const REMINDERS = [4320, 1440, 300, 60];
export const UPCOMING_WINDOW = 3 * 24 * 60 * 60 * 1000;
export const newId = () => crypto.randomUUID();

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return y >= 1900 && y <= 2200 && dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dueTimestamp(task) {
  if (!validDate(task.dueDate)) return null;
  return new Date(`${task.dueDate}T${task.dueTime || '00:00'}:00+08:00`).getTime();
}

export function taskGroup(task, now = Date.now()) {
  if (task.completedAt) return 'completed';
  const due = dueTimestamp(task);
  return due === null ? 'undated' : due <= now ? 'overdue' : due - now <= UPCOMING_WINDOW ? 'upcoming' : 'scheduled';
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => (dueTimestamp(a) ?? Infinity) - (dueTimestamp(b) ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
}

export function findDuplicates(task, tasks, excludeId) {
  const normal = s => String(s || '').toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
  const a = normal(task.title);
  if (!a) return [];
  const bigrams = s => new Set([...s].slice(0, -1).map((_, i) => s.slice(i, i + 2)));
  return tasks.filter(t => {
    if (t.id === excludeId) return false;
    const b = normal(t.title);
    if (a === b) return true;
    if (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))) return true;
    const x = bigrams(a), y = bigrams(b);
    const common = [...x].filter(v => y.has(v)).length;
    return Math.min(a.length, b.length) >= 5 && (2 * common) / Math.max(1, x.size + y.size) >= 0.7;
  });
}

export function normalizeNotice(text) {
  let result = String(text).normalize('NFKC').replace(/\r/g, '');
  // OCR may insert one space between every Chinese character.
  for (let i = 0; i < 3; i++) result = result.replace(/([\p{Script=Han}]) +(?=[\p{Script=Han}])/gu, '$1');
  return result;
}

function spokenNumber(text) {
  const digits = { 零: 0, 〇: 0, '○': 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!/[十百千]/.test(text)) {
    const value = [...text].map(c => /\d/.test(c) ? c : digits[c]).join('');
    return /^\d+$/.test(value) ? Number(value) : null;
  }
  let total = 0, current = 0, lastUnit = Infinity;
  for (const c of text) {
    const unit = { 十: 10, 百: 100, 千: 1000 }[c];
    if (unit) {
      if (unit >= lastUnit) return null;
      total += (current || 1) * unit; current = 0; lastUnit = unit;
    } else {
      const digit = /\d/.test(c) ? Number(c) : digits[c];
      if (digit === undefined) return null;
      current = current * 10 + digit;
    }
  }
  return total + current;
}

function normalizeDateNumbers(text) {
  // Convert only date/time components, leaving task names such as 第三章 intact.
  return text.replace(/([零〇○一二两三四五六七八九十百千\d]+)[ \t]*(?=[年月日号点分])/g, (whole, number) => {
    const value = spokenNumber(number);
    return value === null ? whole : String(value);
  });
}

function readClock(text) {
  const match = text.match(/(凌晨|早上|上午|中午|下午|晚上)?(\d{1,2})(?:[:：](\d{2})|点(?:(\d{1,2})分?|半)?)/);
  if (!match) return { dueTime: '', invalid: false };
  let hour = Number(match[2]);
  const minute = Number(match[3] || match[4] || (match[0].includes('半') ? 30 : 0));
  if (['下午', '晚上', '中午'].includes(match[1]) && hour < 12) hour += 12;
  if (match[1] === '凌晨' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return { dueTime: '', invalid: true };
  return { dueTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, invalid: false };
}

function relativeDeadlines(text, now) {
  const found = [];
  const dayOffsets = { 今天: 0, 今日: 0, 今晚: 0, 明天: 1, 明日: 1, 明晚: 1, 后天: 2, 后日: 2, 大后天: 3 };
  const weekdays = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 };
  const dayPattern = /大后天|后天|后日|明天|明日|明晚|今天|今日|今晚/g;
  const weekPattern = /(?:(下下|下|本|这)(?:个)?)?(?:星期|礼拜|周)([一二三四五六日天1-7])/g;
  const relativePattern = /(?:[今明后]天|[今明后]日|[今明]晚|昨天|昨日|前天|本周|下周|这周|周末|星期|礼拜|周[一二三四五六日天1-7]|[零一二两三四五六七八九十\d]+天[内后])/;
  const ranges = [];
  function append(match, offset, rollToNextWeek = false) {
    // Only read a time following this expression, never a screenshot's status clock.
    const tail = text.slice(match.index + match[0].length).split(/[\n，,。；;]/)[0];
    const clock = readClock(tail);
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    date.setDate(date.getDate() + offset);
    if (rollToNextWeek && offset === 0) {
      const [hour, minute] = (clock.dueTime || '00:00').split(':').map(Number);
      const deadline = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
      if (deadline.getTime() <= now.getTime()) date.setDate(date.getDate() + 7);
    }
    found.push({ date: localDate(date), ...clock, expression: match[0] });
    ranges.push([match.index, match.index + match[0].length]);
  }
  for (const match of text.matchAll(dayPattern)) append(match, dayOffsets[match[0]]);
  for (const match of text.matchAll(weekPattern)) {
    const target = weekdays[match[2]];
    if (!match[1]) append(match, (target - now.getDay() + 7) % 7, true);
    else {
      const mondayOffset = (now.getDay() + 6) % 7;
      const week = match[1] === '下下' ? 2 : match[1] === '下' ? 1 : 0;
      append(match, (target + 6) % 7 - mondayOffset + week * 7);
    }
  }
  let remaining = text;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) remaining = remaining.slice(0, start) + ' '.repeat(end - start) + remaining.slice(end);
  return { found, unsupported: relativePattern.test(remaining) };
}

export function extractDeadline(text, now = new Date()) {
  const normalized = normalizeDateNumbers(normalizeNotice(text));
  // A labelled end date takes precedence over a separately labelled start date.
  const labelled = normalized.match(/(?:提交截止(?:时间|日期)?|截止(?:时间|日期)|结束(?:时间|日期)|到期(?:时间|日期)|最迟提交时间|截止于|截至)[\s:：]*([^\n]+)/);
  let compact = (labelled ? labelled[1] : normalized).replace(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})[ \t]+(?=\d{1,2}[:：])/g, '$1/').replace(/[ \t]/g, '');
  // Weekdays attached to an absolute date are annotations, not relative deadlines.
  compact = compact.replace(/((?:(?:\d{4})[年/.-])?\d{1,2}[月/.-]\d{1,2}(?:日|号)?(?:[/\s]*\d{1,2}[:：]\d{2})?)[/（(\s]*(?:星期|周)[一二三四五六日天1-7][)）]?/g, '$1');
  const relative = relativeDeadlines(compact, now);
  if (relative.unsupported) return { dueDate: '', dueTime: '', dateConfirmed: false, dateHint: '这处相对时间还不够明确，请选择具体截止日期。' };
  const matches = [...compact.matchAll(/(?<!\d)(?:(\d{4})[年/.-])?(\d{1,2})[月/.-](\d{1,2})(?:日|号)?(?!\d)/g)];
  const absoluteDates = matches.map(m => `${m[1] || now.getFullYear()}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  const dates = [...new Set([...absoluteDates, ...relative.found.map(r => r.date)])];
  if (dates.length !== 1 || !validDate(dates[0])) {
    return { dueDate: '', dueTime: '', dateConfirmed: false, dateHint: dates.length > 1 ? '通知包含多个日期，请选择真正的截止日期。' : dates.length ? '日期无法确认，请手动选择。' : '没有找到明确截止日期，可选择日期或“暂无截止日期”。' };
  }
  const clock = relative.found.length ? relative.found[0] : readClock(compact);
  const relativeTimes = new Set(relative.found.map(r => r.dueTime));
  if (clock.invalid || relative.found.some(r => r.invalid) || relativeTimes.size > 1) return { dueDate: dates[0], dueTime: '', dateConfirmed: false, dateHint: '截止时间无效或有多个不同时间，请核对。' };
  const dueTime = clock.dueTime;
  const deviceTime = `${localDate(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateHint = relative.found.length
    ? `按设备本地时间 ${deviceTime}，将“${[...new Set(relative.found.map(r => r.expression))].join('、')}”识别为 ${dates[0]}${dueTime ? ` ${dueTime}` : ' 当天 00:00'} 截止，可在下方修改。`
    : matches[0][1] ? '' : `通知未写年份，暂按 ${now.getFullYear()} 年填写，请核对。`;
  return { dueDate: dates[0], dueTime, dateConfirmed: true, dateHint };
}

function titleFromText(text) {
  let title = text.split('\n').find(l => l.trim()) || '';
  title = title.replace(/^\s*(?:\d+[、.．)）]|[一二三四五六七八九十]+[、.．]|[（(]\d+[）)])\s*/, '');
  title = title.replace(/^(?:请各位同学|请同学们|各位同学[，,:：]?|请大家|通知[：:])\s*/, '');
  title = title.replace(/[，,；;。]?(?:请于|最迟于?|截止(?:时间)?[为：:]?|提交时间[为：:])[^\n]*$/, '').trim();
  return title.slice(0, 80) || '待确认任务';
}

export function extractTasks(raw, now = new Date()) {
  let text = normalizeNotice(raw);
  // A decimal file size such as 12.8 KB is not task number 12.
  text = text.replace(/([^\n])\s+(?=\d+[、.)](?!\d)\s*\S)/g, '$1\n');
  // Keep the Chinese message when WeChat displays its matching translation.
  // Raw OCR remains available separately in the source panel for verification.
  const translated = text.match(/@\s*所有人\s*\n([\s\S]+?)@\s*Everyone\b/i);
  if (translated && /[a-z]{3,}/i.test(translated[1]) && !/[\p{Script=Han}]/u.test(translated[1].replace(/由微信提供翻译支持/g, ''))) text = text.replace(translated[0], '@所有人');
  text = text.replace(/^.*由微信提供翻译支持.*$/gm, '');
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  // A file card followed by “这是第…次作业” describes one assignment.
  // Join wrapped file names without treating the file and paper requirements as separate tasks.
  const reference = lines.findIndex(line => /这是第.{1,8}(?:次|份)作业/.test(line));
  if (reference > 0) {
    const attachments = [];
    for (let i = 0; i < reference; i++) {
      if (!/^作业\s*[_＿\d]/.test(lines[i])) continue;
      let name = lines[i];
      for (let j = i + 1; j < Math.min(i + 4, reference) && !/\.(?:pdf|docx?)\b/i.test(name); j++) name += lines[j];
      if (/\.(?:pdf|docx?)\b/i.test(name)) attachments.push(name.replace(/\s+/g, '').replace(/\.(?:pdf|docx?)\b.*$/i, ''));
    }
    if (attachments.length === 1) {
      const end = lines.findIndex((line, index) => index >= reference && /^@\s*所有人/.test(line));
      const body = lines.slice(reference, end >= 0 ? end : undefined);
      if (!body.slice(1).some(line => /^(?:另[外一]|第[二三四五六七八九十\d].*(?:项|次)作业)/.test(line))) {
        const details = [attachments[0], ...body].join('\n');
        return [{ id: newId(), title: attachments[0].slice(0, 80), details, ...extractDeadline(details, now) }];
      }
    }
  }
  const screenTitle = lines.find(l => /^.{1,80}(?:作业|测验|测试|练习|考试|习题|报告)$/.test(l) && !/[:：]/.test(l));
  if (screenTitle && /(?:开始|起始|开放)时间/.test(text) && /(?:截止|结束)时间/.test(text)) {
    const fields = lines.filter(l => l === screenTitle || /^(?:开始时间|起始时间|开放时间|截止时间|结束时间|考试限时|具体要求|要求[:：])/.test(l));
    const details = fields.join('\n');
    return [{ id: newId(), title: screenTitle, details, ...extractDeadline(details, now) }];
  }
  const marker = /^(?:\d+[、.)](?!\d)|[一二三四五六七八九十]+[、.]|[（(]\d+[）)])\s*\S/;
  const actionable = /作业|提交|完成|阅读|背诵|实验|报告|练习|预习|复习|论文|测验|考试|报名|汇报|打卡|习题|签到|收集|问卷/;
  const deadlineOnly = /^(?:截止|最迟|提交时间|时间|要求|注意|格式|字数|考试说明|考试限时|暂无说明|开始时间|结束时间|请于|请在|需于|于\d|\d{1,2}月\d{1,2}日.*(?:前|截止))/;
  const isDateContinuation = line => {
    const normalized = normalizeDateNumbers(line).replace(/[ \t]/g, '');
    const startsWithDate = /^(?:(?:最迟|请)?(?:于|在)?)?(?:(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]|大后天|后天|明天|今天|明日|后日|今日|今晚|明晚|(?:(?:下下|下|本|这)(?:个)?)?(?:周|星期|礼拜)[一二三四五六日天1-7])/.test(normalized);
    return startsWithDate
      && (!/作业|习题|报告|论文|实验|练习|阅读|测验|考试|笔记/.test(normalized) || /^.*(?:上交|提交|交)作业[。.!！]?$/.test(normalized));
  };
  const numbered = lines.some(l => marker.test(l));
  const blocks = [];
  let current = [];
  const flush = () => { if (current.length) blocks.push(current.join('\n')); current = []; };
  for (const line of lines) {
    if (!current.length && /^(?:课程|班级|学习)?(?:作业|任务)?通知[:：]?$/.test(line)) continue;
    if (numbered) {
      if (marker.test(line)) { flush(); current.push(line); }
      else if (current.length) current.push(line);
    } else if (actionable.test(line) && !deadlineOnly.test(line) && !isDateContinuation(line)) {
      flush(); current.push(line);
    } else if (current.length) current.push(line);
  }
  flush();
  // Keep otherwise unclassified content available for the user to review.
  if (!blocks.length) blocks.push(lines.join('\n'));
  const preamble = numbered ? lines.slice(0, lines.findIndex(l => marker.test(l))).join('\n') : '';
  return blocks.map(block => {
    const contextual = preamble && /截止|前提交|[今明后]天|(?:周|星期|礼拜)[一二三四五六日天]/.test(preamble) ? `${block}\n通知共同说明：${preamble}` : block;
    return { id: newId(), title: titleFromText(block), details: contextual, ...extractDeadline(contextual, now) };
  });
}

export function validateTask(task) {
  if (!String(task.title || '').trim()) return '请填写任务名称。';
  if (task.title.length > 120) return '任务名称请控制在 120 个字以内。';
  if (task.dueDate && !validDate(task.dueDate)) return '请选择有效的截止日期（1900—2200 年）。';
  if (task.dueTime && (!task.dueDate || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.dueTime))) return '请先选择截止日期，再填写有效时间。';
  if (String(task.details || '').length > 20000) return '具体要求过长，请控制在 20000 个字以内。';
  return '';
}

export function sanitizeTask(task) {
  return {
    id: task.id || newId(), title: String(task.title || '').trim(),
    dueDate: task.dueDate || '', dueTime: task.dueDate ? task.dueTime || '' : '',
    details: String(task.details || '').trim(),
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(), completedAt: task.completedAt || null,
  };
}
