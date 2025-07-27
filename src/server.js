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
  origin: process.env.CORS_ORIGIN || 'https://vasyaproger-socialbek-9493.twc1.net', // Указываем домен
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Разрешаем куки и заголовки авторизации
};
app.use(cors(corsOptions));
app.use(express.json({
  limit: '10mb' // Ограничение размера тела запроса
}));

// Инициализация таблиц
initTables().catch(err => {
  console.error('Ошибка инициализации таблиц:', err.stack);
  process.exit(1); // Завершение процесса при критической ошибке
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
  maxPayload: 10000, // Максимальный размер payload (10KB)
  perMessageDeflate: false // Отключаем сжатие для производительности
});
const clients = new Map(); // Хранит WebSocket-клиентов по userId
const pingIntervals = new Map(); // Хранит интервалы пинга для каждого клиента

// Функция очистки клиента
const cleanupClient = (userId) => {
  const ws = clients.get(userId.toString());
  if (ws) {
    ws.terminate(); // Принудительное закрытие
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
  const url = new URL(req.url, `https://vasyaproger-socialbek-9493.twc1.net`); // Используем реальный домен
  const token = url.searchParams.get('token');

  if (!token) {
    logWithTimestamp('Токен не предоставлен в WebSocket-запросе');
    ws.send(JSON.stringify({ success: false, message: 'Токен не предоставлен' }));
    ws.close(1008); // Код 1008 - политика закрытия
    return;
  }

  let userId;
  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secure-key-please-change-this';
    const decoded = jwt.verify(token, JWT_SECRET, { maxAge: '24h' }); // Ограничение срока действия токена
    userId = decoded.id;

    // Проверка дублирующих соединений
    if (clients.has(userId.toString())) {
      logWithTimestamp(`Дублирующее соединение для пользователя ${userId}, закрытие старого`);
      cleanupClient(userId.toString());
    }

    // Сохраняем клиента
    clients.set(userId.toString(), ws);
    logWithTimestamp(`Пользователь ${userId} подключился к WebSocket`);

    // Настройка пинга
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        logWithTimestamp(`Отправлен ping пользователю ${userId}`);
      } else {
        cleanupClient(userId.toString());
      }
    }, 30000); // Пинг каждые 30 секунд
    pingIntervals.set(userId.toString(), pingInterval);

    ws.on('pong', () => {
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

          const validTypes = ['text', 'sticker', 'video', 'video_circle', 'voice']; // Добавлен 'voice'
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

          // Экранирование content для безопасности
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
            receiverWs.send(JSON.stringify(data));
            logWithTimestamp(`Передано WebRTC-сообщение (${data.type}) для ${data.receiverId}`);
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
      logWithTimestamp(`Пользователь ${userId} отключился от WebSocket, код: ${code}, причина: ${reason}`);
    });

    ws.on('error', (error) => {
      logWithTimestamp(`Ошибка WebSocket для пользователя ${userId}:`, error.message, error.stack);
      cleanupClient(userId.toString());
      ws.close(1011); // Код 1011 - внутренняя ошибка сервера
    });

    // Таймаут на случай, если клиент не отвечает на пинг
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      logWithTimestamp(`Получен pong от ${userId}`);
    });

    const pingTimeout = setTimeout(() => {
      if (ws.isAlive === false) {
        logWithTimestamp(`Таймаут пинга для пользователя ${userId}, соединение разорвано`);
        cleanupClient(userId.toString());
        ws.terminate();
        return;
      }
      ws.isAlive = false;
    }, 60000); // Таймаут 60 секунд

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