const express = require('express');
const dayjs = require('dayjs');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const upload = require('../utils/upload');
const { notifyMany } = require('../utils/notify');

const router = express.Router();
router.use(requireRole('admin', 'director'));

function getClasses() {
  return db
    .prepare(
      `SELECT classes.*, users.name AS teacher_name
       FROM classes LEFT JOIN users ON users.id = classes.teacher_id
       ORDER BY classes.name`
    )
    .all();
}

function itemsWithStatus(startDate, endDate) {
  const rows = db
    .prepare(
      `SELECT items.*,
              GROUP_CONCAT(DISTINCT classes.name) AS class_names,
              MIN(item_assignments.status) AS min_status,
              COUNT(item_assignments.id) AS assignment_count,
              SUM(CASE WHEN item_assignments.status = 'executed' THEN 1 ELSE 0 END) AS executed_count
       FROM items
       LEFT JOIN item_assignments ON item_assignments.item_id = items.id
       LEFT JOIN classes ON classes.id = item_assignments.class_id
       WHERE items.scheduled_date BETWEEN ? AND ?
       GROUP BY items.id
       ORDER BY items.scheduled_date ASC, items.id ASC`
    )
    .all(startDate, endDate);
  return rows;
}

// ---------- Calendar (weekly / monthly) ----------
router.get('/', (req, res) => {
  const view = req.query.view === 'month' ? 'month' : 'week';
  const anchor = req.query.date ? dayjs(req.query.date) : dayjs();

  const start = view === 'month' ? anchor.startOf('month').startOf('week') : anchor.startOf('week');
  const end = view === 'month' ? anchor.endOf('month').endOf('week') : anchor.endOf('week');

  const items = itemsWithStatus(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));

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

  res.render('director/calendar', {
    title: 'التقويم التربوي',
    view,
    anchor: anchor.format('YYYY-MM-DD'),
    monthLabel: anchor.format('MMMM YYYY'),
    prevDate: (view === 'month' ? anchor.subtract(1, 'month') : anchor.subtract(1, 'week')).format('YYYY-MM-DD'),
    nextDate: (view === 'month' ? anchor.add(1, 'month') : anchor.add(1, 'week')).format('YYYY-MM-DD'),
    days,
  });
});

// ---------- Create ----------
router.get('/items/new', (req, res) => {
  res.render('director/item-form', {
    title: 'إنشاء درس أو نشاط جديد',
    classes: getClasses(),
    item: null,
    selectedClasses: [],
    error: null,
  });
});

router.post('/items', upload.array('attachments', 8), (req, res) => {
  const { type, title, description, objective, materials, scheduled_date, priority } = req.body;
  let classIds = req.body.class_ids;
  if (!classIds) classIds = [];
  if (!Array.isArray(classIds)) classIds = [classIds];

  if (!title || !scheduled_date || classIds.length === 0) {
    return res.status(400).render('director/item-form', {
      title: 'إنشاء درس أو نشاط جديد',
      classes: getClasses(),
      item: req.body,
      selectedClasses: classIds.map(Number),
      error: 'يرجى تعبئة العنوان والتاريخ واختيار فصل واحد على الأقل.',
    });
  }

  const attachments = (req.files || []).map((f) => ({
    filename: f.filename,
    original_name: f.originalname,
  }));

  const insertItem = db.prepare(`
    INSERT INTO items (type, title, description, objective, materials, scheduled_date, priority, attachments, created_by)
    VALUES (@type, @title, @description, @objective, @materials, @scheduled_date, @priority, @attachments, @created_by)
  `);

  const result = insertItem.run({
    type: type === 'activity' ? 'activity' : 'lesson',
    title,
    description: description || '',
    objective: objective || '',
    materials: materials || '',
    scheduled_date,
    priority: ['normal', 'important', 'urgent'].includes(priority) ? priority : 'normal',
    attachments: JSON.stringify(attachments),
    created_by: req.session.user.id,
  });

  const itemId = result.lastInsertRowid;
  const insertAssignment = db.prepare('INSERT INTO item_assignments (item_id, class_id) VALUES (?, ?)');
  const teacherIds = [];

  const tx = db.transaction((ids) => {
    ids.forEach((cid) => {
      insertAssignment.run(itemId, cid);
      const cls = db.prepare('SELECT teacher_id, name FROM classes WHERE id = ?').get(cid);
      if (cls && cls.teacher_id) teacherIds.push(cls.teacher_id);
    });
  });
  tx(classIds.map(Number));

  const typeLabel = type === 'activity' ? 'نشاط' : 'درس';
  notifyMany(
    teacherIds,
    `${typeLabel} جديد: ${title}`,
    `تمت إضافة ${typeLabel} جديد بتاريخ ${dayjs(scheduled_date).format('DD/MM/YYYY')}`,
    `/teacher/items/${itemId}`
  );

  res.redirect(`/director/items/${itemId}`);
});

