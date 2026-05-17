
const http = require('http');
const fs = require('fs');
const path = require('path');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { nodemailer = null; }

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach(line => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    const idx = clean.indexOf('=');
    if (idx === -1) return;
    const key = clean.slice(0, idx).trim();
    const val = clean.slice(idx + 1).trim();
    process.env[key] = val;
  });
}
loadEnv();


const ALLOWED_DOMAINS = ['@hrsd.gov.sa', '@edraakcm.sa'];

function isAllowedEmail(email='') {
  const e = String(email).trim().toLowerCase();
  return ALLOWED_DOMAINS.some(domain => e.endsWith(domain));
}


async function sendWelcomeEmail(newUser) {
  if (!nodemailer) {
    console.log('nodemailer غير مثبت. شغلي: npm install');
    return { sent: false, reason: 'nodemailer not installed' };
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || user;
  const systemUrl = process.env.SYSTEM_URL || 'http://localhost:3000';

  if (!host || !user || !pass) {
    console.log('إعدادات البريد غير مكتملة في ملف .env');
    return { sent: false, reason: 'missing smtp config' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  const roleLabel = newUser.role === 'admin' ? 'مدير النظام' : (newUser.role === 'supervisor' ? 'مشرف جودة' : (newUser.role === 'employee' ? 'موظف جلسة' : 'موظف جودة'));

  await transporter.sendMail({
    from,
    to: newUser.email,
    subject: 'تم إنشاء حسابك في نظام تقييم جودة المكالمات',
    text:
`مرحباً ${newUser.name}

تم إنشاء حسابك في نظام تقييم جودة المكالمات.

نوع الحساب: ${roleLabel}
رابط الدخول: ${systemUrl}
البريد الإلكتروني: ${newUser.email}
كلمة المرور: ${newUser.password}

يرجى حفظ بيانات الدخول وعدم مشاركتها.

مع التحية`,
    html:
`<div dir="rtl" style="font-family:Arial,Tahoma,sans-serif;line-height:1.8">
  <h2>تم إنشاء حسابك في نظام تقييم جودة المكالمات</h2>
  <p>مرحباً <b>${newUser.name}</b></p>
  <p>تم إنشاء حسابك بنجاح.</p>
  <table style="border-collapse:collapse;width:100%;max-width:520px">
    <tr><td style="border:1px solid #ddd;padding:8px">نوع الحساب</td><td style="border:1px solid #ddd;padding:8px">${roleLabel}</td></tr>
    <tr><td style="border:1px solid #ddd;padding:8px">رابط الدخول</td><td style="border:1px solid #ddd;padding:8px"><a href="${systemUrl}">${systemUrl}</a></td></tr>
    <tr><td style="border:1px solid #ddd;padding:8px">البريد الإلكتروني</td><td style="border:1px solid #ddd;padding:8px">${newUser.email}</td></tr>
    <tr><td style="border:1px solid #ddd;padding:8px">كلمة المرور</td><td style="border:1px solid #ddd;padding:8px">${newUser.password}</td></tr>
  </table>
  <p>يرجى حفظ بيانات الدخول وعدم مشاركتها.</p>
</div>`
  });

  return { sent: true };
}

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], evaluations: [] }, null, 2));
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}
function send(res, status, data, type='application/json') {
  res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}
function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}
function publicUser(u) {
  return { email: u.email, name: u.name, role: u.role, disabled: !!u.disabled };
}
function authUser(req) {
  const email = String(req.headers['x-user-email'] || '').trim().toLowerCase();
  if (!email) return null;
  const db = readDB();
  const user = db.users.find(u => String(u.email || '').trim().toLowerCase() === email) || null;
  if (user && user.disabled) return null;
  return user;
}


