const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'carapp',
  password: process.env.DB_PASSWORD || 'carapp',
  database: process.env.DB_NAME || 'car_compare'
};

let pool;

async function waitForDb(maxRetries = 60, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const connection = await mysql.createConnection(config);
      await connection.ping();
      await connection.end();
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`Nie udało się połączyć z MySQL po ${maxRetries} próbach: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

module.exports = {
  waitForDb,
  getPool
};
