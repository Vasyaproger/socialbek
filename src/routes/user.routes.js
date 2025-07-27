
const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const pool = require('../config/database');
const AWS = require('aws-sdk');
const multer = require('multer');
const path = require('path');

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.error('Токен не предоставлен в запросе:', req.headers);
    return res.status(401).json({ success: false, message: 'Токен не предоставлен' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Ошибка проверки токена:', err.message, err.stack);
    return res.status(403).json({ success: false, message: 'Недействительный токен' });
  }
};

// Настройка S3
const s3 = new AWS.S3({
  accessKeyId: process.env.S3_ACCESS_KEY_ID || 'DN1NLZTORA2L6NZ529JJ',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'iGg3syd3UiWzhoYbYlEEDSVX1HHVmWUptrBt81Y8',
  region: 'ru-1',
  endpoint: 'https://s3.twcstorage.ru',
  s3ForcePathStyle: true,
});

// Конфигурация Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const fileTypes = /\.(jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|m4a|mp3|wav|opus|aac)$/i;
    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
      'audio/opus',
      'audio/aac',
      'application/octet-stream',
    ];
    const mimetype = mimeTypes.includes(file.mimetype);

    if (extname || mimetype) {
      console.log(`Файл принят: ${file.originalname} (${file.mimetype})`);
      return cb(null, true);
    } else {
      console.error('Неподдерживаемый тип файла:', file.originalname, file.mimetype);
      cb(new Error('Разрешены только изображения (jpg, png, gif, webp), видео (mp4, mov, avi, mkv) и аудио (m4a, mp3, wav, opus, aac)'));
    }
  },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
  { name: 'voice', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
]);

