const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const userRoutes = require('./routes/user.routes');
const messageRoutes = require('./routes/message.routes');
const { initTables } = require('./models/user.model');

// Загружаем переменные окружения
dotenv.config();

const app = express();

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

// Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});