function computeQualityMetrics(answers = {}, score = 0) {
  const values = Object.values(answers || {});
  const applicable = values.filter(v => v !== 'na');
  const totalApplicable = applicable.length || 1;
  const yesCount = values.filter(v => v === 'yes').length;
  const noCount = values.filter(v => v === 'no').length;
  const yesRate = Math.round((yesCount / totalApplicable) * 100);
  const noRate = Math.round((noCount / totalApplicable) * 100);

  const sectionStats = {};
  Object.entries(answers || {}).forEach(([key, val]) => {
    const section = key.split('__')[0] || 'عام';
    if (!sectionStats[section]) sectionStats[section] = { yes: 0, no: 0, total: 0 };
    if (val !== 'na') {
      sectionStats[section].total++;
      if (val === 'yes') sectionStats[section].yes++;
      if (val === 'no') sectionStats[section].no++;
    }
  });

  const sectionRate = (sectionName) => {
    const s = sectionStats[sectionName];
    if (!s || !s.total) return yesRate;
    return Math.round((s.yes / s.total) * 100);
  };

  const responseRate = sectionRate('مهارات التعامل مع المكالمات');
  const serviceRate = sectionRate('جودة خدمة العملاء');
  const etiquetteRate = sectionRate('آداب مركز الاتصال');
  const solvingRate = sectionRate('القدرة على حل المشكلة');
  const closureRate = sectionRate('إنهاء المكالمة');

  const incomingSessions = 1;
  const answeredSessions = score >= 60 ? 1 : 0;
  const missedRate = answeredSessions ? 0 : 100;

  return {
    incomingSessions,
    answeredSessions,
    avgResponseTime: Math.max(5, Math.round(65 - responseRate * 0.55)),
    avgSessionTime: Math.max(2, Math.round(12 - solvingRate * 0.07)),
    customerSatisfaction: Math.round((serviceRate + etiquetteRate + score) / 3),
    nps: Math.round(((serviceRate + closureRate) / 2) - 50),
    branchPressure: Math.min(100, Math.max(0, Math.round(noRate * 1.2))),
    directExperienceRating: Math.round((serviceRate + etiquetteRate + closureRate) / 3),
    handledCalls: answeredSessions,
    resolutionRate: solvingRate,
    abandonmentRate: missedRate,
    operationalChallenges: noCount ? 'توجد نقاط تحتاج تحسين بناءً على إجابات لا في التقييم.' : '',
    recommendations: noCount ? 'مراجعة بنود التقييم التي حصلت على لا وتدريب الموظف عليها.' : 'الاستمرار على مستوى الأداء الحالي.'
  };
}


