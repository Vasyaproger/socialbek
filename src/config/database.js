const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: vh438.timeweb.ru,
  user: ch79145_social,
  password: Vasya11091109,
  database: ch79145_social,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;