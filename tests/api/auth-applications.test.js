'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../../application/backend/src/app');
const { signToken, hashPassword } = require('../../application/backend/src/auth');

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

function request(server, method, path, body, token) {
  const { port } = server.address();
  const payload = body ? JSON.stringify(body) : null;
  const headers = {};
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let respBody = '';
        res.on('data', (c) => (respBody += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = respBody ? JSON.parse(respBody) : null;
          } catch {
            parsed = respBody;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('POST /api/auth/signup registers a new user, auto-provisions sandbox app, and returns token', async () => {
  const users = [];
  const apps = [];
  const mockQuery = async (sql, params) => {
    if (sql.includes('SELECT id FROM users WHERE email = $1')) {
      const found = users.filter((u) => u.email === params[0]);
      return { rowCount: found.length, rows: found };
    }
    if (sql.includes('INSERT INTO users')) {
      const u = {
        id: 'user-uuid-1',
        email: params[0],
        display_name: params[1],
        password_hash: params[2],
        salt: params[3],
        role: params[4],
        created_at: new Date().toISOString(),
      };
      users.push(u);
      return { rowCount: 1, rows: [u] };
    }
    if (sql.includes('INSERT INTO applications')) {
      const a = {
        id: 'app-uuid-1',
        name: params[0],
        description: params[1],
        framework: params[2],
        owner_id: params[3],
      };
      apps.push(a);
      return { rowCount: 1, rows: [a] };
    }
    return { rowCount: 0, rows: [] };
  };

  const app = createApp({ query: mockQuery });
  const server = await startServer(app);
  try {
    const res = await request(server, 'POST', '/api/auth/signup', {
      email: 'newuser@example.com',
      password: 'StrongPassword123!',
      displayName: 'New User',
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'newuser@example.com');
    assert.equal(res.body.user.displayName, 'New User');
    assert.equal(res.body.user.password_hash, undefined); // sanitized
    assert.equal(users.length, 1);
    assert.equal(apps.length, 1);
    assert.equal(apps[0].name, 'My First Application');
  } finally {
    server.close();
  }
});

test('POST /api/auth/signup rejects invalid emails or short passwords', async () => {
  const app = createApp({ query: async () => ({ rowCount: 0, rows: [] }) });
  const server = await startServer(app);
  try {
    const badEmail = await request(server, 'POST', '/api/auth/signup', {
      email: 'not-an-email',
      password: 'StrongPassword123!',
    });
    assert.equal(badEmail.status, 400);

    const shortPass = await request(server, 'POST', '/api/auth/signup', {
      email: 'valid@example.com',
      password: 'short',
    });
    assert.equal(shortPass.status, 400);
  } finally {
    server.close();
  }
});

test('POST /api/auth/login succeeds with valid credentials and fails with invalid credentials', async () => {
  const { hash, salt } = hashPassword('CorrectPassword123!');
  const mockUser = {
    id: 'user-uuid-login',
    email: 'login@example.com',
    display_name: 'Login User',
    password_hash: hash,
    salt,
    role: 'operator',
    created_at: new Date().toISOString(),
  };

  const mockQuery = async (sql, params) => {
    if (sql.includes('SELECT * FROM users WHERE email = $1')) {
      if (params[0] === 'login@example.com') {
        return { rowCount: 1, rows: [mockUser] };
      }
      return { rowCount: 0, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  };

  const app = createApp({ query: mockQuery });
  const server = await startServer(app);
  try {
    // Valid login
    const res = await request(server, 'POST', '/api/auth/login', {
      email: 'login@example.com',
      password: 'CorrectPassword123!',
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'login@example.com');

    // Invalid password
    const wrongPass = await request(server, 'POST', '/api/auth/login', {
      email: 'login@example.com',
      password: 'WrongPassword!',
    });
    assert.equal(wrongPass.status, 401);

    // Non-existent user
    const noUser = await request(server, 'POST', '/api/auth/login', {
      email: 'nonexistent@example.com',
      password: 'SomePassword123!',
    });
    assert.equal(noUser.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/auth/me requires authentication and returns authenticated user', async () => {
  const mockUser = {
    id: 'user-me-123',
    email: 'me@example.com',
    display_name: 'Me User',
    role: 'operator',
    created_at: new Date().toISOString(),
  };

  const token = signToken(mockUser);

  const mockQuery = async (sql, params) => {
    if (sql.includes('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1')) {
      if (params[0] === 'user-me-123') {
        return { rowCount: 1, rows: [mockUser] };
      }
    }
    return { rowCount: 0, rows: [] };
  };

  const app = createApp({ query: mockQuery });
  const server = await startServer(app);
  try {
    // Without token
    const unauth = await request(server, 'GET', '/api/auth/me');
    assert.equal(unauth.status, 401);

    // With valid token
    const auth = await request(server, 'GET', '/api/auth/me', null, token);
    assert.equal(auth.status, 200);
    assert.equal(auth.body.user.email, 'me@example.com');
  } finally {
    server.close();
  }
});

test('POST /api/applications creates an application owned by authenticated user', async () => {
  const mockUser = {
    id: 'user-app-creator',
    email: 'creator@example.com',
    display_name: 'Creator',
    role: 'operator',
  };
  const token = signToken(mockUser);

  const mockQuery = async (sql, params) => {
    if (sql.includes('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1')) {
      return { rowCount: 1, rows: [mockUser] };
    }
    if (sql.includes('SELECT id FROM applications WHERE owner_id = $1 AND name = $2')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('INSERT INTO applications')) {
      return {
        rowCount: 1,
        rows: [
          {
            id: 'new-app-1',
            name: params[0],
            description: params[1],
            repository_url: params[2],
            framework: params[3],
            owner_id: params[4],
          },
        ],
      };
    }
    return { rowCount: 0, rows: [] };
  };

  const app = createApp({ query: mockQuery });
  const server = await startServer(app);
  try {
    // Unauthenticated creation fails
    const unauth = await request(server, 'POST', '/api/applications', {
      name: 'Custom Service',
    });
    assert.equal(unauth.status, 401);

    // Authenticated creation succeeds
    const res = await request(
      server,
      'POST',
      '/api/applications',
      {
        name: 'Custom Service',
        description: 'My microservice',
        repository_url: 'https://github.com/test/service',
        framework: 'Go / Gin',
      },
      token
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Custom Service');
    assert.equal(res.body.owner_id, 'user-app-creator');
  } finally {
    server.close();
  }
});

test('GET /api/analyzer/experiments supports scope=mine and application_id filtering', async () => {
  const mockUser = {
    id: 'user-scope-test',
    email: 'scoped@example.com',
    display_name: 'Scoped',
    role: 'operator',
  };
  const token = signToken(mockUser);

  let capturedSql = '';
  let capturedParams = [];

  const mockQuery = async (sql, params) => {
    capturedSql = sql;
    capturedParams = params || [];
    if (sql.includes('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1')) {
      return { rowCount: 1, rows: [mockUser] };
    }
    if (sql.includes('SELECT id, name, owner_id FROM applications WHERE id = $1')) {
      return { rowCount: 1, rows: [{ id: 'app-123', name: 'CloudPort Core Research Suite', owner_id: 'user-scope-test' }] };
    }
    return { rowCount: 0, rows: [] };
  };

  const app = createApp({ query: mockQuery });
  const server = await startServer(app);
  try {
    // With scope=mine and user token
    await request(server, 'GET', '/api/analyzer/experiments?scope=mine', null, token);
    assert.ok(capturedSql.includes('WHERE created_by = $1'));
    assert.equal(capturedParams[0], 'user-scope-test');

    // With application_id
    await request(server, 'GET', '/api/analyzer/experiments?application_id=app-123');
    assert.ok(capturedSql.includes('WHERE application_id = $1'));
    assert.equal(capturedParams[0], 'app-123');
  } finally {
    server.close();
  }
});