// Инициализация базы данных
const initializeDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Подключение к базе данных успешно');

    // Проверяем существование столбцов и добавляем их по одному, если отсутствуют
    const [columns] = await connection.query('SHOW COLUMNS FROM users');
    const columnNames = columns.map(col => col.Field);

    const newColumns = [
      { name: 'avatar_url', type: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'age', type: 'INT DEFAULT NULL' },
      { name: 'city', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'country', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'marital_status', type: 'VARCHAR(50) DEFAULT NULL' },
    ];

    for (const col of newColumns) {
      if (!columnNames.includes(col.name)) {
        await connection.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
        console.log(`Столбец ${col.name} добавлен в таблицу users`);
      } else {
        console.log(`Столбец ${col.name} уже существует в таблице users`);
      }
    }

    // Создание таблицы stories
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Таблица stories создана или уже существует');

    // Создание таблицы story_views
    await connection.query(`
      CREATE TABLE IF NOT EXISTS story_views (
        id INT AUTO_INCREMENT PRIMARY KEY,
        story_id INT NOT NULL,
        user_id INT NOT NULL,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(story_id, user_id)
      )
    `);
    console.log('Таблица story_views создана или уже существует');

    // Создание таблицы groups
    await connection.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        creator_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        avatar_url VARCHAR(255) DEFAULT NULL,
        is_public BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Таблица groups создана или уже существует');

    // Создание таблицы group_members
    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        user_id INT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(group_id, user_id)
      )
    `);
    console.log('Таблица group_members создана или уже существует');

    // Создание таблицы voice_messages
    await connection.query(`
      CREATE TABLE IF NOT EXISTS voice_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Таблица voice_messages создана или уже существует');

    // Создание таблицы group_messages
    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT NOT NULL,
        user_id INT NOT NULL,
        content TEXT,
        file_url VARCHAR(255) DEFAULT NULL,
        file_type ENUM('image', 'video', 'audio') DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Таблица group_messages создана или уже существует');

    // Создание таблицы calls
    await connection.query(`
      CREATE TABLE IF NOT EXISTS calls (
        id INT AUTO_INCREMENT PRIMARY KEY,
        caller_id INT NOT NULL,
        receiver_id INT NOT NULL,
        status ENUM('initiated', 'accepted', 'rejected', 'ended') NOT NULL,
        start_time DATETIME,
        end_time DATETIME,
        FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Таблица calls создана или уже существует');

    console.log('Все таблицы успешно инициализированы');
    connection.release();
  } catch (err) {
    console.error('Ошибка инициализации базы данных:', err.message, err.stack);
  }
};

initializeDatabase();

// Маршрут для инициации звонка
router.post('/call/initiate', authenticateToken, async (req, res) => {
  try {
    const { receiverId } = req.body;
    const callerId = req.user.id;

    if (!receiverId) {
      return res.status(400).json({ success: false, message: 'ID получателя обязателен' });
    }

    const [receiver] = await pool.query('SELECT id FROM users WHERE id = ?', [receiverId]);
    if (receiver.length === 0) {
      return res.status(404).json({ success: false, message: 'Получатель не найден' });
    }

    const [result] = await pool.query(
      'INSERT INTO calls (caller_id, receiver_id, status, start_time) VALUES (?, ?, ?, NOW())',
      [callerId, receiverId, 'initiated']
    );

    res.json({
      success: true,
      message: 'Звонок инициирован',
      callId: result.insertId,
    });
  } catch (error) {
    console.error('Ошибка инициации звонка:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при инициации звонка' });
  }
});

// Получение информации о группе
router.get('/groups/:id', authenticateToken, async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user.id;

    const [group] = await pool.query(
      `SELECT g.id, g.name, g.description, g.avatar_url, g.is_public, g.creator_id,
              COUNT(gm.user_id) as member_count
       FROM groups g
       LEFT JOIN group_members gm ON g.id = gm.group_id
       WHERE g.id = ?
       GROUP BY g.id`,
      [groupId]
    );

    if (group.length === 0) {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }

    const [isMember] = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    if (!group[0].is_public && isMember.length === 0 && group[0].creator_id !== userId) {
      return res.status(403).json({ success: false, message: 'Доступ к закрытой группе запрещён' });
    }

    res.json({
      success: true,
      data: {
        id: group[0].id,
        name: group[0].name,
        description: group[0].description,
        avatar_url: group[0].avatar_url,
        is_public: group[0].is_public,
        creator_id: group[0].creator_id,
        member_count: parseInt(group[0].member_count),
        is_member: isMember.length > 0 || group[0].creator_id === userId,
      },
    });
  } catch (error) {
    console.error('Ошибка получения информации о группе:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении информации о группе' });
  }
});

// Редактирование группы
router.put('/groups/:id', authenticateToken, upload, async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user.id;
    const { name, description, is_public } = req.body;
    const file = req.files['avatar']?.[0];

    const [group] = await pool.query(
      'SELECT creator_id, avatar_url FROM groups WHERE id = ?',
      [groupId]
    );

    if (group.length === 0) {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }

    if (group[0].creator_id !== userId) {
      return res.status(403).json({ success: false, message: 'Только создатель может редактировать группу' });
    }

    let avatarUrl = group[0].avatar_url;
    if (file) {
      const fileName = `${userId}/group_${Date.now()}${path.extname(file.originalname)}`;
      const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';
      const params = {
        Bucket: bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      };
      const s3Response = await s3.upload(params).promise();
      avatarUrl = s3Response.Location;

      if (group[0].avatar_url) {
        const oldFileName = group[0].avatar_url.split('/').slice(-2).join('/');
        await s3.deleteObject({ Bucket: bucketName, Key: oldFileName }).promise();
      }
    }

    const updates = [];
    const values = [];

    if (name) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (is_public !== undefined) {
      updates.push('is_public = ?');
      values.push(is_public === 'true');
    }
    if (avatarUrl !== group[0].avatar_url) {
      updates.push('avatar_url = ?');
      values.push(avatarUrl);
    }

    if (updates.length > 0) {
      values.push(groupId);
      await pool.query(
        `UPDATE groups SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    res.json({
      success: true,
      message: 'Группа успешно обновлена',
      avatar_url: avatarUrl,
    });
  } catch (error) {
    console.error('Ошибка редактирования группы:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при редактировании группы' });
  }
});

