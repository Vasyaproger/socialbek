const pool = require('../config/database');

const sendMessage = async (req, res) => {
  const { receiver_id, content, type = 'text' } = req.body; // Добавляем type с значением по умолчанию
  const sender_id = req.user.id; // ID отправителя из JWT

  if (!receiver_id || !content) {
    return res.status(400).json({ success: false, message: 'Укажите получателя и содержимое сообщения' });
  }

  try {
    // Проверяем, существует ли получатель
    const [receiver] = await pool.query('SELECT * FROM users WHERE id = ?', [receiver_id]);
    if (receiver.length === 0) {
      return res.status(404).json({ success: false, message: 'Получатель не найден' });
    }

    // Сохраняем сообщение
    const [result] = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content, type) VALUES (?, ?, ?, ?)',
      [sender_id, receiver_id, content, type]
    );

    res.status(201).json({
      success: true,
      message: 'Сообщение отправлено',
      data: {
        id: result.insertId,
        sender_id,
        receiver_id,
        content,
        type,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
};

const getMessages = async (req, res) => {
  const { userId1, userId2 } = req.params;
  const currentUserId = req.user.id;

  // Приводим параметры к числам и проверяем их валидность
  const id1 = parseInt(userId1);
  const id2 = parseInt(userId2);

  if (isNaN(id1) || isNaN(id2)) {
    return res.status(400).json({ success: false, message: 'Некорректные ID пользователей' });
  }

  // Проверяем, что текущий пользователь участвует в чате
  if (currentUserId !== id1 && currentUserId !== id2) {
    return res.status(403).json({ success: false, message: 'Доступ запрещён' });
  }

  try {
    // Проверяем существование пользователей
    const [user1] = await pool.query('SELECT id FROM users WHERE id = ?', [id1]);
    const [user2] = await pool.query('SELECT id FROM users WHERE id = ?', [id2]);
    if (user1.length === 0) {
      return res.status(404).json({ success: false, message: `Пользователь с ID ${id1} не найден` });
    }
    if (user2.length === 0) {
      return res.status(404).json({ success: false, message: `Пользователь с ID ${id2} не найден` });
    }

    // Выполняем запрос к сообщениям
    const [messages] = await pool.query(
      `SELECT m.id, m.sender_id, m.receiver_id, m.content, m.created_at, m.type,
              u1.name as sender_name, u2.name as receiver_name
       FROM messages m
       LEFT JOIN users u1 ON m.sender_id = u1.id
       LEFT JOIN users u2 ON m.receiver_id = u2.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at ASC`,
      [id1, id2, id2, id1]
    );

    // Логируем количество найденных сообщений для отладки
    console.log(`Найдено сообщений между ${id1} и ${id2}: ${messages.length}`);

    res.json({
      success: true,
      data: messages.map(msg => ({
        id: msg.id,
        senderId: msg.sender_id,
        receiverId: msg.receiver_id,
        content: msg.content || 'Нет содержимого',
        createdAt: msg.created_at ? msg.created_at.toISOString() : new Date().toISOString(),
        type: msg.type || 'text',
        senderName: msg.sender_name || 'Неизвестно',
        receiverName: msg.receiver_name || 'Неизвестно'
      }))
    });
  } catch (error) {
    console.error('Ошибка получения сообщений:', {
      message: error.message,
      stack: error.stack,
      params: { userId1, userId2, currentUserId }
    });
    res.status(500).json({ success: false, message: `Ошибка сервера: ${error.message}` });
  }
};

module.exports = { sendMessage, getMessages };