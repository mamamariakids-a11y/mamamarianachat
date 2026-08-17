const express = require('express');
const dayjs = require('dayjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const upload = require('../utils/upload');
const { notifyMany } = require('../utils/notify');

const router = express.Router();
router.use(requireRole('teacher'));

async function myClassIds(userId) {
  const result = await db.execute({ sql: 'SELECT id FROM classes WHERE teacher_id = ?', args: [userId] });
  return result.rows.map((r) => r.id);
}

async function myClasses(userId) {
  const result = await db.execute({
    sql: 'SELECT id, name, color FROM classes WHERE teacher_id = ? ORDER BY name',
    args: [userId],
  });
  return result.rows;
}

async function staffToNotify() {
  const result = await db.execute("SELECT id FROM users WHERE role IN ('director','admin') AND active = 1");
  return result.rows.map((r) => r.id);
}

async function parentsOfClass(classId) {
  const result = await db.execute({
    sql: 'SELECT DISTINCT parent_id FROM children WHERE class_id = ? AND parent_id IS NOT NULL',
    args: [classId],
  });
  return result.rows.map((r) => r.parent_id);
}

router.get('/', async (req, res, next) => {
  try {
    const classIds = await myClassIds(req.session.user.id);
    const view = req.query.view === 'month' ? 'month' : 'week';
    const anchor = req.query.date ? dayjs(req.query.date) : dayjs();
    const start = view === 'month' ? anchor.startOf('month').startOf('week') : anchor.startOf('week');
    const end = view === 'month' ? anchor.endOf('month').endOf('week') : anchor.endOf('week');

    let items = [];
    if (classIds.length) {
      const placeholders = classIds.map(() => '?').join(',');
      const result = await db.execute({
        sql: `SELECT items.*, item_assignments.status AS my_status, item_assignments.class_id AS my_class_id,
                     item_assignments.id AS assignment_id, classes.name AS class_name
              FROM item_assignments
              JOIN items ON items.id = item_assignments.item_id
              JOIN classes ON classes.id = item_assignments.class_id
              WHERE item_assignments.class_id IN (${placeholders})
                AND items.scheduled_date BETWEEN ? AND ?
              ORDER BY items.scheduled_date ASC`,
        args: [...classIds, start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')],
      });
      items = result.rows;
    }

    const days = [];
    let cursor = start.clone();
    while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
      days.push({
        date: cursor.format('YYYY-MM-DD'),
        label: cursor.format('dddd'),
        dayNum: cursor.format('D'),
        isToday: cursor.isSame(dayjs(), 'day'),
        inMonth: cursor.isSame(anchor, 'month'),
        items: items.filter((i) => i.scheduled_date === cursor.format('YYYY-MM-DD')),
      });
      cursor = cursor.add(1, 'day');
    }

    const pendingCount = items.filter((i) => i.my_status === 'pending').length;

    res.render('teacher/calendar', {
      title: 'جدولي الأسبوعي',
      view,
      anchor: anchor.format('YYYY-MM-DD'),
      monthLabel: anchor.format('MMMM YYYY'),
      prevDate: (view === 'month' ? anchor.subtract(1, 'month') : anchor.subtract(1, 'week')).format('YYYY-MM-DD'),
      nextDate: (view === 'month' ? anchor.add(1, 'month') : anchor.add(1, 'week')).format('YYYY-MM-DD'),
      days,
      pendingCount,
      hasClass: classIds.length > 0,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/items/:id', async (req, res, next) => {
  try {
    const classIds = await myClassIds(req.session.user.id);
    const itemResult = await db.execute({ sql: 'SELECT * FROM items WHERE id = ?', args: [req.params.id] });
    const item = itemResult.rows[0];
    if (!item) return res.status(404).render('error', { title: 'غير موجود', message: 'العنصر غير موجود.' });

    const placeholders = classIds.map(() => '?').join(',') || '0';
    const assignResult = await db.execute({
      sql: `SELECT item_assignments.*, classes.name AS class_name
            FROM item_assignments JOIN classes ON classes.id = item_assignments.class_id
            WHERE item_assignments.item_id = ? AND item_assignments.class_id IN (${placeholders})`,
      args: [item.id, ...classIds],
    });

    if (!assignResult.rows.length) {
      return res.status(403).render('error', { title: 'غير مصرح', message: 'هذا الدرس/النشاط غير مخصص لفصلك.' });
    }

    res.render('teacher/item-detail', {
      title: item.title,
      item: { ...item, attachments: JSON.parse(item.attachments || '[]') },
      assignments: assignResult.rows.map((a) => ({ ...a, execution_photos: JSON.parse(a.execution_photos || '[]') })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/items/:id/receive', async (req, res, next) => {
  try {
    const { assignment_id } = req.body;
    const assignResult = await db.execute({
      sql: 'SELECT * FROM item_assignments WHERE id = ? AND item_id = ?',
      args: [assignment_id, req.params.id],
    });
    const assignment = assignResult.rows[0];
    if (!assignment) return res.status(404).render('error', { title: 'غير موجود', message: 'غير موجود.' });

    await db.execute({
      sql: "UPDATE item_assignments SET status='received', received_at=datetime('now'), received_by=? WHERE id=?",
      args: [req.session.user.id, assignment.id],
    });

    const itemResult = await db.execute({ sql: 'SELECT title FROM items WHERE id = ?', args: [req.params.id] });
    const item = itemResult.rows[0];
    await notifyMany(
      await staffToNotify(),
      'تم استلام درس/نشاط',
      `قامت ${req.session.user.name} بتأكيد استلام: ${item.title}`,
      `/director/items/${req.params.id}`
    );

    res.redirect(`/teacher/items/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/items/:id/execute', upload.array('photos', 8), async (req, res, next) => {
  try {
    const { assignment_id, execution_notes } = req.body;
    const assignResult = await db.execute({
      sql: 'SELECT * FROM item_assignments WHERE id = ? AND item_id = ?',
      args: [assignment_id, req.params.id],
    });
    const assignment = assignResult.rows[0];
    if (!assignment) return res.status(404).render('error', { title: 'غير موجود', message: 'غير موجود.' });

    const photos = (req.files || []).map(upload.fileToRecord);
    const existing = JSON.parse(assignment.execution_photos || '[]');

    await db.execute({
      sql: `UPDATE item_assignments SET status='executed', executed_at=datetime('now'), executed_by=?,
            execution_notes=?, execution_photos=? WHERE id=?`,
      args: [req.session.user.id, execution_notes || '', JSON.stringify([...existing, ...photos]), assignment.id],
    });

    const itemResult = await db.execute({ sql: 'SELECT title FROM items WHERE id = ?', args: [req.params.id] });
    const item = itemResult.rows[0];

    await notifyMany(
      await staffToNotify(),
      'تم تنفيذ درس/نشاط',
      `قامت ${req.session.user.name} بتأكيد تنفيذ: ${item.title}`,
      `/director/items/${req.params.id}`
    );
    await notifyMany(
      await parentsOfClass(assignment.class_id),
      'نشاط جديد لطفلك 🎨',
      `تم تنفيذ: ${item.title}`,
      `/parent`
    );

    res.redirect(`/teacher/items/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// ---------- Attendance ----------
router.get('/attendance', async (req, res, next) => {
  try {
    const classes = await myClasses(req.session.user.id);
    if (!classes.length) {
      return res.render('teacher/attendance', {
        title: 'الحضور والغياب',
        classes: [],
        activeClass: null,
        date: dayjs().format('YYYY-MM-DD'),
        children: [],
      });
    }

    const requestedClassId = Number(req.query.class_id) || classes[0].id;
    const activeClass = classes.find((c) => c.id === requestedClassId) || classes[0];
    const date = req.query.date && dayjs(req.query.date).isValid() ? req.query.date : dayjs().format('YYYY-MM-DD');

    const childrenResult = await db.execute({
      sql: 'SELECT id, name FROM children WHERE class_id = ? ORDER BY name',
      args: [activeClass.id],
    });

    const attResult = await db.execute({
      sql: 'SELECT child_id, status FROM attendance WHERE class_id = ? AND date = ?',
      args: [activeClass.id, date],
    });
    const statusMap = {};
    attResult.rows.forEach((r) => { statusMap[r.child_id] = r.status; });

    const children = childrenResult.rows.map((c) => ({ ...c, status: statusMap[c.id] || null }));
    const markedCount = children.filter((c) => c.status).length;

    res.render('teacher/attendance', {
      title: 'الحضور والغياب',
      classes,
      activeClass,
      date,
      children,
      markedCount,
      isToday: date === dayjs().format('YYYY-MM-DD'),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/attendance', async (req, res, next) => {
  try {
    const classes = await myClasses(req.session.user.id);
    const classId = Number(req.body.class_id);
    if (!classes.some((c) => c.id === classId)) {
      return res.status(403).render('error', { title: 'غير مصرح', message: 'هذا الفصل ليس فصلك.' });
    }
    const date = req.body.date && dayjs(req.body.date).isValid() ? req.body.date : dayjs().format('YYYY-MM-DD');

    const childrenResult = await db.execute({ sql: 'SELECT id FROM children WHERE class_id = ?', args: [classId] });

    for (const child of childrenResult.rows) {
      const status = req.body[`status_${child.id}`];
      if (status !== 'present' && status !== 'absent') continue;
      // eslint-disable-next-line no-await-in-loop
      await db.execute({
        sql: `INSERT INTO attendance (child_id, class_id, date, status, marked_by)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(child_id, date) DO UPDATE SET
                status = excluded.status, marked_by = excluded.marked_by, updated_at = datetime('now')`,
        args: [child.id, classId, date, status, req.session.user.id],
      });
    }

    res.redirect(`/teacher/attendance?class_id=${classId}&date=${date}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