// Исключение участника из группы
router.delete('/groups/:groupId/members/:userId', authenticateToken, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    const creatorId = req.user.id;

    const [group] = await pool.query(
      'SELECT creator_id FROM groups WHERE id = ?',
      [groupId]
    );

    if (group.length === 0) {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }

    if (group[0].creator_id !== creatorId) {
      return res.status(403).json({ success: false, message: 'Только создатель может исключать участников' });
    }

    if (parseInt(userId) === creatorId) {
      return res.status(400).json({ success: false, message: 'Создатель не может исключить себя' });
    }

    const [member] = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    if (member.length === 0) {
      return res.status(404).json({ success: false, message: 'Пользователь не является участником группы' });
    }

    await pool.query(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    res.json({
      success: true,
      message: 'Пользователь успешно исключён из группы',
    });
  } catch (error) {
    console.error('Ошибка исключения участника:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при исключении участника' });
  }
});

// Отправка сообщения в группе
router.post('/groups/:groupId/messages', authenticateToken, upload, async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const userId = req.user.id;
    const { content } = req.body;
    const file = req.files['image']?.[0] || req.files['video']?.[0];

    const [group] = await pool.query(
      'SELECT creator_id, is_public FROM groups WHERE id = ?',
      [groupId]
    );

    if (group.length === 0) {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }

    const [isMember] = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    if (!group[0].is_public && group[0].creator_id !== userId && isMember.length === 0) {
      return res.status(403).json({ success: false, message: 'Доступ к отправке сообщений запрещён' });
    }

    if (!group[0].is_public && group[0].creator_id !== userId) {
      return res.status(403).json({ success: false, message: 'Только создатель может отправлять сообщения в закрытой группе' });
    }

    let fileUrl = null;
    let fileType = null;
    if (file) {
      const fileName = `${userId}/group_message_${Date.now()}${path.extname(file.originalname)}`;
      const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';
      const params = {
        Bucket: bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      };
      const s3Response = await s3.upload(params).promise();
      fileUrl = s3Response.Location;
      fileType = file.mimetype.startsWith('image') ? 'image' : 'video';
    }

    const [result] = await pool.query(
      'INSERT INTO group_messages (group_id, user_id, content, file_url, file_type) VALUES (?, ?, ?, ?, ?)',
      [groupId, userId, content || null, fileUrl, fileType]
    );

    res.json({
      success: true,
      message: 'Сообщение успешно отправлено',
      data: {
        id: result.insertId,
        group_id: groupId,
        user_id: userId,
        content,
        file_url: fileUrl,
        file_type: fileType,
        created_at: new Date(),
      },
    });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при отправке сообщения' });
  }
});

// Получение сообщений группы
router.get('/groups/:groupId/messages', authenticateToken, async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const userId = req.user.id;

    const [group] = await pool.query(
      'SELECT is_public, creator_id FROM groups WHERE id = ?',
      [groupId]
    );

    if (group.length === 0) {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }

    const [isMember] = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    if (!group[0].is_public && isMember.length === 0 && group[0].creator_id !== userId) {
      return res.status(403).json({ success: false, message: 'Доступ к сообщениям группы запрещён' });
    }

    const [messages] = await pool.query(
      `SELECT gm.id, gm.user_id, u.name AS user_name, gm.content, gm.file_url, gm.file_type, gm.created_at
       FROM group_messages gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY gm.created_at DESC
       LIMIT 50`,
      [groupId]
    );

    res.json({
      success: true,
      data: messages.map(msg => ({
        id: msg.id,
        user_id: msg.user_id,
        user_name: msg.user_name,
        content: msg.content,
        file_url: msg.file_url,
        file_type: msg.file_type,
        created_at: msg.created_at,
      })),
    });
  } catch (error) {
    console.error('Ошибка получения сообщений группы:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении сообщений группы' });
  }
});

