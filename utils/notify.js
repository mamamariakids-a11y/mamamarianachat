const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO notifications (user_id, title, message, link)
  VALUES (@user_id, @title, @message, @link)
`);

/**
 * Create a notification for a single user.
 */
function notify(userId, title, message, link) {
  insertStmt.run({ user_id: userId, title, message: message || null, link: link || null });
}

/**
 * Create the same notification for a list of user ids.
 */
function notifyMany(userIds, title, message, link) {
  const tx = db.transaction((ids) => {
    ids.forEach((id) => notify(id, title, message, link));
  });
  tx(userIds.filter(Boolean));
}

module.exports = { notify, notifyMany };
