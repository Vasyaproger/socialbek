const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const pool = require('../config/database');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Недействительный токен' });
  }
};
// Регистрация (с сохранением токена)
router.post('/register', async (req, res) => {
  const { name, phone, password, serviceAgreement } = req.body;

  if (!name || !phone || !password || !serviceAgreement) {
    return res.status(400).json({
      success: false,
      message: 'Пожалуйста, заполните все поля: имя, телефон, пароль и соглашение',
    });
  }

  try {
    const [existingUsers] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Этот номер телефона уже зарегистрирован',
      });
    }

    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ phone }, JWT_SECRET, { expiresIn: '1h' });

    const [result] = await pool.query(
      'INSERT INTO users (name, phone, password, token) VALUES (?, ?, ?, ?)',
      [name, phone, hashedPassword, token]
    );

    res.status(201).json({
      success: true,
      message: 'Пользователь успешно зарегистрирован',
      token: token,
      userId: result.insertId,
    });
  } catch (error) {
    console.error('Ошибка при регистрации:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при регистрации',
    });
  }
});

// Логин (возвращает новый токен и user.id)
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({
      success: false,
      message: 'Пожалуйста, введите номер телефона и пароль',
    });
  }

  try {
    const [users] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Пользователь не найден',
      });
    }

    const user = users[0];
    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Неверный пароль',
      });
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '1h' });

    await pool.query('UPDATE users SET token = ? WHERE id = ?', [token, user.id]);

    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      token: token,
      userId: user.id,
      phone: user.phone,
    });
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера при входе',
    });
  }
});

// Обновление токена
router.post('/refresh-token', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET);
    const newToken = jwt.sign({ id: decoded.id, phone: decoded.phone }, JWT_SECRET, { expiresIn: '1h' });

    await pool.query('UPDATE users SET token = ? WHERE id = ?', [newToken, decoded.id]);

    res.json({
      success: true,
      token: newToken,
    });
  } catch (error) {
    console.error('Ошибка при обновлении токена:', error);
    res.status(403).json({ success: false, message: 'Недействительный токен' });
  }
});

// Список пользователей для чатов
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, phone FROM users WHERE id != ?', [req.user.id]);
    res.json({
      success: true,
      data: rows.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        lastMessage: 'Нет сообщений',
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        unread: 0,
      })),
    });
  } catch (error) {
    console.error('Ошибка получения списка пользователей:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Профиль пользователя
router.get('/user/profile', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT name, phone FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const user = rows[0];
    res.json({
      success: true,
      data: {
        name: user.name,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error('Ошибка профиля:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// WebSocket-сервер (добавляем в основной сервер, а не в router)
module.exports = (server) => {
  const wss = new WebSocket.Server({ server });

  const clients = new Map(); // Хранит WebSocket-клиентов по userId

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.send(JSON.stringify({ success: false, message: 'Токен не предоставлен' }));
      ws.close();
      return;
    }

    try {
      const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id;

      // Сохраняем клиента
      clients.set(userId, ws);
      console.log(`Пользователь ${userId} подключился к WebSocket`);

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);

          // Обработка сообщений чата
          if (data.type === 'message') {
            const { senderId, receiverId, content, type } = data;

            // Сохраняем сообщение в базе данных
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

            // Отправляем сообщение получателю, если он онлайн
            const receiverWs = clients.get(receiverId);
            if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
              receiverWs.send(JSON.stringify({ type: 'message', ...messageData }));
            }

            // Отправляем подтверждение отправителю
            ws.send(JSON.stringify({ success: true, message: messageData }));
          }

          // Обработка звонков
          if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice_candidate') {
            const receiverWs = clients.get(data.receiverId);
            if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
              receiverWs.send(JSON.stringify(data));
            } else {
              ws.send(JSON.stringify({ type: 'offline', receiverId: data.receiverId }));
            }
          }
        } catch (error) {
          console.error('Ошибка обработки WebSocket-сообщения:', error);
          ws.send(JSON.stringify({ success: false, message: 'Ошибка обработки сообщения' }));
        }
      });

      ws.on('close', () => {
        clients.delete(userId);
        console.log(`Пользователь ${userId} отключился от WebSocket`);
      });

      ws.on('error', (error) => {
        console.error(`Ошибка WebSocket для пользователя ${userId}:`, error);
      });
    } catch (error) {
      console.error('Ошибка аутентификации WebSocket:', error);
      ws.send(JSON.stringify({ success: false, message: 'Недействительный токен' }));
      ws.close();
    }
  });

  return router;
};