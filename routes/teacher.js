const express = require('express');
const dayjs = require('dayjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const upload = require('../utils/upload');
const { notifyMany } = require('../utils/notify');

const router = express.Router();
router.use(requireRole('teacher'));

function myClassIds(userId) {
  return db.prepare('SELECT id FROM classes WHERE teacher_id = ?').all(userId).map((r) => r.id);
}

function staffToNotify() {
  return db.prepare("SELECT id FROM users WHERE role IN ('director','admin') AND active = 1").all().map((r) => r.id);
}

function parentsOfClass(classId) {
  return db
    .prepare('SELECT DISTINCT parent_id FROM children WHERE class_id = ? AND parent_id IS NOT NULL')
    .all(classId)
    .map((r) => r.parent_id);
}

router.get('/', (req, res) => {
  const classIds = myClassIds(req.session.user.id);
  const view = req.query.view === 'month' ? 'month' : 'week';
  const anchor = req.query.date ? dayjs(req.query.date) : dayjs();
  const start = view === 'month' ? anchor.startOf('month').startOf('week') : anchor.startOf('week');
  const end = view === 'month' ? anchor.endOf('month').endOf('week') : anchor.endOf('week');

  let items = [];
  if (classIds.length) {
    const placeholders = classIds.map(() => '?').join(',');
    items = db
      .prepare(
        `SELECT items.*, item_assignments.status AS my_status, item_assignments.class_id AS my_class_id,
                item_assignments.id AS assignment_id, classes.name AS class_name
         FROM item_assignments
         JOIN items ON items.id = item_assignments.item_id
         JOIN classes ON classes.id = item_assignments.class_id
         WHERE item_assignments.class_id IN (${placeholders})
           AND items.scheduled_date BETWEEN ? AND ?
         ORDER BY items.scheduled_date ASC`
      )
      .all(...classIds, start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));
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
});

router.get('/items/:id', (req, res) => {
  const classIds = myClassIds(req.session.user.id);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).render('error', { title: 'غير موجود', message: 'العنصر غير موجود.' });

  const assignments = db
    .prepare(
      `SELECT item_assignments.*, classes.name AS class_name
       FROM item_assignments JOIN classes ON classes.id = item_assignments.class_id
       WHERE item_assignments.item_id = ? AND item_assignments.class_id IN (${classIds.map(() => '?').join(',') || '0'})`
    )
    .all(item.id, ...classIds);

  if (!assignments.length) {
    return res.status(403).render('error', { title: 'غير مصرح', message: 'هذا الدرس/النشاط غير مخصص لفصلك.' });
  }

  res.render('teacher/item-detail', {
    title: item.title,
    item: { ...item, attachments: JSON.parse(item.attachments || '[]') },
    assignments: assignments.map((a) => ({ ...a, execution_photos: JSON.parse(a.execution_photos || '[]') })),
  });
});

router.post('/items/:id/receive', (req, res) => {
  const { assignment_id } = req.body;
  const assignment = db.prepare('SELECT * FROM item_assignments WHERE id = ? AND item_id = ?').get(assignment_id, req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'غير موجود', message: 'غير موجود.' });

  db.prepare(
    "UPDATE item_assignments SET status='received', received_at=datetime('now'), received_by=? WHERE id=?"
  ).run(req.session.user.id, assignment.id);

  const item = db.prepare('SELECT title FROM items WHERE id = ?').get(req.params.id);
  notifyMany(
    staffToNotify(),
    'تم استلام درس/نشاط',
    `قامت ${req.session.user.name} بتأكيد استلام: ${item.title}`,
    `/director/items/${req.params.id}`
  );

  res.redirect(`/teacher/items/${req.params.id}`);
});

router.post('/items/:id/execute', upload.array('photos', 8), (req, res) => {
  const { assignment_id, execution_notes } = req.body;
  const assignment = db.prepare('SELECT * FROM item_assignments WHERE id = ? AND item_id = ?').get(assignment_id, req.params.id);
  if (!assignment) return res.status(404).render('error', { title: 'غير موجود', message: 'غير موجود.' });

  const photos = (req.files || []).map((f) => f.filename);
  const existing = JSON.parse(assignment.execution_photos || '[]');

  db.prepare(
    `UPDATE item_assignments SET status='executed', executed_at=datetime('now'), executed_by=?,
     execution_notes=?, execution_photos=? WHERE id=?`
  ).run(req.session.user.id, execution_notes || '', JSON.stringify([...existing, ...photos]), assignment.id);

  const item = db.prepare('SELECT title FROM items WHERE id = ?').get(req.params.id);

  notifyMany(
    staffToNotify(),
    'تم تنفيذ درس/نشاط',
    `قامت ${req.session.user.name} بتأكيد تنفيذ: ${item.title}`,
    `/director/items/${req.params.id}`
  );
  notifyMany(
    parentsOfClass(assignment.class_id),
    'نشاط جديد لطفلك 🎨',
    `تم تنفيذ: ${item.title}`,
    `/parent`
  );

  res.redirect(`/teacher/items/${req.params.id}`);
});

module.exports = router;
