const pool = require('../config/database');

// Отправка сообщения
const sendMessage = async (req, res) => {
  try {
    const { senderId, receiverId, content, type } = req.body;
    
    // Validate input
    if (!senderId || !receiverId || !content || !type) {
      return res.status(400).json({ success: false, message: 'Отсутствуют обязательные поля: senderId, receiverId, content, type' });
    }

    // Verify that the sender is the authenticated user
    if (senderId !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: 'Недостаточно прав для отправки сообщения от имени другого пользователя' });
    }

    // Insert message into database
    const [result] = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content, type, created_at) VALUES (?, ?, ?, ?, NOW())',
      [senderId, receiverId, content, type]
    );

    const messageData = {
      id: result.insertId,
      senderId,
      receiverId,
      content,
      type,
      createdAt: new Date().toISOString(),
    };

    res.status(201).json({ success: true, data: messageData });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при отправке сообщения', error: error.message });
  }
};

// Получение сообщений между двумя пользователями
const getMessages = async (req, res) => {
  try {
    const { senderId, receiverId } = req.params;

    // Verify that the authenticated user is one of the participants
    if (senderId !== req.user.id.toString() && receiverId !== req.user.id.toString()) {
      return res.status(403).json({ success: false, message: 'Доступ запрещён' });
    }

    // Fetch messages from database
    const [rows] = await pool.query(
      `SELECT id, sender_id AS senderId, receiver_id AS receiverId, content, type, created_at AS createdAt
       FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at ASC`,
      [senderId, receiverId, receiverId, senderId]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Ошибка получения сообщений:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении сообщений', error: error.message });
  }
};

module.exports = { sendMessage, getMessages };