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
]);

// Инициализация базы данных
const initializeDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Подключение к базе данных успешно');

    await connection.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255) DEFAULT NULL
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS stories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
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


    // Таблица для групп
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
    await connection.query(`
      CREATE TABLE IF NOT EXISTS voice_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
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
    console.log('Таблицы users, stories, story_views, voice_messages и calls готовы');

    connection.release();
  } catch (err) {
    console.error('Ошибка инициализации базы данных:', err.stack);
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

    const [result] = await pool.query(
     'INSERT INTO `groups` (creator_id, name, description, avatar_url, is_public) VALUES (?, ?, ?, ?, ?)',
      [userId, name, description, avatarUrl, is_public === 'true']
    );

    if (members) {
      const memberIds = JSON.parse(members);
      const memberInserts = memberIds.map(mid => [result.insertId, mid]);
      await pool.query(
        'INSERT INTO group_members (group_id, user_id) VALUES ? ON DUPLICATE KEY UPDATE joined_at = NOW()',
        [memberInserts]
      );
    }

    res.json({
      success: true,
      message: 'Группа успешно создана',
      id: result.insertId,
      avatar_url: avatarUrl,
    });
  } catch (error) {
    console.error('Ошибка создания группы:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при создании группы', error: error.message });
  }
});

// Маршрут для получения списка групп
router.get('/groups', authenticateToken, async (req, res) => {
  try {
    const [groups] = await pool.query(`
      SELECT g.id, g.creator_id, g.name, g.description, g.avatar_url, g.is_public, g.created_at,
             (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count
      FROM groups g
      ORDER BY g.created_at DESC
    `);

    res.json({
      success: true,
      data: groups.map(group => ({
        id: group.id,
        creator_id: group.creator_id,
        name: group.name,
        description: group.description,
        avatar_url: group.avatar_url,
        is_public: group.is_public,
        member_count: group.member_count,
      })),
    });
  } catch (error) {
    console.error('Ошибка получения групп:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении групп', error: error.message });
  }
});

// Маршрут для подписки на группу
router.post('/groups/:id/join', authenticateToken, async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user.id;

    const [group] = await pool.query('SELECT is_public FROM groups WHERE id = ?', [groupId]);
    if (group.length === 0) {
      return res.status(404).json({ success: false, message: 'Группа не найдена' });
    }

    if (!group[0].is_public) {
      return res.status(403).json({ success: false, message: 'Это закрытая группа, требуется приглашение' });
    }

    await pool.query(
      'INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE joined_at = NOW()',
      [groupId, userId]
    );

    res.json({
      success: true,
      message: 'Вы успешно присоединились к группе',
    });
  } catch (error) {
    console.error('Ошибка присоединения к группе:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при присоединении к группе', error: error.message });
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

// Остальные маршруты (без изменений)
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
      data: stories
    });
  } catch (error) {
    console.error('Ошибка получения историй:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении историй', error: error.message });
  }
});

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
      message: 'Просмотр зарегистрирован'
    });
  } catch (error) {
    console.error('Ошибка регистрации просмотра:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при регистрации просмотра', error: error.message });
  }
});

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
        viewers: views.map(view => ({ name: view.name }))
      }
    });
  } catch (error) {
    console.error('Ошибка получения просмотров:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении просмотров', error: error.message });
  }
});

router.get('/user/profile', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT name, phone, avatar_url FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      console.error('Пользователь не найден, id:', req.user.id);
      return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const user = rows[0];
    res.json({
      success: true,
      data: {
        name: user.name,
        phone: user.phone,
        avatar_url: user.avatar_url,
      },
    });
  } catch (error) {
    console.error('Ошибка получения профиля:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при получении профиля', error: error.message });
  }
});

router.put('/users/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    const userId = req.user.id;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Имя и телефон обязательны' });
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

    values.push(userId);

    await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({
      success: true,
      message: 'Профиль успешно обновлен',
    });
  } catch (error) {
    console.error('Ошибка обновления профиля:', error.stack);
    res.status(500).json({ success: false, message: 'Ошибка сервера при обновлении профиля', error: error.message });
  }
});

router.post('/register', userController.register);
router.post('/login', userController.login);
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, phone, avatar_url FROM users WHERE id != ?', [req.user.id]);
    console.log('Получены пользователи:', rows.length);
    res.json({
      success: true,
      data: rows.map((user) => ({
        id: user.id,
        name: user.name,
        phone: user.phone,
        avatar_url: user.avatar_url,
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