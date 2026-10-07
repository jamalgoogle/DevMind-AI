// All static UI data lives on the server and is served via GET /api/bootstrap.
module.exports = {
  app: {
    title: 'DevMind AI - Pure Software Helper Workbench',
    name: 'DevMind AI',
    badge: 'Software Copilot',
    version: '2.4.0',
    status: 'Copilot Ready'
  },
  welcome: {
    title: 'Pure Software Engineering AI Assistant',
    text: 'Refactor code, design scalable architectures, generate unit tests, analyze stack traces, or write complete modules instantly.'
  },
  personas: [
    { id: 'fullstack', label: '⚡ Full-Stack Developer', prompt: 'Act as a pragmatic full-stack developer. Favor working, end-to-end solutions.' },
    { id: 'architect', label: '🏛️ Software Architect', prompt: 'Act as a software architect. Focus on scalability, trade-offs and system boundaries.' },
    { id: 'secops', label: '🛡️ Security & SecOps Lead', prompt: 'Act as a security lead. Threat-model first, reference OWASP, and give hardened code.' },
    { id: 'clean', label: '🧹 Clean Code Guru', prompt: 'Act as a clean-code mentor. Prioritize readability, naming, small functions and tests.' }
  ],
  defaultPersona: 'fullstack',
  starters: [
    { label: '⚡ Python Redis Worker Queue', prompt: 'How do I build an async worker queue in Python using Redis and Celery?' },
    { label: '🛡️ TS SQL Injection Prevention', prompt: 'Explain how to prevent SQL Injection in TypeScript ORM models with parameterized queries.' },
    { label: '⚛️ React WebSocket Hook', prompt: 'Write a modern React custom hook for handling WebSocket real-time updates with automatic reconnect.' }
  ],
  utilities: [
    { id: 'refactor', label: 'Refactor & Optimize', icon: 'fa-solid fa-wand-magic-sparkles text-brand-600', prompt: 'Please refactor the code in studio editor for optimal readability and performance.' },
    { id: 'unittest', label: 'Generate Unit Tests', icon: 'fa-solid fa-vial-circle-check text-emerald-600', prompt: 'Write a complete unit test suite for the studio code.' },
    { id: 'debug', label: 'Debug Stack Trace', icon: 'fa-solid fa-bug text-rose-500', prompt: 'Debug potential memory leaks or stack trace issues in this implementation.' },
    { id: 'docker', label: 'Generate Docker/DevOps', icon: 'fa-brands fa-docker text-sky-600', prompt: 'Generate a production multi-stage Dockerfile and docker-compose setup.' },
    { id: 'sql', label: 'SQL Query & Indexing', icon: 'fa-solid fa-database text-amber-600', prompt: 'Write an optimized SQL query schema with indexing strategy for dynamic lookups.' }
  ],
  snippetTags: [
    { tag: 'REFACTOR', label: '⚡ Refactor Mode' },
    { tag: 'EXPLAIN', label: '💡 Explain Step-by-Step' },
    { tag: 'TESTS', label: '🧪 Write Tests' }
  ],
  languages: [
    { id: 'javascript', label: 'JavaScript / Node' },
    { id: 'python', label: 'Python 3' },
    { id: 'typescript', label: 'TypeScript' },
    { id: 'html', label: 'HTML & Tailwind' },
    { id: 'sql', label: 'SQL Query' }
  ],
  engines: [
    { id: 'js-v8', label: 'Node.js (V8) runtime on server' },
    { id: 'py-pyodide', label: 'Python 3 runtime on server' }
  ],
  studio: {
    defaultCode:
      "// Welcome to DevMind Code Studio\nfunction analyzePerformance(items) {\n    const start = performance.now();\n    const filtered = items.filter(x => x % 2 === 0).map(x => x * 2);\n    const duration = performance.now() - start;\n    return { count: filtered.length, durationMs: duration.toFixed(4) };\n}\n\nconst mockData = Array.from({length: 1000}, (_, i) => i);\nconsole.log(analyzePerformance(mockData));",
    analyzePrompt: 'Analyze this code snippet for time complexity, memory usage, and potential bugs:'
  },
  defaultSettings: {
    systemPrompt:
      'You are DevMind AI, an elite software engineering assistant. Produce high-quality, production-grade code, detailed inline comments, optimal time/space complexity analysis, and strict security practices.',
    temperature: 0.2,
    engine: 'js-v8',
    theme: 'light',
    persona: 'fullstack'
  }
};