// Поиск пользователей по имени
router.get('/users/search', authenticateToken, async (req, res) => {
  try {
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 1) {
      return res.status(400).json({ success: false, message: 'Введите поисковый запрос' });
    }

    // Проверяем наличие столбцов
    const [columns] = await pool.query('SHOW COLUMNS FROM users');
    const columnNames = columns.map(col => col.Field);
    const selectFields = ['id', 'name', 'phone', 'avatar_url'];
    const optionalFields = ['age', 'city', 'country', 'marital_status'];
    const availableFields = selectFields.concat(optionalFields.filter(field => columnNames.includes(field)));

    const searchTerm = `%${query.trim()}%`;
    const [rows] = await pool.query(
      `SELECT ${availableFields.join(', ')} FROM users WHERE id != ? AND name LIKE ?`,
      [userId, searchTerm]
    );

    console.log(`Поиск пользователей по запросу "${query}": найдено ${rows.length} пользователей`);

    res.json({
      success: true,
      data: rows.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatar_url: user.avatar_url,
        age: user.age || null,
        city: user.city || null,
        country: user.country || null,
        marital_status: user.marital_status || null,
        lastMessage: 'Нет сообщений',
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        unread: 0,
      })),
    });
  } catch (error) {
    console.error('Ошибка поиска пользователей:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при поиске пользователей', error: error.message });
  }
});

// Покинуть группу
router.delete('/groups/:groupId/leave', authenticateToken, async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const userId = req.user.id;

    const [group] = await pool.query(
      'SELECT creator_id FROM groups WHERE id = ?',
      [groupId]
    );

    if (group.length === 0) {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }

    if (group[0].creator_id === userId) {
      return res.status(403).json({ success: false, message: 'Создатель не может покинуть группу' });
    }

    const [member] = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    if (member.length === 0) {
      return res.status(400).json({ success: false, message: 'Вы не являетесь участником группы' });
    }

    await pool.query(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    res.json({
      success: true,
      message: 'Вы успешно покинули группу',
    });
  } catch (error) {
    console.error('Ошибка выхода из группы:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при выходе из группы' });
  }
});

// Маршрут для создания группы
router.post('/groups', authenticateToken, upload, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, description, is_public, members } = req.body;
    const file = req.files['avatar']?.[0];

    if (!name) {
      return res.status(400).json({ success: false, message: 'Название обязательно' });
    }

    let avatarUrl = null;
    if (file) {
      const fileName = `${userId}/group_${Date.now()}${path.extname(file.originalname)}`;
      const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';
      const params = {
        Bucket: bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      };
      const s3Response = await s3.upload(params).promise();
      avatarUrl = s3Response.Location;
    }

    const safeDescription = description ? String(description) : null;

    const [result] = await pool.query(
      'INSERT INTO `groups` (creator_id, name, description, avatar_url, is_public) VALUES (?, ?, ?, ?, ?)',
      [userId, name, safeDescription, avatarUrl, is_public === 'true']
    );

    if (members) {
      let memberIds;
      try {
        memberIds = JSON.parse(members);
        if (!Array.isArray(memberIds)) {
          throw new Error('Members must be an array of user IDs');
        }
      } catch (parseError) {
        console.error('Ошибка парсинга members:', parseError.message);
        return res.status(400).json({ success: false, message: 'Некорректный формат members' });
      }

      const [existingUsers] = await pool.query(
        'SELECT id FROM users WHERE id IN (?)',
        [memberIds]
      );
      const validMemberIds = existingUsers.map(user => user.id);

      const invalidMemberIds = memberIds.filter(mid => !validMemberIds.includes(mid));
      if (invalidMemberIds.length > 0) {
        console.warn('Некоторые user_id не существуют:', invalidMemberIds);
      }

      const memberInserts = validMemberIds.map(mid => [result.insertId, mid]);
      if (memberInserts.length > 0) {
        await pool.query(
          'INSERT INTO `group_members` (group_id, user_id) VALUES ? ON DUPLICATE KEY UPDATE joined_at = NOW()',
          [memberInserts]
        );
      }
    }

    res.json({
      success: true,
      message: 'Группа успешно создана',
      id: result.insertId,
      avatar_url: avatarUrl,
    });
  } catch (error) {
    console.error('Ошибка создания группы:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при создании группы', error: error.message });
  }
});

