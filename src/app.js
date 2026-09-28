'use strict';

// Express application factory (separated from listen() for supertest).

const express = require('express');
const cookieParser = require('cookie-parser');
const { ApiError } = require('./apiError');
const authRoutes = require('./controllers/authController');
const contactRoutes = require('./controllers/contactController');
const tagRoutes = require('./controllers/tagController');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  // Malformed JSON -> 400 { detail } (Spring returns 400 for unreadable body).
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      return res.status(400).json({ detail: 'Malformed request body.' });
    }
    return next(err);
  });

  app.get('/', (req, res) => {
    res.json({ message: 'Phonebook API is running' });
  });

  app.use(authRoutes);
  app.use(contactRoutes);
  app.use(tagRoutes);

  // Unknown routes -> 404 { detail }.
  app.use((req, res) => {
    res.status(404).json({ detail: 'Not found.' });
  });

  // ApiError handler (mirrors ApiExceptionHandler) + fallback 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json(err.body);
    }
    // Multer errors (multipart problems) -> 400 { detail }.
    if (err && err.name === 'MulterError') {
      return res.status(400).json({ detail: 'Please upload a CSV file.' });
    }
    // Duplicate key races not caught locally -> 409.
    if (err && err.code === 11000) {
      return res.status(409).json({ detail: 'A record with these unique details already exists.' });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return res.status(500).json({ detail: 'Internal server error.' });
  });

  return app;
}

module.exports = { createApp };
