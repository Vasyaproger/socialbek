const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const userRoutes = require('./routes/user.routes');
const { initUsersTable } = require('./models/user.model');

// Загружаем переменные окружения
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Инициализация таблицы пользователей
initUsersTable();

// Маршруты
app.use('/api', userRoutes);

// Базовый маршрут
app.get('/', (req, res) => {
  res.send('Привет, это твой Node.js бэкенд!');
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});