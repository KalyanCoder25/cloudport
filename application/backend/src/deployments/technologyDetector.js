/**
 * CloudPort Repository Technology Detection Engine.
 *
 * Safely inspects repository file markers without executing arbitrary code.
 * Infers language, framework, default port, build, and start commands.
 * Returns UNKNOWN when evidence is ambiguous or insufficient.
 */
'use strict';

const https = require('https');
const http = require('http');

const SUPPORTED_TECHNOLOGIES = [
  'AUTO',
  'NODE',
  'REACT_VITE',
  'PYTHON',
  'DJANGO',
  'JAVA',
  'GO',
  'PHP',
  'DOTNET',
  'DOCKER',
  'CUSTOM',
  'UNKNOWN',
];

/**
 * Normalizes user-specified or detected technology keys.
 */
function normalizeTechnology(tech) {
  if (!tech) return 'UNKNOWN';
  const raw = String(tech).toUpperCase().trim();
  if (raw.includes('.NET') || raw.includes('DOTNET') || raw.includes('C#') || raw.includes('CSHARP')) return 'DOTNET';
  const clean = raw.replace(/[^A-Z0-9_]/g, '_');
  if (SUPPORTED_TECHNOLOGIES.includes(clean)) return clean;
  if (clean.includes('REACT') || clean.includes('VITE')) return 'REACT_VITE';
  if (clean.includes('DJANGO')) return 'DJANGO';
  if (clean.includes('NODE') || clean.includes('EXPRESS')) return 'NODE';
  if (clean.includes('PYTHON') || clean.includes('FASTAPI') || clean.includes('FLASK')) return 'PYTHON';
  if (clean.includes('JAVA') || clean.includes('SPRING')) return 'JAVA';
  if (clean.includes('GO') || clean.includes('GOLANG')) return 'GO';
  if (clean.includes('PHP') || clean.includes('LARAVEL')) return 'PHP';
  if (clean.includes('DOCKER') || clean.includes('CONTAINER')) return 'DOCKER';
  if (clean.includes('CUSTOM')) return 'CUSTOM';
  return 'UNKNOWN';
}

/**
 * Detects technology from a file inventory / manifest map.
 * This function is pure and hermetic, making it safe and unit-testable.
 *
 * @param {string[]} fileList - array of filenames in the repo root/tree
 * @param {Record<string, string>} [fileContents] - optional file contents (e.g. package.json content)
 * @returns {object} structured technology detection report
 */
