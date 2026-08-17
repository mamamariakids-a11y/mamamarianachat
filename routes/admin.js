const express = require('express');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin'));

function randomColor() {
  const palette = ['#5B8DEF', '#3AA0A0', '#E0A23A', '#B65C9E', '#4A7CE0', '#D9634F'];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ---------- Dashboard ----------
router.get('/', async (req, res, next) => {
  try {
    const startWeek = dayjs().startOf('week').format('YYYY-MM-DD');
    const endWeek = dayjs().endOf('week').format('YYYY-MM-DD');

    const totalsResult = await db.execute({
      sql: `SELECT
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id = ia.item_id WHERE i.scheduled_date BETWEEN ? AND ?) AS total,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id = ia.item_id WHERE i.scheduled_date BETWEEN ? AND ? AND ia.status='pending') AS pending,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id = ia.item_id WHERE i.scheduled_date BETWEEN ? AND ? AND ia.status='received') AS received,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id = ia.item_id WHERE i.scheduled_date BETWEEN ? AND ? AND ia.status='executed') AS executed
      `,
      args: [startWeek, endWeek, startWeek, endWeek, startWeek, endWeek, startWeek, endWeek],
    });
    const totals = totalsResult.rows[0];

    const classesCountResult = await db.execute('SELECT COUNT(*) AS c FROM classes');
    const teachersCountResult = await db.execute("SELECT COUNT(*) AS c FROM users WHERE role='teacher' AND active=1");
    const childrenCountResult = await db.execute('SELECT COUNT(*) AS c FROM children');

    const classesOverviewResult = await db.execute({
      sql: `SELECT classes.id, classes.name, classes.color, users.name AS teacher_name,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id=ia.item_id WHERE ia.class_id=classes.id AND i.scheduled_date BETWEEN ? AND ?) AS assigned_count,
        (SELECT COUNT(*) FROM item_assignments ia JOIN items i ON i.id=ia.item_id WHERE ia.class_id=classes.id AND i.scheduled_date BETWEEN ? AND ? AND ia.status='executed') AS done_count
       FROM classes LEFT JOIN users ON users.id = classes.teacher_id
       ORDER BY classes.name`,
      args: [startWeek, endWeek, startWeek, endWeek],
    });

    const recentItemsResult = await db.execute(
      `SELECT items.*, GROUP_CONCAT(DISTINCT classes.name) AS class_names
       FROM items LEFT JOIN item_assignments ON item_assignments.item_id = items.id
       LEFT JOIN classes ON classes.id = item_assignments.class_id
       GROUP BY items.id ORDER BY items.created_at DESC LIMIT 6`
    );

    res.render('admin/dashboard', {
      title: 'لوحة التحكم',
      totals,
      classesCount: Number(classesCountResult.rows[0].c),
      teachersCount: Number(teachersCountResult.rows[0].c),
      childrenCount: Number(childrenCountResult.rows[0].c),
      classesOverview: classesOverviewResult.rows,
      recentItems: recentItemsResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Users ----------
router.get('/users', async (req, res, next) => {
  try {
    const result = await db.execute("SELECT * FROM users ORDER BY (role = 'admin') DESC, role, name");
    res.render('admin/users', { title: 'المستخدمون', users: result.rows, error: null, formData: null });
  } catch (err) {
    next(err);
  }
});

router.post('/users', async (req, res, next) => {
  try {
    const { name, email, password, role, phone } = req.body;
    if (!name || !email || !password || !role) {
      const result = await db.execute('SELECT * FROM users ORDER BY role, name');
      return res.status(400).render('admin/users', { title: 'المستخدمون', users: result.rows, error: 'يرجى تعبئة جميع الحقول المطلوبة.', formData: req.body });
    }
    try {
      await db.execute({
        sql: 'INSERT INTO users (name, email, password_hash, role, phone, avatar_color) VALUES (?, ?, ?, ?, ?, ?)',
        args: [name, email.trim().toLowerCase(), bcrypt.hashSync(password, 10), role, phone || '', randomColor()],
      });
      res.redirect('/admin/users');
    } catch (e) {
      const result = await db.execute('SELECT * FROM users ORDER BY role, name');
      res.status(400).render('admin/users', {
        title: 'المستخدمون',
        users: result.rows,
        error: e.message.includes('UNIQUE') ? 'هذا البريد الإلكتروني مستخدم بالفعل.' : 'حدث خطأ أثناء الإضافة.',
        formData: req.body,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/toggle', async (req, res, next) => {
  try {
    const result = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.params.id] });
    const u = result.rows[0];
    if (u) await db.execute({ sql: 'UPDATE users SET active = ? WHERE id = ?', args: [u.active ? 0 : 1, u.id] });
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/delete', async (req, res, next) => {
  try {
    try {
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [req.params.id] });
    } catch (e) {
      // has related records (e.g. created items) -> deactivate instead of hard delete
      await db.execute({ sql: 'UPDATE users SET active = 0 WHERE id = ?', args: [req.params.id] });
    }
    res.redirect('/admin/users');
  } catch (err) {
    next(err);
  }
});

// ---------- Classes ----------
router.get('/classes', async (req, res, next) => {
  try {
    const classesResult = await db.execute(
      `SELECT classes.*, users.name AS teacher_name,
        (SELECT COUNT(*) FROM children WHERE children.class_id = classes.id) AS children_count
       FROM classes LEFT JOIN users ON users.id = classes.teacher_id ORDER BY classes.name`
    );
    const teachersResult = await db.execute("SELECT * FROM users WHERE role='teacher' AND active=1 ORDER BY name");
    res.render('admin/classes', { title: 'الفصول', classes: classesResult.rows, teachers: teachersResult.rows, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/classes', async (req, res, next) => {
  try {
    const { name, age_range, teacher_id } = req.body;
    if (!name) {
      const classesResult = await db.execute('SELECT classes.*, users.name AS teacher_name FROM classes LEFT JOIN users ON users.id=classes.teacher_id');
      const teachersResult = await db.execute("SELECT * FROM users WHERE role='teacher' AND active=1");
      return res.status(400).render('admin/classes', { title: 'الفصول', classes: classesResult.rows, teachers: teachersResult.rows, error: 'اسم الفصل مطلوب.' });
    }
    await db.execute({
      sql: 'INSERT INTO classes (name, age_range, teacher_id, color) VALUES (?, ?, ?, ?)',
      args: [name, age_range || '', teacher_id || null, randomColor()],
    });
    res.redirect('/admin/classes');
  } catch (err) {
    next(err);
  }
});

router.post('/classes/:id', async (req, res, next) => {
  try {
    const { name, age_range, teacher_id } = req.body;
    await db.execute({
      sql: 'UPDATE classes SET name=?, age_range=?, teacher_id=? WHERE id=?',
      args: [name, age_range || '', teacher_id || null, req.params.id],
    });
    res.redirect('/admin/classes');
  } catch (err) {
    next(err);
  }
});

router.post('/classes/:id/delete', async (req, res, next) => {
  try {
    try {
      await db.execute({ sql: 'DELETE FROM classes WHERE id = ?', args: [req.params.id] });
    } catch (e) {
      // ignore if referenced
    }
    res.redirect('/admin/classes');
  } catch (err) {
    next(err);
  }
});

// ---------- Children ----------
router.get('/children', async (req, res, next) => {
  try {
    const childrenResult = await db.execute(
      `SELECT children.*, classes.name AS class_name, users.name AS parent_name
       FROM children LEFT JOIN classes ON classes.id = children.class_id
       LEFT JOIN users ON users.id = children.parent_id ORDER BY children.name`
    );
    const classesResult = await db.execute('SELECT * FROM classes ORDER BY name');
    const parentsResult = await db.execute("SELECT * FROM users WHERE role='parent' AND active=1 ORDER BY name");
    res.render('admin/children', {
      title: 'الأطفال',
      children: childrenResult.rows,
      classes: classesResult.rows,
      parents: parentsResult.rows,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/children', async (req, res, next) => {
  try {
    const { name, class_id, parent_id } = req.body;
    if (!name) return res.redirect('/admin/children');
    await db.execute({
      sql: 'INSERT INTO children (name, class_id, parent_id) VALUES (?, ?, ?)',
      args: [name, class_id || null, parent_id || null],
    });
    res.redirect('/admin/children');
  } catch (err) {
    next(err);
  }
});

router.post('/children/:id/delete', async (req, res, next) => {
  try {
    await db.execute({ sql: 'DELETE FROM children WHERE id = ?', args: [req.params.id] });
    res.redirect('/admin/children');
  } catch (err) {
    next(err);
  }
});

// ---------- Attendance ----------
router.get('/attendance', async (req, res, next) => {
  try {
    const view = req.query.view === 'month' ? 'month' : 'day';

    if (view === 'month') {
      const month = req.query.month && dayjs(req.query.month, 'YYYY-MM', true).isValid() ? req.query.month : dayjs().format('YYYY-MM');
      const monthStart = dayjs(month, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      const monthEnd = dayjs(month, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');

      const rowsResult = await db.execute({
        sql: `SELECT children.id AS child_id, children.name AS child_name,
                     classes.id AS class_id, classes.name AS class_name, classes.color AS class_color,
                     SUM(CASE WHEN attendance.status='present' THEN 1 ELSE 0 END) AS present_count,
                     SUM(CASE WHEN attendance.status='absent' THEN 1 ELSE 0 END) AS absent_count
              FROM children
              JOIN classes ON classes.id = children.class_id
              LEFT JOIN attendance ON attendance.child_id = children.id AND attendance.date BETWEEN ? AND ?
              GROUP BY children.id
              ORDER BY classes.name, children.name`,
        args: [monthStart, monthEnd],
      });

      const children = rowsResult.rows.map((r) => {
        const present = Number(r.present_count);
        const absent = Number(r.absent_count);
        const marked = present + absent;
        return { ...r, present_count: present, absent_count: absent, marked, rate: marked ? Math.round((present / marked) * 100) : null };
      });

      const classesMap = new Map();
      children.forEach((c) => {
        if (!classesMap.has(c.class_id)) classesMap.set(c.class_id, { id: c.class_id, name: c.class_name, color: c.class_color, children: [], present: 0, marked: 0 });
        const cls = classesMap.get(c.class_id);
        cls.children.push(c);
        cls.present += c.present_count;
        cls.marked += c.marked;
      });
      const classesReport = [...classesMap.values()].map((c) => ({ ...c, rate: c.marked ? Math.round((c.present / c.marked) * 100) : null }));

      return res.render('admin/attendance', {
        title: 'الحضور والغياب',
        view,
        month,
        monthLabel: dayjs(month, 'YYYY-MM').format('MMMM YYYY'),
        prevMonth: dayjs(month, 'YYYY-MM').subtract(1, 'month').format('YYYY-MM'),
        nextMonth: dayjs(month, 'YYYY-MM').add(1, 'month').format('YYYY-MM'),
        classesReport,
      });
    }

    const date = req.query.date && dayjs(req.query.date).isValid() ? req.query.date : dayjs().format('YYYY-MM-DD');

    const rowsResult = await db.execute({
      sql: `SELECT children.id AS child_id, children.name AS child_name,
                   classes.id AS class_id, classes.name AS class_name, classes.color AS class_color,
                   attendance.status, users.name AS marked_by_name
            FROM children
            JOIN classes ON classes.id = children.class_id
            LEFT JOIN attendance ON attendance.child_id = children.id AND attendance.date = ?
            LEFT JOIN users ON users.id = attendance.marked_by
            ORDER BY classes.name, children.name`,
      args: [date],
    });

    const classesMap = new Map();
    rowsResult.rows.forEach((r) => {
      if (!classesMap.has(r.class_id)) classesMap.set(r.class_id, { id: r.class_id, name: r.class_name, color: r.class_color, children: [], present: 0, absent: 0, unmarked: 0 });
      const cls = classesMap.get(r.class_id);
      cls.children.push(r);
      if (r.status === 'present') cls.present += 1;
      else if (r.status === 'absent') cls.absent += 1;
      else cls.unmarked += 1;
    });
    const classesToday = [...classesMap.values()];
    const totals = classesToday.reduce(
      (acc, c) => ({ present: acc.present + c.present, absent: acc.absent + c.absent, unmarked: acc.unmarked + c.unmarked }),
      { present: 0, absent: 0, unmarked: 0 }
    );

    res.render('admin/attendance', {
      title: 'الحضور والغياب',
      view,
      date,
      isToday: date === dayjs().format('YYYY-MM-DD'),
      prevDate: dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'),
      nextDate: dayjs(date).add(1, 'day').format('YYYY-MM-DD'),
      classesToday,
      totals,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
