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
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'https://vasyaproger-socialbek-9493.twc1.net',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({
  limit: '10mb'
}));

// Инициализация таблиц
initTables().catch(err => {
  console.error('Ошибка инициализации таблиц:', err.stack);
  process.exit(1);
});

// Маршруты
app.use('/api', userRoutes);
app.use('/api', messageRoutes);

// Базовый маршрут с указанием домена
app.get('/', (req, res) => {
  res.send(`Привет, это твой Node.js бэкенд на домене vasyaproger-socialbek-9493.twc1.net!`);
});

// WebSocket-сервер
const wss = new WebSocket.Server({
  server,
  clientTracking: true,
  maxPayload: 10000,
  perMessageDeflate: false
});
const clients = new Map();
const pingIntervals = new Map();

// Функция очистки клиента
const cleanupClient = (userId) => {
  const ws = clients.get(userId.toString());
  if (ws) {
    ws.terminate();
    clients.delete(userId.toString());
  }
  const interval = pingIntervals.get(userId.toString());
  if (interval) {
    clearInterval(interval);
    pingIntervals.delete(userId.toString());
  }
};

// Логирование подключения с датой и временем
const logWithTimestamp = (message) => {
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', hour12: false });
  console.log(`[${now}] ${message}`);
};

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `https://vasyaproger-socialbek-9493.twc1.net`);
  const token = url.searchParams.get('token');

  if (!token) {
    logWithTimestamp('Токен не предоставлен в WebSocket-запросе');
    ws.send(JSON.stringify({ success: false, message: 'Токен не предоставлен' }));
    ws.close(1008);
    return;
  }

  let userId;
  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secure-key-please-change-this';
    const decoded = jwt.verify(token, JWT_SECRET, { maxAge: '24h' });
    userId = decoded.id;

    // Проверка дублирующих соединений с небольшой задержкой
    if (clients.has(userId.toString())) {
      logWithTimestamp(`Обнаружено дублирующее соединение для пользователя ${userId}, ожидание 2 секунды перед закрытием`);
      setTimeout(() => {
        if (clients.has(userId.toString()) && clients.get(userId.toString()) !== ws) {
          cleanupClient(userId.toString());
          logWithTimestamp(`Старое соединение для пользователя ${userId} закрыто`);
        }
      }, 2000); // Задержка 2 секунды
    }

    clients.set(userId.toString(), ws);
    logWithTimestamp(`Пользователь ${userId} подключился к WebSocket`);

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        logWithTimestamp(`Отправлен ping пользователю ${userId}`);
      } else {
        cleanupClient(userId.toString());
      }
    }, 30000);
    pingIntervals.set(userId.toString(), pingInterval);

    ws.on('pong', () => {
      ws.isAlive = true;
      logWithTimestamp(`Получен pong от ${userId}`);
    });

    ws.on('message', async (message) => {
      try {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (Buffer.byteLength(message) > 10000) {
          ws.send(JSON.stringify({ success: false, message: 'Сообщение слишком большое' }));
          return;
        }

        const data = JSON.parse(message.toString());
        logWithTimestamp(`Получено WebSocket-сообщение от ${userId}:`, data);

        if (data.type === 'message') {
          const { senderId, receiverId, content, type } = data;

          const validTypes = ['text', 'sticker', 'video', 'video_circle', 'voice'];
          if (!validTypes.includes(type)) {
            ws.send(JSON.stringify({ success: false, message: 'Недопустимый тип сообщения' }));
            return;
          }

          if (!senderId || !receiverId || !content || !type) {
            ws.send(JSON.stringify({ success: false, message: 'Отсутствуют обязательные поля' }));
            return;
          }

          if (senderId !== userId.toString()) {
            ws.send(JSON.stringify({ success: false, message: 'Недостаточно прав' }));
            return;
          }

          const escapedContent = pool.escape(content).replace(/'/g, "''");

          const [result] = await pool.execute(
            'INSERT INTO messages (sender_id, receiver_id, content, type, created_at) VALUES (?, ?, ?, ?, NOW())',
            [senderId, receiverId, escapedContent, type]
          );
          logWithTimestamp(`Сообщение сохранено в базе данных, id: ${result.insertId}`);

          const messageData = {
            id: result.insertId,
            senderId,
            receiverId,
            content,
            type,
            createdAt: new Date().toISOString(),
          };

          const receiverWs = clients.get(receiverId);
          if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
            receiverWs.send(JSON.stringify({ type: 'message', ...messageData }));
            logWithTimestamp(`Сообщение отправлено получателю ${receiverId}`);
          } else {
            logWithTimestamp(`Получатель ${receiverId} не в сети`);
          }

          ws.send(JSON.stringify({ success: true, message: messageData }));
        } else if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice_candidate') {
          const receiverWs = clients.get(data.receiverId);
          if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
            try {
              receiverWs.send(JSON.stringify(data));
              logWithTimestamp(`Передано WebRTC-сообщение (${data.type}) для ${data.receiverId}`);
            } catch (e) {
              logWithTimestamp(`Ошибка отправки WebRTC-сообщения для ${data.receiverId}: ${e.message}`);
              ws.send(JSON.stringify({ type: 'error', message: 'Не удалось передать WebRTC-сообщение' }));
            }
          } else {
            ws.send(JSON.stringify({ type: 'offline', receiverId: data.receiverId }));
            logWithTimestamp(`Получатель ${data.receiverId} не в сети для WebRTC`);
          }
        } else {
          ws.send(JSON.stringify({ success: false, message: 'Неизвестный тип сообщения' }));
        }
      } catch (error) {
        logWithTimestamp('Ошибка обработки WebSocket-сообщения:', error.message, error.stack);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ success: false, message: 'Ошибка обработки сообщения' }));
        }
      }
    });

    ws.on('close', (code, reason) => {
      cleanupClient(userId.toString());
      logWithTimestamp(`Пользователь ${userId} отключился от WebSocket, код: ${code}, причина: ${reason.toString()}`);
    });

    ws.on('error', (error) => {
      logWithTimestamp(`Ошибка WebSocket для пользователя ${userId}:`, error.message, error.stack);
      cleanupClient(userId.toString());
      ws.close(1011);
    });

    ws.isAlive = true;
    const pingTimeout = setTimeout(() => {
      if (ws.isAlive === false) {
        logWithTimestamp(`Таймаут пинга для пользователя ${userId}, соединение разорвано`);
        cleanupClient(userId.toString());
        ws.terminate();
        return;
      }
      ws.isAlive = false;
    }, 180000); // Увеличено до 180 секунд для стабильности видеозвонков

  } catch (error) {
    logWithTimestamp('Ошибка аутентификации WebSocket:', error.message, error.stack);
    ws.send(JSON.stringify({ success: false, message: 'Недействительный токен' }));
    ws.close(1008);
  }
});

// Обработка ошибок сервера
server.on('error', (error) => {
  logWithTimestamp('Ошибка сервера:', error.message, error.stack);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logWithTimestamp('Получен SIGTERM, завершение работы...');
  wss.clients.forEach((client) => client.close());
  server.close(() => {
    logWithTimestamp('Сервер остановлен');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logWithTimestamp('Получен SIGINT, завершение работы...');
  wss.clients.forEach((client) => client.close());
  server.close(() => {
    logWithTimestamp('Сервер остановлен');
    process.exit(0);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logWithTimestamp(`Сервер запущен на порту ${PORT} для домена vasyaproger-socialbek-9493.twc1.net`);
});