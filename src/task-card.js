export async function createTaskCard(tasks) {
  if (!tasks.length || tasks.length > 10) throw new Error('每张图片卡片请选择 1—10 项任务；更多任务可分批或使用文字分享。');
  await document.fonts.ready;
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 1;
  const ctx = canvas.getContext('2d'); const lines = [], dividers = []; let y = 165;
  function paragraph(text, size, weight, color, spacing = 10) {
    const font = `${weight} ${size}px sans-serif`; ctx.font = font;
    for (const part of String(text).split('\n')) {
      let row = '';
      for (const character of part) {
        if (ctx.measureText(row + character).width > 860 && row) { lines.push({ text: row, y, font, color }); y += size * 1.55; row = ''; }
        row += character;
      }
      if (row) lines.push({ text: row, y, font, color });
      y += size * 1.55;
      if (y > 11800) throw new Error('任务要求过长，无法生成单张图片，请减少任务或改用文字分享。');
    }
    y += spacing;
  }
  for (const [index, task] of tasks.entries()) {
    if (index) { dividers.push(y); y += 42; }
    if (task.course) paragraph('课程：' + task.course, 23, 600, '#526b96', 8);
    paragraph(`${index + 1}. ${task.title}`, 32, 700, '#23364f', 12);
    paragraph(task.dueDate ? `${task.dueTime ? '截止时间' : '截止日期'}：${task.dueDate}${task.dueTime ? ' ' + task.dueTime : ''}` : '暂无截止日期', 25, 600, '#4267bd', 12);
    if (task.details) paragraph('要求：' + task.details, 24, 400, '#42546f', 12);
    if (task.completedAt) paragraph('状态：已完成', 23, 500, '#477c69', 6);
    y += 18;
  }
  canvas.height = Math.ceil(y + 86);
  ctx.fillStyle = '#f8faff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#eaf0ff'; ctx.fillRect(0, 0, canvas.width, 110);
  ctx.fillStyle = '#23364f'; ctx.font = '700 35px sans-serif'; ctx.fillText('拾课 · 课程任务', 48, 68);
  ctx.fillStyle = '#637b9b'; ctx.font = '20px sans-serif'; ctx.textAlign = 'right'; ctx.fillText(`共 ${tasks.length} 项`, 912, 65); ctx.textAlign = 'left';
  for (const line of lines) { ctx.font = line.font; ctx.fillStyle = line.color; ctx.fillText(line.text, 48, line.y); }
  ctx.strokeStyle = '#dce5f5'; ctx.lineWidth = 2;
  for (const top of dividers) { ctx.beginPath(); ctx.moveTo(48, top); ctx.lineTo(912, top); ctx.stroke(); }
  ctx.font = '19px sans-serif'; ctx.fillStyle = '#7d8da5'; ctx.fillText('拾课 · 学习任务助手', 48, canvas.height - 35);
  try { return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片卡片生成失败，请重试。')), 'image/png')); }
  finally { canvas.width = canvas.height = 1; }
}
