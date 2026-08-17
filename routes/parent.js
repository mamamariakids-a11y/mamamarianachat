const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { MEAL_LABELS, NAP_LABELS, MOOD_LABELS } = require('../utils/dailyReportLabels');

const router = express.Router();
router.use(requireRole('parent'));

router.get('/', async (req, res, next) => {
  try {
    const childrenResult = await db.execute({
      sql: `SELECT children.*, classes.name AS class_name, classes.id AS class_id
            FROM children LEFT JOIN classes ON classes.id = children.class_id
            WHERE children.parent_id = ?`,
      args: [req.session.user.id],
    });
    const children = childrenResult.rows;
    const childIds = children.map((c) => c.id);

    const classIds = [...new Set(children.map((c) => c.class_id).filter(Boolean))];

    let feed = [];
    if (classIds.length) {
      const placeholders = classIds.map(() => '?').join(',');
      const feedResult = await db.execute({
        sql: `SELECT item_assignments.*, items.title, items.description, items.type, items.scheduled_date,
                     classes.name AS class_name, users.name AS teacher_name
              FROM item_assignments
              JOIN items ON items.id = item_assignments.item_id
              JOIN classes ON classes.id = item_assignments.class_id
              LEFT JOIN users ON users.id = item_assignments.executed_by
              WHERE item_assignments.class_id IN (${placeholders}) AND item_assignments.status = 'executed'
              ORDER BY item_assignments.executed_at DESC
              LIMIT 50`,
        args: classIds,
      });
      feed = feedResult.rows.map((r) => ({ ...r, execution_photos: JSON.parse(r.execution_photos || '[]') }));
    }

    let dailyReports = [];
    if (childIds.length) {
      const placeholders = childIds.map(() => '?').join(',');
      const drResult = await db.execute({
        sql: `SELECT daily_reports.*, children.name AS child_name
              FROM daily_reports JOIN children ON children.id = daily_reports.child_id
              WHERE daily_reports.child_id IN (${placeholders})
              ORDER BY daily_reports.date DESC, daily_reports.updated_at DESC
              LIMIT 20`,
        args: childIds,
      });
      dailyReports = drResult.rows;
    }

    res.render('parent/feed', {
      title: 'أنشطة طفلي',
      children,
      feed,
      dailyReports,
      mealLabels: MEAL_LABELS,
      napLabels: NAP_LABELS,
      moodLabels: MOOD_LABELS,
      hasChildren: children.length > 0,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Per-child page: health record + emergency contacts (parent can view & edit their own child) ----------
async function loadOwnChild(childId, parentId) {
  const childResult = await db.execute({
    sql: `SELECT children.*, classes.name AS class_name FROM children
          LEFT JOIN classes ON classes.id = children.class_id
          WHERE children.id = ? AND children.parent_id = ?`,
    args: [childId, parentId],
  });
  return childResult.rows[0] || null;
}

router.get('/children/:id', async (req, res, next) => {
  try {
    const child = await loadOwnChild(req.params.id, req.session.user.id);
    if (!child) return res.status(403).render('error', { title: 'غير مصرح', message: 'هذا الطفل ليس مرتبطًا بحسابك.' });

    const healthResult = await db.execute({ sql: 'SELECT * FROM health_profiles WHERE child_id = ?', args: [child.id] });
    const contactsResult = await db.execute({ sql: 'SELECT * FROM emergency_contacts WHERE child_id = ? ORDER BY id', args: [child.id] });

    res.render('parent/child-detail', {
      title: child.name,
      child,
      healthProfile: healthResult.rows[0] || null,
      contacts: contactsResult.rows,
      editable: true,
      actionPrefix: `/parent/children/${child.id}`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/children/:id/health', async (req, res, next) => {
  try {
    const child = await loadOwnChild(req.params.id, req.session.user.id);
    if (!child) return res.status(403).render('error', { title: 'غير مصرح', message: 'هذا الطفل ليس مرتبطًا بحسابك.' });

    const { blood_type, allergies, chronic_conditions, medications, doctor_name, doctor_phone, notes } = req.body;
    await db.execute({
      sql: `INSERT INTO health_profiles (child_id, blood_type, allergies, chronic_conditions, medications, doctor_name, doctor_phone, notes, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(child_id) DO UPDATE SET
              blood_type=excluded.blood_type, allergies=excluded.allergies, chronic_conditions=excluded.chronic_conditions,
              medications=excluded.medications, doctor_name=excluded.doctor_name, doctor_phone=excluded.doctor_phone,
              notes=excluded.notes, updated_by=excluded.updated_by, updated_at=datetime('now')`,
      args: [child.id, blood_type || null, allergies || null, chronic_conditions || null, medications || null, doctor_name || null, doctor_phone || null, notes || null, req.session.user.id],
    });
    res.redirect(`/parent/children/${child.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/children/:id/contacts', async (req, res, next) => {
  try {
    const child = await loadOwnChild(req.params.id, req.session.user.id);
    if (!child) return res.status(403).render('error', { title: 'غير مصرح', message: 'هذا الطفل ليس مرتبطًا بحسابك.' });

    const { name, relation, phone } = req.body;
    if (name && phone) {
      await db.execute({
        sql: 'INSERT INTO emergency_contacts (child_id, name, relation, phone, can_pickup) VALUES (?, ?, ?, ?, ?)',
        args: [child.id, name.trim(), (relation || '').trim(), phone.trim(), req.body.can_pickup ? 1 : 0],
      });
    }
    res.redirect(`/parent/children/${child.id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/children/:id/contacts/:contactId/delete', async (req, res, next) => {
  try {
    const child = await loadOwnChild(req.params.id, req.session.user.id);
    if (!child) return res.status(403).render('error', { title: 'غير مصرح', message: 'هذا الطفل ليس مرتبطًا بحسابك.' });

    await db.execute({ sql: 'DELETE FROM emergency_contacts WHERE id = ? AND child_id = ?', args: [req.params.contactId, child.id] });
    res.redirect(`/parent/children/${child.id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
