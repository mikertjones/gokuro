import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type } = req.query;

  try {
    let query, params = [];

    switch (type) {
      case 'week':
        // Today + previous 6 days (7 days total)
        query = `
          SELECT id, puzzle_date, configuration, puzzle_data, created_at 
          FROM gokuropuzzles 
          WHERE puzzle_date >= CURRENT_DATE - INTERVAL '6 days'
            AND puzzle_date <= CURRENT_DATE
          ORDER BY puzzle_date DESC
        `;
        break;

      case 'today':
        query = `
          SELECT id, puzzle_date, configuration, puzzle_data, created_at 
          FROM gokuropuzzles 
          WHERE puzzle_date = CURRENT_DATE
        `;
        break;

      case 'latest':
        const { limit = 10 } = req.query;
        query = `
          SELECT id, puzzle_date, configuration, puzzle_data, created_at 
          FROM gokuropuzzles 
          ORDER BY puzzle_date DESC 
          LIMIT $1
        `;
        params = [parseInt(limit)];
        break;

      default:
        return res.status(400).json({ error: 'Invalid type. Use: week, today, or latest' });
    }

    const result = await pool.query(query, params);

    res.json({
      type,
      puzzles: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}