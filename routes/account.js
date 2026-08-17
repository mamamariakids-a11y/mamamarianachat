const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/change-password', (req, res) => {
  res.render('account/change-password', { title: 'تغيير كلمة المرور', error: null, success: null });
});

router.post('/change-password', (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!current_password || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).render('account/change-password', {
      title: 'تغيير كلمة المرور',
      error: 'كلمة المرور الحالية غير صحيحة.',
      success: null,
    });
  }
  if (!new_password || new_password.length < 6) {
    return res.status(400).render('account/change-password', {
      title: 'تغيير كلمة المرور',
      error: 'يجب أن تتكون كلمة المرور الجديدة من 6 أحرف على الأقل.',
      success: null,
    });
  }
  if (new_password !== confirm_password) {
    return res.status(400).render('account/change-password', {
      title: 'تغيير كلمة المرور',
      error: 'كلمة المرور الجديدة وتأكيدها غير متطابقين.',
      success: null,
    });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  res.render('account/change-password', { title: 'تغيير كلمة المرور', error: null, success: 'تم تغيير كلمة المرور بنجاح.' });
});

module.exports = router;