// Маршрут для завершения звонка
router.post('/call/end', authenticateToken, async (req, res) => {
  try {
    const { callId } = req.body;
    const userId = req.user.id;

    if (!callId) {
      return res.status(400).json({ success: false, message: 'ID звонка обязателен' });
    }

    const [call] = await pool.query(
      'SELECT caller_id, receiver_id FROM calls WHERE id = ? AND status != ?',
      [callId, 'ended']
    );

    if (call.length === 0) {
      return res.status(404).json({ success: false, message: 'Звонок не найден или уже завершен' });
    }

    if (call[0].caller_id !== userId && call[0].receiver_id !== userId) {
      return res.status(403).json({ success: false, message: 'Доступ запрещён' });
    }

    await pool.query(
      'UPDATE calls SET status = ?, end_time = NOW() WHERE id = ?',
      ['ended', callId]
    );

    res.json({
      success: true,
      message: 'Звонок завершен',
    });
  } catch (error) {
    console.error('Ошибка завершения звонка:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при завершении звонка' });
  }
});

// Маршрут для загрузки скриншота
router.post('/call/screenshot', authenticateToken, upload, async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.files['screenshot']?.[0];

    if (!file) {
      console.error('Скриншот не предоставлен в запросе:', req.body, req.headers);
      return res.status(400).json({ success: false, message: 'Скриншот не предоставлен' });
    }

    console.log('Загружаемый скриншот:', file.originalname, file.mimetype, file.size);

    const fileName = `${userId}/screenshot_${Date.now()}${path.extname(file.originalname)}`;
    const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';

    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    };

    const s3Response = await s3.upload(params).promise();
    const screenshotUrl = s3Response.Location;
    console.log('Скриншот загружен в S3:', screenshotUrl);

    res.json({
      success: true,
      message: 'Скриншот успешно загружен',
      screenshot_url: screenshotUrl,
    });
  } catch (error) {
    console.error('Ошибка при загрузке скриншота:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при загрузке скриншота' });
  }
});

// Маршрут для загрузки аватара
router.post('/upload/avatar', authenticateToken, (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Ошибка Multer:', err.message, err.stack);
      return res.status(400).json({ success: false, message: `Ошибка Multer: ${err.message}` });
    } else if (err) {
      console.error('Ошибка фильтрации файла:', err.message);
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.files['image']?.[0];

    if (!file) {
      console.error('Файл аватара не предоставлен в запросе:', req.body, req.headers);
      return res.status(400).json({ success: false, message: 'Файл аватара не предоставлен' });
    }

    console.log('Загружаемый аватар:', file.originalname, file.mimetype, file.size);

    const fileName = `${userId}/avatar_${Date.now()}${path.extname(file.originalname)}`;
    const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';

    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    };

    const s3Response = await s3.upload(params).promise();
    const avatarUrl = s3Response.Location;
    console.log('Аватар загружен в S3:', avatarUrl);

    await pool.query(
      'UPDATE users SET avatar_url = ? WHERE id = ?',
      [avatarUrl, userId]
    );

    res.json({
      success: true,
      message: 'Аватар успешно загружен',
      avatar_url: avatarUrl,
    });
  } catch (error) {
    console.error('Ошибка при загрузке аватара:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при загрузке аватара', error: error.message });
  }
});

// Маршрут для удаления аватара
router.delete('/delete/avatar', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [user] = await pool.query(
      'SELECT avatar_url FROM users WHERE id = ?',
      [userId]
    );

    if (user.length === 0) {
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    if (user[0].avatar_url) {
      const fileName = user[0].avatar_url.split('/').slice(-2).join('/');
      const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';

      await s3.deleteObject({
        Bucket: bucketName,
        Key: fileName,
      }).promise();

      console.log('Аватар удален из S3:', fileName);
    }

    await pool.query(
      'UPDATE users SET avatar_url = NULL WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: 'Аватар успешно удален',
    });
  } catch (error) {
    console.error('Ошибка при удалении аватара:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при удалении аватара', error: error.message });
  }
});