const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  if (req.url === '/' || req.url === '/index.html') {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'), 'text/html');
  }

  if (req.url === '/api/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const db = readDB();
    const loginEmail = String(body.email || '').trim().toLowerCase();
    const loginPassword = String(body.password || '').trim();

    if (!isAllowedEmail(loginEmail)) {
      return send(res, 403, { error: 'يسمح فقط ببريد الوزراة أو إدراك' });
    }
    const user = db.users.find(u => String(u.email || '').trim().toLowerCase() === loginEmail && String(u.password || '').trim() === loginPassword);
    if (!user) return send(res, 401, { error: 'بيانات الدخول غير صحيحة' });
    if (user.disabled) return send(res, 403, { error: 'هذا الحساب معطل' });
    return send(res, 200, { user: publicUser(user) });
  }

  if (req.url === '/api/meta' && req.method === 'GET') {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'meta.json'), 'utf8'));
    return send(res, 200, meta);
  }

  if (req.url === '/api/evaluations' && req.method === 'GET') {
    const user = authUser(req);
    if (!user) return send(res, 401, { error: 'غير مصرح' });
    const db = readDB();
    const evaluations = (user.role === 'admin' || user.role === 'supervisor')
      ? db.evaluations
      : db.evaluations.filter(e => e.evaluatorEmail === user.email);
    return send(res, 200, { evaluations });
  }

  if (req.url === '/api/evaluations' && req.method === 'POST') {
    const user = authUser(req);
    if (!user) return send(res, 401, { error: 'غير مصرح' });
    const body = await parseBody(req);
    const db = readDB();
    const item = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      dateText: new Date().toLocaleString('ar-SA'),
      evaluator: user.name,
      evaluatorEmail: user.email,
      branch: body.branch || '',
      employeeName: body.employeeName || '',
      employeeEmail: body.employeeEmail || '',
      callLink: body.callLink || '',
      ...computeQualityMetrics(body.answers || {}, Number(body.score || 0)),
      score: Number(body.score || 0),
      notes: body.notes || '',
      answers: body.answers || {}
    };
    db.evaluations.push(item);
    writeDB(db);
    return send(res, 200, { ok: true, item });
  }

  if (req.url === '/api/users' && req.method === 'GET') {
    const user = authUser(req);
    if (!user || user.role !== 'admin') return send(res, 403, { error: 'للمدير فقط' });
    const db = readDB();
    return send(res, 200, { users: db.users.map(publicUser) });
  }


  if (req.url === '/api/users' && req.method === 'POST') {
    const user = authUser(req);
    if (!user || user.role !== 'admin') return send(res, 403, { error: 'للمدير فقط' });
    const body = await parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    const name = String(body.name || '').trim();
    const role = body.role === 'admin' ? 'admin' : (body.role === 'supervisor' ? 'supervisor' : (body.role === 'employee' ? 'employee' : 'qa'));

    if (!email || !password || !name) {
      return send(res, 400, { error: 'الاسم والبريد وكلمة المرور مطلوبة' });
    }

    if (!isAllowedEmail(email)) {
      return send(res, 400, { error: 'يجب أن يكون البريد تابع للوزارة أو إدراك' });
    }

    const db = readDB();
    if (db.users.some(u => String(u.email).toLowerCase() === email)) {
      return send(res, 400, { error: 'هذا البريد مضاف مسبقًا' });
    }

    const newUser = { email, password, name, role };
    db.users.push(newUser);
    writeDB(db);

    let emailStatus = { sent: false };
    try {
      emailStatus = await sendWelcomeEmail(newUser);
    } catch (err) {
      console.log('فشل إرسال البريد:', err.message);
      emailStatus = { sent: false, reason: err.message };
    }

    return send(res, 200, { ok: true, user: publicUser(newUser), emailStatus });
  }


  if (req.url.startsWith('/api/users/') && req.method === 'PUT') {
    const user = authUser(req);
    if (!user || user.role !== 'admin') return send(res, 403, { error: 'للمدير فقط' });

    const oldEmail = decodeURIComponent(req.url.split('/api/users/')[1] || '').trim().toLowerCase();
    const body = await parseBody(req);

    const db = readDB();
    const target = db.users.find(u => String(u.email || '').trim().toLowerCase() === oldEmail);
    if (!target) return send(res, 404, { error: 'الحساب غير موجود' });

    const newEmail = String(body.email || target.email).trim().toLowerCase();
    const name = String(body.name || target.name).trim();
    const role = body.role === 'admin' ? 'admin' : (body.role === 'supervisor' ? 'supervisor' : (body.role === 'employee' ? 'employee' : 'qa'));
    let password = String(body.password || target.password).trim();
    if (password === 'KEEP_OLD_PASSWORD') password = target.password;

    if (!newEmail || !name || !password) return send(res, 400, { error: 'الاسم والبريد وكلمة المرور مطلوبة' });

    if (!isAllowedEmail(newEmail)) {
      return send(res, 400, { error: 'يجب أن يكون البريد تابع للوزارة أو إدراك' });
    }

    if (newEmail !== oldEmail && db.users.some(u => String(u.email || '').trim().toLowerCase() === newEmail)) {
      return send(res, 400, { error: 'البريد الجديد مستخدم مسبقًا' });
    }

    target.email = newEmail;
    target.name = name;
    target.role = role;
    target.password = password;
    target.disabled = !!body.disabled;

    writeDB(db);
    return send(res, 200, { ok: true, user: publicUser(target) });
  }

  if (req.url.startsWith('/api/users/') && req.method === 'DELETE') {
    const user = authUser(req);
    if (!user || user.role !== 'admin') return send(res, 403, { error: 'للمدير فقط' });

    const email = decodeURIComponent(req.url.split('/api/users/')[1] || '').trim().toLowerCase();
    if (String(user.email || '').trim().toLowerCase() === email) {
      return send(res, 400, { error: 'لا يمكنك حذف حسابك الحالي' });
    }

    const db = readDB();
    const before = db.users.length;
    db.users = db.users.filter(u => String(u.email || '').trim().toLowerCase() !== email);
    if (db.users.length === before) return send(res, 404, { error: 'الحساب غير موجود' });

    writeDB(db);
    return send(res, 200, { ok: true });
  }

  if (req.url === '/api/export' && req.method === 'GET') {
    const user = authUser(req);
    if (!user) return send(res, 401, { error: 'غير مصرح' });
    const db = readDB();
    const evaluations = (user.role === 'admin' || user.role === 'supervisor')
      ? db.evaluations
      : db.evaluations.filter(e => e.evaluatorEmail === user.email);
    const rows = [['التاريخ','المقيّم','بريد المقيم','الفرع','اسم الموظف','بريد الموظف','رابط التسجيل','عدد الجلسات الواردة','عدد الجلسات التي تم الرد عليها','نسبة الجلسات المفقودة','متوسط زمن الرد','متوسط زمن الجلسة','رضا العملاء','مؤشر صافي رضا العملاء','حجم الضغط على الفرع','تقييم مباشر لجودة التجربة','عدد المكالمات المعالجة','نسبة الحل','نسبة التخلي عن الجلسة','النسبة','التحديات التشغيلية','التوصيات','الملاحظات']];
    evaluations.forEach(e => {
      const missed = Math.max(0, Number(e.incomingSessions || 0) - Number(e.answeredSessions || 0));
      const missedRate = Number(e.incomingSessions || 0) ? Math.round((missed / Number(e.incomingSessions || 0)) * 100) + '%' : '0%';
      rows.push([e.dateText, e.evaluator, e.evaluatorEmail, e.branch, e.employeeName, e.employeeEmail, e.callLink, e.incomingSessions || 0, e.answeredSessions || 0, missedRate, e.avgResponseTime || 0, e.avgSessionTime || 0, e.customerSatisfaction || 0, e.nps || 0, e.branchPressure || 0, e.directExperienceRating || 0, e.handledCalls || 0, (e.resolutionRate || 0) + '%', (e.abandonmentRate || 0) + '%', e.score + '%', e.operationalChallenges || '', e.recommendations || '', e.notes]);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v || '').replace(/"/g,'""')}"`).join(',')).join('\n');
    return send(res, 200, csv, 'text/csv');
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log('======================================');
  console.log(' نظام تقييم جودة المكالمات يعمل الآن');
  console.log(' افتحي الرابط: http://localhost:' + PORT);
  console.log('======================================');
});
