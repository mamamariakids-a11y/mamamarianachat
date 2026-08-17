function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', {
        title: 'غير مصرح',
        message: 'ليس لديك صلاحية للوصول إلى هذه الصفحة.',
        user: req.session.user,
      });
    }
    next();
  };
}

// Makes the logged-in user + unread notification count available to every view
function attachUser(db) {
  return async (req, res, next) => {
    try {
      res.locals.user = req.session.user || null;
      res.locals.currentPath = req.path;
      if (req.session.user) {
        const result = await db.execute({
          sql: 'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0',
          args: [req.session.user.id],
        });
        res.locals.unreadCount = Number(result.rows[0].c);
      } else {
        res.locals.unreadCount = 0;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireLogin, requireRole, attachUser };
