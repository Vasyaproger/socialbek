const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const { sendMessage, getMessages } = require('../controllers/message.controller');

// Отправка сообщения
router.post('/messages', authenticateToken, sendMessage);

// Получение сообщений между двумя пользователями
router.get('/messages/:senderId/:receiverId', authenticateToken, getMessages);

module.exports = router;