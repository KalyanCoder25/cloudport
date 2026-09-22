'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectFromFiles,
  detectTechnologyFromRepo,
  normalizeTechnology,
  TECHNOLOGY_KEYS,
} = require('../../application/backend/src/deployments/technologyDetector');

test('normalizeTechnology: maps common strings to canonical values', () => {
  assert.equal(normalizeTechnology('Node.js / Express'), 'NODE');
  assert.equal(normalizeTechnology('React / Vite'), 'REACT_VITE');
  assert.equal(normalizeTechnology('react'), 'REACT_VITE');
  assert.equal(normalizeTechnology('Python / Flask'), 'PYTHON');
  assert.equal(normalizeTechnology('django'), 'DJANGO');
  assert.equal(normalizeTechnology('Java / Spring Boot'), 'JAVA');
  assert.equal(normalizeTechnology('go'), 'GO');
  assert.equal(normalizeTechnology('php'), 'PHP');
  assert.equal(normalizeTechnology('.NET Core'), 'DOTNET');
  assert.equal(normalizeTechnology('docker'), 'DOCKER');
  assert.equal(normalizeTechnology('custom'), 'CUSTOM');
  assert.equal(normalizeTechnology('unknown-xyz'), 'UNKNOWN');
});

test('technology detection: Node.js (package.json without React)', () => {
  const fileContents = {
    'package.json': JSON.stringify({
      name: 'express-api',
      dependencies: { express: '^4.18.2' },
      scripts: { start: 'node index.js' },
    }),
  };
  const result = detectFromFiles(Object.keys(fileContents), fileContents);
  assert.equal(result.technology, 'NODE');
  assert.equal(result.framework, 'Express');
  assert.ok(result.confidence >= 0.85);
  assert.ok(result.evidence.includes('package.json'));
});

test('technology detection: React / Vite (package.json with React and vite.config.ts)', () => {
  const fileContents = {
    'package.json': JSON.stringify({
      name: 'vite-client',
      dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
      devDependencies: { vite: '^5.0.0' },
    }),
    'vite.config.ts': 'export default defineConfig({})',
  };
  const result = detectFromFiles(Object.keys(fileContents), fileContents);
  assert.equal(result.technology, 'REACT_VITE');
  assert.equal(result.framework, 'React + Vite');
  assert.ok(result.confidence >= 0.9);
  assert.ok(result.evidence.includes('vite.config.ts'));
});

test('technology detection: Python (requirements.txt)', () => {
  const fileContents = {
    'requirements.txt': 'flask==2.3.2\nrequests>=2.28.0\n',
  };
  const result = detectFromFiles(Object.keys(fileContents), fileContents);
  assert.equal(result.technology, 'PYTHON');
  assert.equal(result.framework, 'Flask');
  assert.ok(result.confidence >= 0.85);
  assert.ok(result.evidence.includes('requirements.txt'));
});

test('technology detection: Django (manage.py + requirements.txt)', () => {
  const fileContents = {
    'manage.py': '#!/usr/bin/env python\nimport os\n',
    'requirements.txt': 'django>=4.2.0\npsycopg2-binary==2.9.6\n',
  };
  const result = detectFromFiles(Object.keys(fileContents), fileContents);
  assert.equal(result.technology, 'DJANGO');
  assert.equal(result.framework, 'Django');
  assert.ok(result.confidence >= 0.95);
  assert.ok(result.evidence.includes('manage.py'));
});

test('technology detection: Java (pom.xml)', () => {
  const fileContents = {
    'pom.xml': '<project><dependencies><dependency><groupId>org.springframework.boot</groupId></dependency></dependencies></project>',
  };
  const result = detectFromFiles(Object.keys(fileContents), fileContents);
  assert.equal(result.technology, 'JAVA');
  assert.equal(result.framework, 'Spring Boot');
  assert.ok(result.confidence >= 0.85);
  assert.ok(result.evidence.includes('pom.xml'));
});

test('technology detection: Go (go.mod)', () => {
  const fileContents = {
    'go.mod': 'module github.com/test/app\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
  };
  const result = detectFromFiles(Object.keys(fileContents), fileContents);
  assert.equal(result.technology, 'GO');
  assert.equal(result.framework, 'Gin');
  assert.ok(result.confidence >= 0.85);
  assert.ok(result.evidence.includes('go.mod'));
});

test('technology detection: PHP (composer.json)', () => {
  const fileContents = {
    'composer.json': JSON.stringify({
      require: { 'laravel/framework': '^10.0' },
    }),
  };
  const result = detectFromFiles(Object.keys(fileContents), fileContents);
  assert.equal(result.technology, 'PHP');
  assert.equal(result.framework, 'Laravel');
  assert.ok(result.confidence >= 0.85);
  assert.ok(result.evidence.includes('composer.json'));
});

test('technology detection: .NET (*.csproj or *.sln)', () => {
  const fileContents = {
    'App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
  };
  const result = detectFromFiles(['App.csproj'], fileContents);
  assert.equal(result.technology, 'DOTNET');
  assert.equal(result.framework, 'ASP.NET Core');
  assert.ok(result.confidence >= 0.85);
  assert.ok(result.evidence.includes('App.csproj'));
});

test('technology detection: Docker (Dockerfile)', () => {
  const fileContents = {
    'Dockerfile': 'FROM alpine:latest\nCMD ["echo", "hello"]\n',
  };
  const result = detectFromFiles(['Dockerfile'], fileContents);
  assert.equal(result.technology, 'DOCKER');
  assert.equal(result.framework, 'Containerized');
  assert.ok(result.confidence >= 0.85);
  assert.ok(result.evidence.includes('Dockerfile'));
});

test('technology detection: Unknown repository when evidence is insufficient', () => {
  const fileContents = {
    'README.md': '# My Project\nThis is a documentation-only repo.',
    'LICENSE': 'MIT',
  };
  const result = detectFromFiles(Object.keys(fileContents), fileContents);
  assert.equal(result.technology, 'UNKNOWN');
  assert.equal(result.confidence, 0);
  assert.ok(result.message.includes('Manual configuration required'));
});
