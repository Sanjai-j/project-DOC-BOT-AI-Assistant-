import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

/**
 * GET /api/hospitals — search hospitals (public).
 * Filters: q (name/address), city, specialty, emergency, minRating.
 */
router.get('/', async (req, res, next) => {
  try {
    const db = await getDb();
    const { q, city, specialty, emergency, minRating } = req.query as Record<string, string | undefined>;
    const params: unknown[] = [];
    const where: string[] = [];

    if (q) {
      params.push(`%${q}%`);
      where.push(`(name ILIKE $${params.length} OR address ILIKE $${params.length})`);
    }
    if (city) {
      params.push(`%${city}%`);
      where.push(`(city ILIKE $${params.length} OR address ILIKE $${params.length})`);
    }
    if (specialty) {
      params.push(specialty);
      where.push(`$${params.length} = ANY(specialties)`);
    }
    if (emergency === 'true') where.push(`emergency_24x7 = true`);
    if (minRating) {
      params.push(Number(minRating));
      where.push(`rating >= $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT h.*,
              (SELECT COUNT(*) FROM doctors d WHERE d.hospital_id = h.id AND d.status = 'APPROVED') AS doctors_count
       FROM hospitals h
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY rating DESC, reviews_count DESC
       LIMIT 100`,
      params
    );
    res.json({ hospitals: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hospitals/nearby?lat=&lng=&city=
 * Haversine distance ranking on stored coordinates — works with zero maps credentials.
 */
router.get('/nearby', async (req, res, next) => {
  try {
    const db = await getDb();
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const { rows } = await db.query(
        `SELECT h.*,
                (SELECT COUNT(*) FROM doctors d WHERE d.hospital_id = h.id AND d.status = 'APPROVED') AS doctors_count,
                (6371 * acos(
                   LEAST(1.0, cos(radians($1)) * cos(radians(h.lat)) *
                   cos(radians(h.lng) - radians($2)) +
                   sin(radians($1)) * sin(radians(h.lat)))
                )) AS distance_km
         FROM hospitals h
         WHERE h.lat IS NOT NULL AND h.lng IS NOT NULL
         ORDER BY distance_km ASC LIMIT 50`,
        [lat, lng]
      );
      res.json({ hospitals: rows, mode: 'coordinates' });
      return;
    }
    const city = (req.query.city as string) ?? '';
    const params: unknown[] = [];
    let where = '';
    if (city) {
      params.push(`%${city}%`);
      where = `WHERE city ILIKE $1 OR address ILIKE $1`;
    }
    const { rows } = await db.query(
      `SELECT h.*,
              (SELECT COUNT(*) FROM doctors d WHERE d.hospital_id = h.id AND d.status = 'APPROVED') AS doctors_count,
              NULL::float AS distance_km
       FROM hospitals h ${where}
       ORDER BY rating DESC LIMIT 50`,
      params
    );
    res.json({ hospitals: rows, mode: city ? 'city' : 'no-location' });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hospitals/top-rated — transparent ranking:
 * rating desc, then review count, then specialty coverage.
 */
router.get('/top-rated', async (_req, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(
      `SELECT h.*,
              (SELECT COUNT(*) FROM doctors d WHERE d.hospital_id = h.id AND d.status = 'APPROVED') AS doctors_count,
              (SELECT COUNT(DISTINCT specialization) FROM doctors d WHERE d.hospital_id = h.id AND d.status = 'APPROVED') AS specialty_count
       FROM hospitals h
       ORDER BY h.rating DESC, h.reviews_count DESC, specialty_count DESC
       LIMIT 12`
    );
    res.json({ hospitals: rows });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/hospitals/:id — hospital detail + its approved doctors.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const { rows } = await db.query(`SELECT * FROM hospitals WHERE id = $1`, [req.params.id]);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Hospital not found.' });
      return;
    }
    const docs = await db.query(
      `SELECT d.id, d.specialization, d.experience_years, d.avg_rating, d.reviews_count,
              d.consultation_fee, d.fee_currency, d.photo_url, u.full_name
       FROM doctors d JOIN users u ON u.id = d.id
       WHERE d.hospital_id = $1 AND d.status = 'APPROVED'
       ORDER BY d.avg_rating DESC`,
      [req.params.id]
    );
    res.json({ hospital: rows[0], doctors: docs.rows });
  } catch (e) {
    next(e);
  }
});

export default router;
