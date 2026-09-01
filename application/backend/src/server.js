#!/usr/bin/env node
'use strict';

const { createApp } = require('./app');
const db = require('./db');

const PORT = process.env.PORT || 4000;

const app = createApp({ query: db.query });

app.listen(PORT, () => {
  console.log(`CloudPort backend listening on port ${PORT}`);
  console.log(`Application version: ${process.env.APP_VERSION || 'cloudport:1.0.0'}`);
});
