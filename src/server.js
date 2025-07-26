
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const userRoutes = require('./routes/user.routes');
const messageRoutes = require('./routes/message.routes');
const { initTables } = require('./models/user.model');
const pool = require('./config/database');

// Загружаем переменные окружения
dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Инициализация таблиц
initTables();

// Маршруты
app.use('/api', userRoutes);
app.use('/api', messageRoutes);

// Базовый маршрут
app.get('/', (req, res) => {
  res.send('Привет, это твой Node.js бэкенд!');
});

// WebSocket-сервер
const wss = new WebSocket.Server({ server });
const clients = new Map(); // Хранит WebSocket-клиентов по userId

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    console.error('Токен не предоставлен в WebSocket-запросе');
    ws.send(JSON.stringify({ success: false, message: 'Токен не предоставлен' }));
    ws.close();
    return;
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;

    // Сохраняем клиента
    clients.set(userId.toString(), ws);
    console.log(`Пользователь ${userId} подключился к WebSocket`);

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        console.log(`Получено WebSocket-сообщение от ${userId}:`, data);

        // Обработка сообщений чата
        if (data.type === 'message') {
          const { senderId, receiverId, content, type } = data;

          // Проверка допустимых типов сообщений
          const validTypes = ['text', 'sticker', 'video', 'video_circle'];
          if (!validTypes.includes(type)) {
            console.error(`Недопустимый тип сообщения: ${type}`);
            ws.send(JSON.stringify({ success: false, message: 'Недопустимый тип сообщения' }));
            return;
          }

          // Проверка обязательных полей
          if (!senderId || !receiverId || !content || !type) {
            console.error('Отсутствуют обязательные поля:', { senderId, receiverId, content, type });
            ws.send(JSON.stringify({ success: false, message: 'Отсутствуют обязательные поля' }));
            return;
          }

          // Проверка отправителя
          if (senderId !== userId.toString()) {
            console.error(`Несовпадение senderId (${senderId}) и userId (${userId})`);
            ws.send(JSON.stringify({ success: false, message: 'Недостаточно прав' }));
            return;
          }

          // Сохраняем сообщение в базе данных
          const [result] = await pool.query(
            'INSERT INTO messages (sender_id, receiver_id, content, type, created_at) VALUES (?, ?, ?, ?, NOW())',
            [senderId, receiverId, content, type]
          );
          console.log(`Сообщение сохранено в базе данных, id: ${result.insertId}`);

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
            console.log(`Сообщение отправлено получателю ${receiverId}`);
          } else {
            console.log(`Получатель ${receiverId} не в сети`);
          }

          // Отправляем подтверждение отправителю
          ws.send(JSON.stringify({ success: true, message: messageData }));
          console.log(`Подтверждение отправлено отправителю ${senderId}`);
        }
        // Обработка звонков
        else if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice_candidate') {
          const receiverWs = clients.get(data.receiverId);
          if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
            receiverWs.send(JSON.stringify(data));
            console.log(`Передано WebRTC-сообщение (${data.type}) для ${data.receiverId}`);
          } else {
            ws.send(JSON.stringify({ type: 'offline', receiverId: data.receiverId }));
            console.log(`Получатель ${data.receiverId} не в сети для WebRTC`);
          }
        } else {
          console.error(`Неизвестный тип сообщения: ${data.type}`);
          ws.send(JSON.stringify({ success: false, message: 'Неизвестный тип сообщения' }));
        }
      } catch (error) {
        console.error('Ошибка обработки WebSocket-сообщения:', error.message, error.stack);
        ws.send(JSON.stringify({ success: false, message: 'Ошибка обработки сообщения' }));
      }
    });

    ws.on('close', () => {
      clients.delete(userId.toString());
      console.log(`Пользователь ${userId} отключился от WebSocket`);
    });

    ws.on('error', (error) => {
      console.error(`Ошибка WebSocket для пользователя ${userId}:`, error.message, error.stack);
    });
  } catch (error) {
    console.error('Ошибка аутентификации WebSocket:', error.message, error.stack);
    ws.send(JSON.stringify({ success: false, message: 'Недействительный токен' }));
    ws.close();
  }
});

// Запуск сервера
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
