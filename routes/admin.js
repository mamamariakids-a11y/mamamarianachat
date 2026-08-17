const express = require('express');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin'));

// ---------- Dashboard ----------
router.get('/', (req, res) => {
  const startWeek = dayjs().startOf('week').format('YYYY-MM-DD');
  const endWeek = dayjs().endOf('week').format('YYYY-MM-DD');

  const totals = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id = ia.item_id WHERE i.scheduled_date BETWEEN ? AND ?) AS total,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id = ia.item_id WHERE i.scheduled_date BETWEEN ? AND ? AND ia.status='pending') AS pending,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id = ia.item_id WHERE i.scheduled_date BETWEEN ? AND ? AND ia.status='received') AS received,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id = ia.item_id WHERE i.scheduled_date BETWEEN ? AND ? AND ia.status='executed') AS executed
      `
    )
    .get(startWeek, endWeek, startWeek, endWeek, startWeek, endWeek, startWeek, endWeek);

  const classesCount = db.prepare('SELECT COUNT(*) AS c FROM classes').get().c;
  const teachersCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='teacher' AND active=1").get().c;
  const childrenCount = db.prepare('SELECT COUNT(*) AS c FROM children').get().c;

  const classesOverview = db
    .prepare(
      `SELECT classes.id, classes.name, classes.color, users.name AS teacher_name,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id=ia.item_id WHERE ia.class_id=classes.id AND i.scheduled_date BETWEEN ? AND ?) AS assigned_count,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id=ia.item_id WHERE ia.class_id=classes.id AND i.scheduled_date BETWEEN ? AND ? AND ia.status='executed') AS done_count
       FROM classes LEFT JOIN users ON users.id = classes.teacher_id
       ORDER BY classes.name`
    )
    .all(startWeek, endWeek, startWeek, endWeek);

  const recentItems = db
    .prepare(
      `SELECT items.*, GROUP_CONCAT(DISTINCT classes.name) AS class_names
       FROM items LEFT JOIN item_assignments ON item_assignments.item_id = items.id
       LEFT JOIN classes ON classes.id = item_assignments.class_id
       GROUP BY items.id ORDER BY items.created_at DESC LIMIT 6`
    )
    .all();

  res.render('admin/dashboard', {
    title: 'لوحة التحكم',
    totals,
    classesCount,
    teachersCount,
    childrenCount,
    classesOverview,
    recentItems,
  });
});

// ---------- Users ----------
router.get('/users', (req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY (role = 'admin') DESC, role, name").all();
  res.render('admin/users', { title: 'المستخدمون', users, error: null, formData: null });
});

router.post('/users', (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !password || !role) {
    const users = db.prepare('SELECT * FROM users ORDER BY role, name').all();
    return res.status(400).render('admin/users', { title: 'المستخدمون', users, error: 'يرجى تعبئة جميع الحقول المطلوبة.', formData: req.body });
  }
  try {
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role, phone, avatar_color) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(name, email.trim().toLowerCase(), bcrypt.hashSync(password, 10), role, phone || '', randomColor());
    res.redirect('/admin/users');
  } catch (e) {
    const users = db.prepare('SELECT * FROM users ORDER BY role, name').all();
    res.status(400).render('admin/users', {
      title: 'المستخدمون',
      users,
      error: e.message.includes('UNIQUE') ? 'هذا البريد الإلكتروني مستخدم بالفعل.' : 'حدث خطأ أثناء الإضافة.',
      formData: req.body,
    });
  }
});

router.post('/users/:id/toggle', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (u) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(u.active ? 0 : 1, u.id);
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  } catch (e) {
    // has related records (e.g. created items) -> deactivate instead of hard delete
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  }
  res.redirect('/admin/users');
});

function randomColor() {
  const palette = ['#5B8DEF', '#3AA0A0', '#E0A23A', '#B65C9E', '#4A7CE0', '#D9634F'];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ---------- Classes ----------
router.get('/classes', (req, res) => {
  const classes = db
    .prepare(
      `SELECT classes.*, users.name AS teacher_name,
        (SELECT COUNT(*) FROM children WHERE children.class_id = classes.id) AS children_count
       FROM classes LEFT JOIN users ON users.id = classes.teacher_id ORDER BY classes.name`
    )
    .all();
  const teachers = db.prepare("SELECT * FROM users WHERE role='teacher' AND active=1 ORDER BY name").all();
  res.render('admin/classes', { title: 'الفصول', classes, teachers, error: null });
});

router.post('/classes', (req, res) => {
  const { name, age_range, teacher_id } = req.body;
  if (!name) {
    const classes = db.prepare('SELECT classes.*, users.name AS teacher_name FROM classes LEFT JOIN users ON users.id=classes.teacher_id').all();
    const teachers = db.prepare("SELECT * FROM users WHERE role='teacher' AND active=1").all();
    return res.status(400).render('admin/classes', { title: 'الفصول', classes, teachers, error: 'اسم الفصل مطلوب.' });
  }
  db.prepare('INSERT INTO classes (name, age_range, teacher_id, color) VALUES (?, ?, ?, ?)').run(
    name,
    age_range || '',
    teacher_id || null,
    randomColor()
  );
  res.redirect('/admin/classes');
});

router.post('/classes/:id', (req, res) => {
  const { name, age_range, teacher_id } = req.body;
  db.prepare('UPDATE classes SET name=?, age_range=?, teacher_id=? WHERE id=?').run(
    name,
    age_range || '',
    teacher_id || null,
    req.params.id
  );
  res.redirect('/admin/classes');
});

router.post('/classes/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  } catch (e) {
    // ignore if referenced
  }
  res.redirect('/admin/classes');
});

// ---------- Children ----------
router.get('/children', (req, res) => {
  const children = db
    .prepare(
      `SELECT children.*, classes.name AS class_name, users.name AS parent_name
       FROM children LEFT JOIN classes ON classes.id = children.class_id
       LEFT JOIN users ON users.id = children.parent_id ORDER BY children.name`
    )
    .all();
  const classes = db.prepare('SELECT * FROM classes ORDER BY name').all();
  const parents = db.prepare("SELECT * FROM users WHERE role='parent' AND active=1 ORDER BY name").all();
  res.render('admin/children', { title: 'الأطفال', children, classes, parents, error: null });
});

router.post('/children', (req, res) => {
  const { name, class_id, parent_id } = req.body;
  if (!name) return res.redirect('/admin/children');
  db.prepare('INSERT INTO children (name, class_id, parent_id) VALUES (?, ?, ?)').run(
    name,
    class_id || null,
    parent_id || null
  );
  res.redirect('/admin/children');
});

router.post('/children/:id/delete', (req, res) => {
  db.prepare('DELETE FROM children WHERE id = ?').run(req.params.id);
  res.redirect('/admin/children');
});

module.exports = router;
