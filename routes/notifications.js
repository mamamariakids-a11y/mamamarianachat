const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const items = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.session.user.id);
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.user.id);
  res.render('notifications', { items, title: 'الإشعارات' });
});

// Lightweight polling endpoint used by the bell icon
router.get('/unread-count', requireLogin, (req, res) => {
  const c = db
    .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.session.user.id).c;
  res.json({ count: c });
});

router.get('/recent', requireLogin, (req, res) => {
  const items = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 8')
    .all(req.session.user.id);
  res.json({ items });
});

router.post('/read-all', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.user.id);
  res.redirect(req.get('Referrer') || '/notifications');
});

module.exports = router;
