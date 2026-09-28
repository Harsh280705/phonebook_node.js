'use strict';

// Central configuration. Mirrors backend/src/main/resources/application.properties
// plus docker-compose environment (MONGODB_URI, SERVER_PORT/PORT).
//
// DATABASE ISOLATION: this backend NEVER touches the original Java backend's
// database/collections. Defaults use a separate database (phonebook_node) and
// separate prefixed collections (nodejs_*). See db/mongo.js COLLECTIONS.
module.exports = {
  port: parseInt(process.env.SERVER_PORT || process.env.PORT || '8000', 10),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/phonebook_node',
  cookieName: 'phonebook_session',
  sessionDays: 7,
};
