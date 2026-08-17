const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require('./db');
const upload = require('./utils/upload');
const { attachUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serves uploaded files from UPLOAD_DIR even when DATA_DIR points them
// outside the public/ folder (e.g. a mounted persistent disk in production).
app.use('/uploads', express.static(upload.UPLOAD_DIR));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.db', dir: db.DATA_DIR }),
    secret: process.env.SESSION_SECRET || 'mamamaria-kindergarten-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
      httpOnly: true,
      secure: isProd,
    },
  })
);

app.use(attachUser(db));

app.locals.dayjs = require('dayjs');
require('dayjs/locale/ar');
app.locals.dayjs.locale('ar');

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const roleHome = {
    admin: '/admin',
    director: '/director',
    teacher: '/teacher',
    parent: '/parent',
  };
  res.redirect(roleHome[req.session.user.role] || '/login');
});

app.use('/', require('./routes/auth'));
app.use('/account', require('./routes/account'));
app.use('/notifications', require('./routes/notifications'));
app.use('/director', require('./routes/director'));
app.use('/teacher', require('./routes/teacher'));
app.use('/admin', require('./routes/admin'));
app.use('/parent', require('./routes/parent'));

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'الصفحة غير موجودة',
    message: 'عذرًا، الصفحة التي تبحث عنها غير موجودة.',
    user: req.session.user,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'حدث خطأ',
    message: err.message || 'حدث خطأ غير متوقع، يرجى المحاولة لاحقًا.',
    user: req.session.user,
  });
});

app.listen(PORT, () => {
  console.log(`🌱 روضة ماما ماريا تعمل الآن على المنفذ ${PORT}`);
});
