const pool = require('../config/database');

const sendMessage = async (req, res) => {
  const { receiver_id, content } = req.body;
  const sender_id = req.user.id; // ID отправителя из JWT

  if (!receiver_id || !content) {
    return res.status(400).json({ message: 'Укажите получателя и текст сообщения' });
  }

  try {
    // Проверяем, существует ли получатель
    const [receiver] = await pool.query('SELECT * FROM users WHERE id = ?', [receiver_id]);
    if (receiver.length === 0) {
      return res.status(404).json({ message: 'Получатель не найден' });
    }

    // Сохраняем сообщение
    await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
      [sender_id, receiver_id, content]
    );

    res.status(201).json({ message: 'Сообщение отправлено' });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

const getMessages = async (req, res) => {
  const { userId1, userId2 } = req.params;
  const currentUserId = req.user.id;

  // Проверяем, что текущий пользователь участвует в чате
  if (currentUserId !== parseInt(userId1) && currentUserId !== parseInt(userId2)) {
    return res.status(403).json({ message: 'Доступ запрещён' });
  }

  try {
    const [messages] = await pool.query(
      `SELECT m.id, m.sender_id, m.receiver_id, m.content, m.created_at, u1.name as sender_name, u2.name as receiver_name
       FROM messages m
       JOIN users u1 ON m.sender_id = u1.id
       JOIN users u2 ON m.receiver_id = u2.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at ASC`,
      [userId1, userId2, userId2, userId1]
    );

    res.json(messages);
  } catch (error) {
    console.error('Ошибка получения сообщений:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

module.exports = { sendMessage, getMessages };