function detectFromFiles(fileList = [], fileContents = {}) {
  const evidence = [];

  // Helper to read file content safely
  const getContent = (name) => {
    const key = Object.keys(fileContents).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? fileContents[key] : '';
  };

  // 1. React / Vite check
  const pkgFile = fileList.find((f) => f.toLowerCase() === 'package.json' || f.toLowerCase().endsWith('/package.json'));
  const viteFile = fileList.find((f) => f.toLowerCase().startsWith('vite.config.') || f.toLowerCase().includes('/vite.config.'));
  if (pkgFile) {
    const pkgText = getContent(pkgFile);
    let pkgJson = {};
    try {
      pkgJson = JSON.parse(pkgText);
    } catch (_err) {
      pkgJson = {};
    }
    const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
    const hasReactDep = Boolean(deps['react'] || deps['react-dom']) || pkgText.includes('"react"');
    const hasViteDep = Boolean(deps['vite']) || pkgText.includes('"vite"') || Boolean(viteFile);
    if (hasReactDep && hasViteDep) {
      evidence.push(pkgFile);
      if (viteFile) evidence.push(viteFile);
      return {
        technology: 'REACT_VITE',
        framework: 'React + Vite',
        confidence: 0.95,
        evidence,
        source: 'repository-inspection',
        recommendedConfig: {
          port: 5173,
          buildCommand: 'npm run build',
          startCommand: 'npm run preview',
          dockerfilePath: fileList.find((f) => f.toLowerCase() === 'dockerfile') || null,
        },
      };
    }
  }

  // 2. Node.js / Express check
  if (pkgFile) {
    evidence.push(pkgFile);
    const pkgText = getContent(pkgFile);
    let pkgJson = {};
    try {
      pkgJson = JSON.parse(pkgText);
    } catch (_err) {
      pkgJson = {};
    }
    const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
    const isExpress = Boolean(deps['express']) || pkgText.includes('"express"');
    return {
      technology: 'NODE',
      framework: isExpress ? 'Express' : 'Node.js',
      confidence: isExpress ? 0.95 : 0.88,
      evidence,
      source: 'repository-inspection',
      recommendedConfig: {
        port: 3000,
        buildCommand: 'npm install',
        startCommand: 'npm start',
        dockerfilePath: fileList.find((f) => f.toLowerCase() === 'dockerfile') || null,
      },
    };
  }

  // 3. Django check
  const manageFile = fileList.find((f) => f.toLowerCase() === 'manage.py' || f.toLowerCase().endsWith('/manage.py'));
  const reqFile = fileList.find((f) => f.toLowerCase() === 'requirements.txt' || f.toLowerCase().endsWith('/requirements.txt'));
  const reqText = reqFile ? getContent(reqFile) : '';
  const hasDjangoReq = reqText.toLowerCase().includes('django');
  if (manageFile || hasDjangoReq) {
    if (manageFile) evidence.push(manageFile);
    if (reqFile && !evidence.includes(reqFile)) evidence.push(reqFile);
    return {
      technology: 'DJANGO',
      framework: 'Django',
      confidence: 0.95,
      evidence,
      source: 'repository-inspection',
      recommendedConfig: {
        port: 8000,
        buildCommand: reqFile ? 'pip install -r requirements.txt' : 'pip install .',
        startCommand: 'python manage.py runserver 0.0.0.0:8000',
        dockerfilePath: fileList.find((f) => f.toLowerCase() === 'dockerfile') || null,
      },
    };
  }

  // 4. Python (General) check
  const pyprojectFile = fileList.find((f) => f.toLowerCase() === 'pyproject.toml' || f.toLowerCase().endsWith('/pyproject.toml'));
  const setupPyFile = fileList.find((f) => f.toLowerCase() === 'setup.py' || f.toLowerCase().endsWith('/setup.py'));
  if (reqFile || pyprojectFile || setupPyFile) {
    if (reqFile) evidence.push(reqFile);
    if (pyprojectFile) evidence.push(pyprojectFile);
    if (setupPyFile) evidence.push(setupPyFile);
    const isFlask = reqText.toLowerCase().includes('flask');
    return {
      technology: 'PYTHON',
      framework: isFlask ? 'Flask' : 'Python',
      confidence: 0.90,
      evidence,
      source: 'repository-inspection',
      recommendedConfig: {
        port: 8000,
        buildCommand: reqFile ? 'pip install -r requirements.txt' : 'pip install .',
        startCommand: 'python main.py',
        dockerfilePath: fileList.find((f) => f.toLowerCase() === 'dockerfile') || null,
      },
    };
  }

  // 5. Java / Spring Boot check
  const pomFile = fileList.find((f) => f.toLowerCase() === 'pom.xml' || f.toLowerCase().endsWith('/pom.xml'));
  const gradleFile = fileList.find((f) => f.toLowerCase().startsWith('build.gradle') || f.toLowerCase().includes('/build.gradle'));
  if (pomFile || gradleFile) {
    if (pomFile) evidence.push(pomFile);
    if (gradleFile) evidence.push(gradleFile);
    const pomText = pomFile ? getContent(pomFile) : '';
    const gradleText = gradleFile ? getContent(gradleFile) : '';
    const isSpring = pomText.includes('spring') || gradleText.includes('spring');
    return {
      technology: 'JAVA',
      framework: isSpring ? 'Spring Boot' : 'Java',
      confidence: isSpring ? 0.95 : 0.88,
      evidence,
      source: 'repository-inspection',
      recommendedConfig: {
        port: 8080,
        buildCommand: pomFile ? './mvnw clean package' : './gradlew build',
        startCommand: 'java -jar target/*.jar',
        dockerfilePath: fileList.find((f) => f.toLowerCase() === 'dockerfile') || null,
      },
    };
  }

  // 6. Go check
  const goModFile = fileList.find((f) => f.toLowerCase() === 'go.mod' || f.toLowerCase().endsWith('/go.mod'));
  if (goModFile) {
    evidence.push(goModFile);
    const goModText = getContent(goModFile);
    const isGin = goModText.toLowerCase().includes('gin');
    return {
      technology: 'GO',
      framework: isGin ? 'Gin' : 'Go',
      confidence: 0.95,
      evidence,
      source: 'repository-inspection',
      recommendedConfig: {
        port: 8080,
        buildCommand: 'go build -o server .',
        startCommand: './server',
        dockerfilePath: fileList.find((f) => f.toLowerCase() === 'dockerfile') || null,
      },
    };
  }

  // 7. PHP check
  const composerFile = fileList.find((f) => f.toLowerCase() === 'composer.json' || f.toLowerCase().endsWith('/composer.json'));
  if (composerFile) {
    evidence.push(composerFile);
    const compText = getContent(composerFile);
    const isLaravel = compText.toLowerCase().includes('laravel');
    return {
      technology: 'PHP',
      framework: isLaravel ? 'Laravel' : 'PHP',
      confidence: 0.90,
      evidence,
      source: 'repository-inspection',
      recommendedConfig: {
        port: 80,
        buildCommand: 'composer install --no-dev --optimize-autoloader',
        startCommand: 'php -S 0.0.0.0:80',
        dockerfilePath: fileList.find((f) => f.toLowerCase() === 'dockerfile') || null,
      },
    };
  }

  // 8. .NET check
  const csprojFile = fileList.find((f) => f.toLowerCase().endsWith('.csproj'));
  const slnFile = fileList.find((f) => f.toLowerCase().endsWith('.sln'));
  if (csprojFile || slnFile) {
    if (csprojFile) evidence.push(csprojFile);
    if (slnFile) evidence.push(slnFile);
    const projText = csprojFile ? getContent(csprojFile) : '';
    const isAspNetCore = projText.includes('Microsoft.NET.Sdk.Web') || projText.toLowerCase().includes('aspnetcore');
    return {
      technology: 'DOTNET',
      framework: isAspNetCore ? 'ASP.NET Core' : '.NET',
      confidence: 0.90,
      evidence,
      source: 'repository-inspection',
      recommendedConfig: {
        port: 5000,
        buildCommand: 'dotnet build',
        startCommand: 'dotnet run',
        dockerfilePath: fileList.find((f) => f.toLowerCase() === 'dockerfile') || null,
      },
    };
  }

  // 9. Docker check
  const dockerFile = fileList.find((f) => f.toLowerCase() === 'dockerfile' || f.toLowerCase().endsWith('/dockerfile'));
  const composeFile = fileList.find(
    (f) => f.toLowerCase() === 'docker-compose.yml' || f.toLowerCase() === 'docker-compose.yaml' || f.toLowerCase() === 'compose.yaml'
  );
  if (dockerFile || composeFile) {
    if (dockerFile) evidence.push(dockerFile);
    if (composeFile) evidence.push(composeFile);
    return {
      technology: 'DOCKER',
      framework: 'Containerized',
      confidence: 0.90,
      evidence,
      source: 'repository-inspection',
      recommendedConfig: {
        port: 8080,
        buildCommand: 'docker build -t app .',
        startCommand: 'docker run -p 8080:8080 app',
        dockerfilePath: dockerFile || 'Dockerfile',
      },
    };
  }

  // 10. Ambiguous / Unknown repository
  return {
    technology: 'UNKNOWN',
    framework: 'Unknown / Custom',
    confidence: 0.0,
    evidence: [],
    message: 'Manual configuration required: repository file markers could not be automatically detected.',
    note: 'Technology could not be determined automatically from repository file markers. Manual configuration is required.',
    recommendedConfig: {
      port: 8080,
      buildCommand: '',
      startCommand: '',
      dockerfilePath: null,
    },
  };
}