// Маршрут для загрузки истории
router.post('/stories', authenticateToken, (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Ошибка Multer:', err.message, err.stack);
      return res.status(400).json({ success: false, message: `Ошибка Multer: ${err.message}` });
    } else if (err) {
      console.error('Ошибка фильтрации файла:', err.message);
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.files['file']?.[0] || req.files['image']?.[0] || req.files['video']?.[0];

    if (!file) {
      console.error('Файл не предоставлен в запросе:', req.body, req.headers);
      return res.status(400).json({ success: false, message: 'Файл не предоставлен' });
    }

    console.log('Загружаемый файл:', file.originalname, file.mimetype, file.size);

    const fileName = `${userId}/${Date.now()}${path.extname(file.originalname)}`;
    const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';

    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    };

    const s3Response = await s3.upload(params).promise();
    const fileUrl = s3Response.Location;
    console.log('Файл загружен в S3:', fileUrl);

    const [result] = await pool.query(
      'INSERT INTO stories (user_id, file_path, timestamp) VALUES (?, ?, NOW())',
      [userId, fileUrl]
    );

    res.json({
      success: true,
      message: 'История успешно добавлена',
      fileUrl: fileUrl,
      id: result.insertId,
    });
  } catch (error) {
    console.error('Ошибка при загрузке истории:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при загрузке истории', error: error.message });
  }
});

// Маршрут для загрузки голосового сообщения
router.post('/voice-messages', authenticateToken, (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Ошибка Multer:', err.message, err.stack);
      return res.status(400).json({ success: false, message: `Ошибка Multer: ${err.message}` });
    } else if (err) {
      console.error('Ошибка фильтрации файла:', err.message);
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const userId = req.user.id;
    const file = req.files['voice']?.[0];

    if (!file) {
      console.error('Голосовое сообщение не предоставлено в запросе:', req.body, req.headers);
      return res.status(400).json({ success: false, message: 'Голосовое сообщение не предоставлено' });
    }

    console.log('Загружаемое голосовое сообщение:', file.originalname, file.mimetype, file.size);

    const fileName = `${userId}/voice_${Date.now()}${path.extname(file.originalname)}`;
    const bucketName = '4eeafbc6-4af2cd44-4c23-4530-a2bf-750889dfdf75';

    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read',
    };

    const s3Response = await s3.upload(params).promise();
    const fileUrl = s3Response.Location;
    console.log('Голосовое сообщение загружено в S3:', fileUrl);

    const [result] = await pool.query(
      'INSERT INTO voice_messages (user_id, file_path, timestamp) VALUES (?, ?, NOW())',
      [userId, fileUrl]
    );

    res.json({
      success: true,
      message: 'Голосовое сообщение успешно добавлено',
      fileUrl: fileUrl,
      id: result.insertId,
    });
  } catch (error) {
    console.error('Ошибка при загрузке голосового сообщения:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при загрузке голосового сообщения', error: error.message });
  }
});

// Маршрут для получения историй
router.get('/stories', authenticateToken, async (req, res) => {
  try {
    const [stories] = await pool.query(`
      SELECT s.id, s.user_id, s.file_path, s.timestamp, u.name AS user_name
      FROM stories s
      JOIN users u ON s.user_id = u.id
      WHERE s.timestamp >= NOW() - INTERVAL 24 HOUR
      ORDER BY s.user_id = ? DESC, s.timestamp DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: stories,
    });
  } catch (error) {
    console.error('Ошибка получения историй:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении историй', error: error.message });
  }
});

// Маршрут для регистрации просмотра истории
router.post('/stories/:id/view', authenticateToken, async (req, res) => {
  try {
    const storyId = req.params.id;
    const userId = req.user.id;

    await pool.query(
      'INSERT INTO story_views (story_id, user_id, viewed_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE viewed_at = NOW()',
      [storyId, userId]
    );

    res.json({
      success: true,
      message: 'Просмотр зарегистрирован',
    });
  } catch (error) {
    console.error('Ошибка регистрации просмотра:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации просмотра', error: error.message });
  }
});

// Маршрут для получения просмотров истории
router.get('/stories/:id/views', authenticateToken, async (req, res) => {
  try {
    const storyId = req.params.id;
    const userId = req.user.id;

    const [story] = await pool.query(
      'SELECT user_id FROM stories WHERE id = ?',
      [storyId]
    );

    if (story.length === 0) {
      return res.status(404).json({ success: false, message: 'История не найдена' });
    }

    if (story[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Доступ запрещён' });
    }

    const [views] = await pool.query(`
      SELECT u.name
      FROM story_views sv
      JOIN users u ON sv.user_id = u.id
      WHERE sv.story_id = ?
    `, [storyId]);

    res.json({
      success: true,
      data: {
        viewCount: views.length,
        viewers: views.map(view => ({ name: view.name })),
      },
    });
  } catch (error) {
    console.error('Ошибка получения просмотров:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении просмотров', error: error.message });
  }
});

// Маршрут для получения профиля пользователя
router.get('/user/profile', authenticateToken, async (req, res) => {
  try {
    const [columns] = await pool.query('SHOW COLUMNS FROM users');
    const columnNames = columns.map(col => col.Field);
    const selectFields = ['id', 'name', 'phone', 'avatar_url'];
    const optionalFields = ['age', 'city', 'country', 'marital_status'];
    const availableFields = selectFields.concat(optionalFields.filter(field => columnNames.includes(field)));

    const [rows] = await pool.query(
      `SELECT ${availableFields.join(', ')} FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (rows.length === 0) {
      console.error('Пользователь не найден, id:', req.user.id);
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const user = rows[0];
    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatar_url: user.avatar_url,
        age: user.age || null,
        city: user.city || null,
        country: user.country || null,
        marital_status: user.marital_status || null,
      },
    });
  } catch (error) {
    console.error('Ошибка получения профиля:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении профиля', error: error.message });
  }
});