// ---------- View / Edit / Delete ----------
router.get('/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).render('error', { title: 'غير موجود', message: 'العنصر غير موجود.' });

  const assignments = db
    .prepare(
      `SELECT item_assignments.*, classes.name AS class_name, classes.color AS class_color,
              t1.name AS received_by_name, t2.name AS executed_by_name
       FROM item_assignments
       JOIN classes ON classes.id = item_assignments.class_id
       LEFT JOIN users t1 ON t1.id = item_assignments.received_by
       LEFT JOIN users t2 ON t2.id = item_assignments.executed_by
       WHERE item_assignments.item_id = ?
       ORDER BY classes.name`
    )
    .all(item.id);

  res.render('director/item-detail', {
    title: item.title,
    item: { ...item, attachments: JSON.parse(item.attachments || '[]') },
    assignments: assignments.map((a) => ({ ...a, execution_photos: JSON.parse(a.execution_photos || '[]') })),
  });
});

router.get('/items/:id/edit', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).render('error', { title: 'غير موجود', message: 'العنصر غير موجود.' });
  const selected = db.prepare('SELECT class_id FROM item_assignments WHERE item_id = ?').all(item.id).map((r) => r.class_id);

  res.render('director/item-form', {
    title: 'تعديل درس/نشاط',
    classes: getClasses(),
    item: { ...item, attachments: JSON.parse(item.attachments || '[]') },
    selectedClasses: selected,
    error: null,
  });
});

router.post('/items/:id', upload.array('attachments', 8), (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).render('error', { title: 'غير موجود', message: 'العنصر غير موجود.' });

  const { type, title, description, objective, materials, scheduled_date, priority } = req.body;
  let existingAttachments = JSON.parse(item.attachments || '[]');
  if (req.body.remove_attachments) {
    const toRemove = Array.isArray(req.body.remove_attachments) ? req.body.remove_attachments : [req.body.remove_attachments];
    existingAttachments = existingAttachments.filter((a) => !toRemove.includes(a.filename));
  }
  const newAttachments = (req.files || []).map((f) => ({ filename: f.filename, original_name: f.originalname }));
  const attachments = [...existingAttachments, ...newAttachments];

  db.prepare(
    `UPDATE items SET type=@type, title=@title, description=@description, objective=@objective,
     materials=@materials, scheduled_date=@scheduled_date, priority=@priority, attachments=@attachments,
     updated_at=datetime('now') WHERE id=@id`
  ).run({
    type: type === 'activity' ? 'activity' : 'lesson',
    title,
    description: description || '',
    objective: objective || '',
    materials: materials || '',
    scheduled_date,
    priority: ['normal', 'important', 'urgent'].includes(priority) ? priority : 'normal',
    attachments: JSON.stringify(attachments),
    id: item.id,
  });

  let classIds = req.body.class_ids;
  if (!classIds) classIds = [];
  if (!Array.isArray(classIds)) classIds = [classIds];
  classIds = classIds.map(Number);

  const currentAssignments = db.prepare('SELECT class_id FROM item_assignments WHERE item_id = ?').all(item.id).map((r) => r.class_id);
  const toAdd = classIds.filter((c) => !currentAssignments.includes(c));
  const toRemove = currentAssignments.filter((c) => !classIds.includes(c));

  const insertAssignment = db.prepare('INSERT INTO item_assignments (item_id, class_id) VALUES (?, ?)');
  const deleteAssignment = db.prepare('DELETE FROM item_assignments WHERE item_id = ? AND class_id = ?');
  const teacherIds = [];

  const tx = db.transaction(() => {
    toAdd.forEach((cid) => {
      insertAssignment.run(item.id, cid);
      const cls = db.prepare('SELECT teacher_id FROM classes WHERE id = ?').get(cid);
      if (cls && cls.teacher_id) teacherIds.push(cls.teacher_id);
    });
    toRemove.forEach((cid) => deleteAssignment.run(item.id, cid));
  });
  tx();

  if (teacherIds.length) {
    const typeLabel = type === 'activity' ? 'نشاط' : 'درس';
    notifyMany(teacherIds, `${typeLabel} جديد: ${title}`, `تمت إضافة فصلك إلى ${typeLabel}`, `/teacher/items/${item.id}`);
  }

  res.redirect(`/director/items/${item.id}`);
});

router.post('/items/:id/delete', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.redirect('/director');
});

module.exports = router;