/**
 * Fetches JSON or text from an HTTPS URL with a strict timeout.
 */
function fetchHttp(url, options = {}) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'http:' ? http : https;
      const req = client.request(
        url,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'CloudPort-Technology-Detector/1.0',
            Accept: 'application/json, text/plain, */*',
            ...(options.headers || {}),
          },
          timeout: 4000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', () => resolve({ status: 500, body: null }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 504, body: null });
      });
      req.end();
    } catch (_err) {
      resolve({ status: 400, body: null });
    }
  });
}

/**
 * Inspects a public GitHub repository by querying repository tree and manifests.
 * Never executes repository code.
 *
 * @param {string} repoUrl - e.g. "https://github.com/owner/repo"
 * @returns {Promise<object>} detection result
 */
async function detectTechnologyFromRepo(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') {
    return {
      technology: 'UNKNOWN',
      framework: 'Unknown / Custom',
      confidence: 0.0,
      evidence: [],
      note: 'Invalid repository URL.',
    };
  }

  const cleanUrl = repoUrl.trim();
  const match = cleanUrl.match(/^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(\.git)?$/i);
  if (!match) {
    return {
      technology: 'UNKNOWN',
      framework: 'Unknown / Custom',
      confidence: 0.0,
      evidence: [],
      note: 'Not a recognized GitHub repository HTTPS URL.',
    };
  }

  const owner = match[1];
  const repo = match[2];

  try {
    // 1. Try querying GitHub API contents for root file listing
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const apiRes = await fetchHttp(apiUrl);

    let filenames = [];
    const fileContents = {};

    if (apiRes.status === 200 && apiRes.body) {
      try {
        const items = JSON.parse(apiRes.body);
        if (Array.isArray(items)) {
          filenames = items.map((i) => i.name);
        }
      } catch (_e) {
        // ignore parse error
      }
    }

    // 2. If GitHub API returned files, check if package.json or requirements.txt exists and fetch raw content
    if (filenames.length > 0) {
      if (filenames.some((f) => f.toLowerCase() === 'package.json')) {
        const rawPkg = await fetchHttp(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/package.json`);
        if (rawPkg.status === 200 && rawPkg.body) {
          fileContents['package.json'] = rawPkg.body;
        }
      }
      if (filenames.some((f) => f.toLowerCase() === 'requirements.txt')) {
        const rawReq = await fetchHttp(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/requirements.txt`);
        if (rawReq.status === 200 && rawReq.body) {
          fileContents['requirements.txt'] = rawReq.body;
        }
      }
      if (filenames.some((f) => f.toLowerCase() === 'pom.xml')) {
        const rawPom = await fetchHttp(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/pom.xml`);
        if (rawPom.status === 200 && rawPom.body) {
          fileContents['pom.xml'] = rawPom.body;
        }
      }

      return detectFromFiles(filenames, fileContents);
    }

    // 3. Fallback: Probe known probe files via raw.githubusercontent.com if contents API is unavailable/rate-limited
    const probeFiles = [
      'package.json',
      'requirements.txt',
      'manage.py',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'composer.json',
      'Dockerfile',
    ];

    const probeResults = await Promise.all(
      probeFiles.map(async (f) => {
        const res = await fetchHttp(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${f}`);
        return { file: f, status: res.status, body: res.body };
      })
    );

    const foundFiles = [];
    probeResults.forEach((p) => {
      if (p.status === 200) {
        foundFiles.push(p.file);
        if (p.body) fileContents[p.file] = p.body;
      }
    });

    if (foundFiles.length > 0) {
      return detectFromFiles(foundFiles, fileContents);
    }

    // 4. If nothing detected or network unavailable:
    return {
      technology: 'UNKNOWN',
      framework: 'Unknown / Custom',
      confidence: 0.0,
      evidence: [],
      note: 'Repository file markers could not be automatically detected. Please configure runtime and start command manually.',
      recommendedConfig: {
        port: 8080,
        buildCommand: '',
        startCommand: '',
        dockerfilePath: null,
      },
    };
  } catch (_err) {
    return {
      technology: 'UNKNOWN',
      framework: 'Unknown / Custom',
      confidence: 0.0,
      evidence: [],
      note: 'Network or repository inspection error. Manual configuration required.',
    };
  }
}

const TECHNOLOGY_KEYS = SUPPORTED_TECHNOLOGIES;

module.exports = {
  SUPPORTED_TECHNOLOGIES,
  TECHNOLOGY_KEYS,
  normalizeTechnology,
  detectFromFiles,
  detectTechnologyFromRepo,
};