// Маршрут для обновления профиля
router.put('/users/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone, password, age, city, country, marital_status } = req.body;
    const userId = req.user.id;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Имя и телефон обязательны' });
    }

    if (marital_status && !['Женат/Замужем', 'Холост/Холостячка', 'В активном поиске'].includes(marital_status)) {
      return res.status(400).json({ success: false, message: 'Недопустимое семейное положение' });
    }

    if (age && isNaN(parseInt(age))) {
      return res.status(400).json({ success: false, message: 'Возраст должен быть числом' });
    }

    const updates = [];
    const values = [];

    if (name) {
      updates.push('name = ?');
      values.push(name);
    }
    if (phone) {
      updates.push('phone = ?');
      values.push(phone);
    }
    if (password) {
      const bcrypt = require('bcrypt');
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      updates.push('password = ?');
      values.push(hashedPassword);
    }
    if (age !== undefined) {
      updates.push('age = ?');
      values.push(age ? parseInt(age) : null);
    }
    if (city !== undefined) {
      updates.push('city = ?');
      values.push(city || null);
    }
    if (country !== undefined) {
      updates.push('country = ?');
      values.push(country || null);
    }
    if (marital_status !== undefined) {
      updates.push('marital_status = ?');
      values.push(marital_status || null);
    }

    if (updates.length > 0) {
      values.push(userId);
      await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    res.json({
      success: true,
      message: 'Профиль успешно обновлен',
    });
  } catch (error) {
    console.error('Ошибка обновления профиля:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при обновлении профиля', error: error.message });
  }
});

// Маршруты для регистрации и логина
router.post('/register', userController.register);
router.post('/login', userController.login);

// Маршрут для получения списка пользователей
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const [columns] = await pool.query('SHOW COLUMNS FROM users');
    const columnNames = columns.map(col => col.Field);
    const selectFields = ['id', 'name', 'phone', 'avatar_url'];
    const optionalFields = ['age', 'city', 'country', 'marital_status'];
    const availableFields = selectFields.concat(optionalFields.filter(field => columnNames.includes(field)));

    const [rows] = await pool.query(
      `SELECT ${availableFields.join(', ')} FROM users WHERE id != ?`,
      [req.user.id]
    );

    console.log('Получены пользователи:', rows.length);
    res.json({
      success: true,
      data: rows.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatar_url: user.avatar_url,
        age: user.age || null,
        city: user.city || null,
        country: user.country || null,
        marital_status: user.marital_status || null,
        lastMessage: 'Нет сообщений',
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        unread: 0,
      })),
    });
  } catch (error) {
    console.error('Ошибка получения списка пользователей:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении списка пользователей', error: error.message });
  }
});

module.exports = router;
