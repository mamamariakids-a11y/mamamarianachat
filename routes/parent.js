const express = require('express');
const db = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('parent'));

router.get('/', (req, res) => {
  const children = db
    .prepare(
      `SELECT children.*, classes.name AS class_name, classes.id AS class_id
       FROM children LEFT JOIN classes ON classes.id = children.class_id
       WHERE children.parent_id = ?`
    )
    .all(req.session.user.id);

  const classIds = [...new Set(children.map((c) => c.class_id).filter(Boolean))];

  let feed = [];
  if (classIds.length) {
    const placeholders = classIds.map(() => '?').join(',');
    feed = db
      .prepare(
        `SELECT item_assignments.*, items.title, items.description, items.type, items.scheduled_date,
                classes.name AS class_name, users.name AS teacher_name
         FROM item_assignments
         JOIN items ON items.id = item_assignments.item_id
         JOIN classes ON classes.id = item_assignments.class_id
         LEFT JOIN users ON users.id = item_assignments.executed_by
         WHERE item_assignments.class_id IN (${placeholders}) AND item_assignments.status = 'executed'
         ORDER BY item_assignments.executed_at DESC
         LIMIT 50`
      )
      .all(...classIds)
      .map((r) => ({ ...r, execution_photos: JSON.parse(r.execution_photos || '[]') }));
  }

  res.render('parent/feed', { title: 'أنشطة طفلي', children, feed, hasChildren: children.length > 0 });
});

module.exports = router;
