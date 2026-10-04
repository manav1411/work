export interface LearningTopic {
  id: string;
  track: string;
  title: string;
  summary: string;
  exercise: string;
  recall: string;
  prerequisites: string;
  resource: string;
  url: string;
  week?: number;
  patterns?: string[];
}

export const TRACKS = [
  {
    id: "dsa",
    title: "DSA & Python",
    description: "Patterns, explanation and repeat practice, at your own pace.",
    accent: "blue",
  },
  {
    id: "backend",
    title: "Backend engineering",
    description: "Build reliable APIs and understand production behaviour.",
    accent: "orange",
  },
  {
    id: "databases",
    title: "Databases",
    description: "Model data, query it and reason about consistency.",
    accent: "pink",
  },
  {
    id: "systems",
    title: "Operating systems & networking",
    description: "Understand what happens beneath an application.",
    accent: "blue",
  },
  {
    id: "testing",
    title: "Testing & debugging",
    description: "Use evidence to find faults and prevent regressions.",
    accent: "lime",
  },
  {
    id: "design",
    title: "System design",
    description: "Discuss scope, tradeoffs and reliability at your level.",
    accent: "orange",
  },
  {
    id: "frontend",
    title: "Frontend fundamentals",
    description: "Make usable, accessible interfaces with clear state.",
    accent: "pink",
  },
  {
    id: "security",
    title: "Security-informed engineering",
    description: "Turn security experience into better software decisions.",
    accent: "lime",
  },
];

const dsa: Array<[string, string, string, string[]]> = [
  [
    "Python for DSA & Binary Search",
    "Use lists, sets, dictionaries and deque; identify the search invariant before writing a loop.",
    "Implement lower_bound and upper_bound in Python. Test empty inputs, one item, duplicates and missing targets.",
    ["arrays-hashing", "binary-search"],
  ],
  [
    "Two Pointers, Sliding Window & Prefix Sums",
    "Use monotonic movement or accumulated totals to avoid repeated work.",
    "Solve a sorted two-sum and longest-substring problem. Explain exactly when each pointer moves.",
    ["two-pointers", "sliding-window"],
  ],
  [
    "Stacks & Queues (+ Monotonic Stack)",
    "Choose a stack for nested structure and a queue for ordered processing; keep only useful candidates.",
    "Solve Valid Parentheses and Daily Temperatures. State the monotonic-stack invariant.",
    ["stack"],
  ],
  [
    "Sorting, Intervals & Recursion",
    "Sorting can expose structure. A recursive function needs a base case and a smaller subproblem.",
    "Merge overlapping intervals and write recursive merge sort. Describe the recursion stack space.",
    ["intervals"],
  ],
  [
    "Linked Lists & Trees (DFS)",
    "Track pointer ownership carefully and use depth-first traversal to combine child results.",
    "Reverse a linked list and calculate tree depth recursively and iteratively.",
    ["linked-list", "trees"],
  ],
  [
    "Trees (BFS/BST) & Heaps",
    "Use breadth-first traversal for layers and a heap when only the next highest-priority element matters.",
    "Implement level-order traversal and maintain the k largest elements with a heap.",
    ["trees", "heap-priority-queue"],
  ],
  [
    "Graphs I (Traversal)",
    "Make vertices, edges and visited state explicit. Distinguish traversal from shortest paths.",
    "Count islands with BFS and DFS. Explain why marking visited at enqueue prevents duplicate work.",
    ["graphs"],
  ],
  [
    "Backtracking & Divide-and-Conquer",
    "Explore candidate choices while restoring state. Prune only when you can justify it.",
    "Generate subsets and permutations. Draw a small recursion tree and identify duplicated states.",
    ["backtracking"],
  ],
  [
    "Greedy & Graphs II",
    "A greedy choice needs justification; graph ordering and weighted edges change the algorithm.",
    "Solve Jump Game and Course Schedule. Explain a counterexample to an incorrect greedy approach.",
    ["greedy", "graphs", "advanced-graphs"],
  ],
  [
    "Dynamic Programming (1D & 2D)",
    "Define state, recurrence, base cases and evaluation order before optimising storage.",
    "Solve Coin Change and Longest Common Subsequence. Compare memoisation and tabulation.",
    ["one-d-dp", "two-d-dp"],
  ],
  [
    "Advanced",
    "Choose targeted advanced topics based on gaps instead of treating every hard problem as mandatory.",
    "Implement a trie and explain a union-find example; choose one hard problem and document what made it hard.",
    ["tries", "bit-manipulation", "math-geometry", "advanced-graphs"],
  ],
  [
    "Mixed & Timed Drills",
    "Practise selecting a pattern from the problem statement and explaining under time pressure.",
    "Run a 45-minute mock with two unfamiliar problems. Log clarification, approach, complexity and reflection.",
    [],
  ],
];

export const LEARNING_TOPICS: LearningTopic[] = [
  ...dsa.map(([title, summary, exercise, patterns], i) => ({
    id: `dsa-week-${i + 1}`,
    track: "dsa",
    title,
    summary,
    exercise,
    patterns,
    week: i + 1,
    recall:
      "Explain the invariant, complexity and one edge case without reading your solution.",
    prerequisites: i
      ? `Review week ${i} and any relevant gaps; every week remains accessible.`
      : "Basic programming familiarity.",
    resource: "Python tutorial + standard library",
    url: "https://docs.python.org/3/tutorial/",
  })),
  {
    id: "backend-http",
    track: "backend",
    title: "HTTP APIs and failure behaviour",
    summary:
      "Design resources, status codes and validation around observable client behaviour. An API must handle duplicate requests, timeouts and partial failure.",
    exercise:
      "Build a small task API with validation, pagination and idempotent creation. Document success and error responses.",
    recall:
      "What can happen when a client retries after a timeout? Which operations are safe to retry?",
    prerequisites: "Basic programming and JSON.",
    resource: "MDN HTTP guide",
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP",
  },
  {
    id: "backend-observability",
    track: "backend",
    title: "Production ownership and observability",
    summary:
      "Use structured logs, useful metrics and traces to follow a request and distinguish symptoms from causes.",
    exercise:
      "Instrument an API with request IDs and latency/error metrics. Trigger one fault and write a short investigation.",
    recall:
      "Which signal would tell you users are affected? How would you narrow the cause?",
    prerequisites: "A small service you can run.",
    resource: "Google SRE book",
    url: "https://sre.google/sre-book/table-of-contents/",
  },
  {
    id: "db-sql",
    track: "databases",
    title: "Schema design and SQL",
    summary:
      "Model entities and constraints first. Query joins and aggregates against real examples rather than memorising syntax.",
    exercise:
      "Model companies, applications and contacts. Write a join, an aggregate and a query for overdue follow-ups.",
    recall:
      "Which relationships are one-to-many? Which invariant belongs in the database?",
    prerequisites: "Basic data structures.",
    resource: "PostgreSQL tutorial",
    url: "https://www.postgresql.org/docs/current/tutorial.html",
  },
  {
    id: "db-transactions",
    track: "databases",
    title: "Transactions, indexes and query plans",
    summary:
      "Transactions preserve invariants; indexes trade write cost and storage for lookup speed. Inspect a plan before guessing.",
    exercise:
      "Demonstrate two concurrent updates to a counter. Add an index and compare EXPLAIN output for a representative query.",
    recall:
      "How could a lost update occur? Why might an index not help this query?",
    prerequisites: "SQL basics and a runnable database.",
    resource: "PostgreSQL concurrency control",
    url: "https://www.postgresql.org/docs/current/mvcc.html",
  },
  {
    id: "systems-network",
    track: "systems",
    title: "A request from DNS to HTTP",
    summary:
      "Connect DNS resolution, transport, TLS and HTTP to the latency and failures you observe in an application.",
    exercise:
      "Inspect a browser request waterfall and curl response. Draw the request path and identify cache boundaries.",
    recall:
      "What does a DNS failure look like compared with an HTTP 500? Where can a request time out?",
    prerequisites: "A browser and command line.",
    resource: "MDN how the web works",
    url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works",
  },
  {
    id: "systems-concurrency",
    track: "systems",
    title: "Processes, threads and concurrency",
    summary:
      "Distinguish concurrent work from parallel execution. Shared state, blocking I/O and scheduling shape correctness.",
    exercise:
      "Write a program with two workers updating shared state. Reproduce a race and fix it with an appropriate ownership model.",
    recall: "When does asynchronous I/O help? What does a lock protect?",
    prerequisites: "Basic programming and functions.",
    resource: "Python concurrency documentation",
    url: "https://docs.python.org/3/library/concurrency.html",
  },
  {
    id: "testing-strategy",
    track: "testing",
    title: "Tests that protect behaviour",
    summary:
      "Choose unit, integration and end-to-end tests based on the failure you need to catch. Assert behaviour at the right boundary.",
    exercise:
      "For a login or API flow, write a happy-path test, an ownership test and a meaningful failure test. Explain why each is needed.",
    recall:
      "What would still fail despite these tests passing? Which test catches a database integration error?",
    prerequisites: "A small working application.",
    resource: "Playwright testing guidance",
    url: "https://playwright.dev/docs/best-practices",
  },
  {
    id: "testing-debug",
    track: "testing",
    title: "Evidence-led debugging",
    summary:
      "Reproduce, minimise, form a hypothesis, test it and verify the fix. Keep observations separate from assumptions.",
    exercise:
      "Choose a real bug. Record a minimal reproduction, two hypotheses, decisive evidence and a regression check.",
    recall:
      "What observation disproved your first theory? How do you know the fix addresses the cause?",
    prerequisites: "A reproducible bug or synthetic failing example.",
    resource: "Chrome DevTools documentation",
    url: "https://developer.chrome.com/docs/devtools/",
  },
  {
    id: "design-small",
    track: "design",
    title: "Design a small service",
    summary:
      "Start with requirements, workload and failure assumptions. Explain an API, data model and one or two tradeoffs clearly.",
    exercise:
      "Design a URL shortener or notification service. Specify APIs, storage, a request sequence and two failure scenarios.",
    recall:
      "Which requirement drove your design? What would you change if traffic grew tenfold?",
    prerequisites: "APIs, databases and basic networking.",
    resource: "Google SRE distributed systems",
    url: "https://sre.google/sre-book/table-of-contents/",
  },
  {
    id: "design-reliability",
    track: "design",
    title: "Caching, queues and reliability",
    summary:
      "Caches introduce staleness and queues introduce delivery semantics. Name these costs before adding infrastructure.",
    exercise:
      "Extend your service with a cache or queue. Document expiry, retries, duplicate processing and monitoring.",
    recall:
      "Can this message be delivered twice? What happens if the cache is stale or unavailable?",
    prerequisites: "A small service design.",
    resource: "AWS Builders Library",
    url: "https://aws.amazon.com/builders-library/",
  },
  {
    id: "frontend-web",
    track: "frontend",
    title: "Accessible HTML, layout and forms",
    summary:
      "Semantic elements, clear labels and keyboard navigation make a UI robust. Layout must work across viewport sizes.",
    exercise:
      "Build a responsive application form with validation, accessible errors and keyboard-only completion.",
    recall:
      "Can a user understand an error without colour? Where does focus move after submission?",
    prerequisites: "Basic HTML/CSS familiarity.",
    resource: "MDN learning web development",
    url: "https://developer.mozilla.org/en-US/docs/Learn_web_development",
  },
  {
    id: "frontend-state",
    track: "frontend",
    title: "State, effects and asynchronous UI",
    summary:
      "Give each state a clear owner and represent loading, empty, failed and successful results explicitly.",
    exercise:
      "Build a searchable list with URL filters, cancellation or stale-response protection and a recoverable edit form.",
    recall:
      "Which state is derived? What happens if responses arrive out of order?",
    prerequisites: "JavaScript and basic components.",
    resource: "React learn",
    url: "https://react.dev/learn",
  },
  {
    id: "security-threat",
    track: "security",
    title: "Threat modelling and trust boundaries",
    summary:
      "Identify assets, actors and trust boundaries. Prioritise realistic abuse paths rather than a generic list of threats.",
    exercise:
      "Threat-model a private notes app. Trace authentication, ownership checks, uploads and export; choose three mitigations.",
    recall:
      "Where is untrusted input handled? Can one account request another account’s record?",
    prerequisites: "A basic application architecture.",
    resource: "OWASP threat modeling",
    url: "https://owasp.org/www-community/Threat_Modeling",
  },
  {
    id: "security-app",
    track: "security",
    title: "Authentication, authorisation and secure delivery",
    summary:
      "Authentication identifies a user; authorisation checks each operation. Review dependencies, secrets and safe defaults.",
    exercise:
      "Test object ownership, session expiry and malicious upload names. Record how secrets enter your deployment.",
    recall:
      "Does every data access enforce ownership? What should appear in logs after an auth failure?",
    prerequisites: "HTTP APIs and a small application.",
    resource: "OWASP Top 10",
    url: "https://owasp.org/projects/top-ten",
  },
];

export const CURATED_RESOURCES = [
  {
    id: "python",
    title: "Python tutorial & standard library",
    category: "DSA",
    url: "https://docs.python.org/3/tutorial/",
    body: "Learn the Python features you actually use in problem solving; connect each section to a small exercise.",
  },
  {
    id: "leetcode",
    title: "LeetCode problems",
    category: "DSA",
    url: "https://leetcode.com/problemset/",
    body: "Practise patterns from the roadmap and keep your own explanations and review notes.",
  },
  {
    id: "mdn",
    title: "MDN web development curriculum",
    category: "Frontend",
    url: "https://developer.mozilla.org/en-US/docs/Learn_web_development",
    body: "HTML, CSS, JavaScript, accessibility and browser fundamentals with practical exercises.",
  },
  {
    id: "react",
    title: "React learning documentation",
    category: "Frontend",
    url: "https://react.dev/learn",
    body: "Components, state, effects and reusable patterns. Build a small feature after reading a section.",
  },
  {
    id: "postgres",
    title: "PostgreSQL tutorial",
    category: "Databases",
    url: "https://www.postgresql.org/docs/current/tutorial.html",
    body: "Schema, SQL and relational concepts; use a real toy dataset and inspect your queries.",
  },
  {
    id: "sre",
    title: "Google Site Reliability Engineering",
    category: "System design",
    url: "https://sre.google/sre-book/table-of-contents/",
    body: "Reliability, monitoring and production engineering. Choose chapters relevant to a service you know.",
  },
  {
    id: "builders",
    title: "AWS Builders Library",
    category: "Backend",
    url: "https://aws.amazon.com/builders-library/",
    body: "Engineering tradeoffs in distributed systems, including retries, timeouts and reliability.",
  },
  {
    id: "owasp",
    title: "OWASP Top 10",
    category: "Security",
    url: "https://owasp.org/projects/top-ten",
    body: "Use as a starting point for application risk review; record concrete mitigations in your own code.",
  },
  {
    id: "playwright",
    title: "Playwright testing best practices",
    category: "Testing",
    url: "https://playwright.dev/docs/best-practices",
    body: "Reliable browser tests that assert user-visible behaviour and isolate state.",
  },
  {
    id: "devtools",
    title: "Chrome DevTools documentation",
    category: "Testing",
    url: "https://developer.chrome.com/docs/devtools/",
    body: "Investigate performance, requests, accessibility and browser behaviour with actual evidence.",
  },
  {
    id: "google-careers",
    title: "Google Careers",
    category: "Job search",
    url: "https://www.google.com/about/careers/applications/",
    body: "Search current roles and employer-provided application information. Save each role’s requirements and date checked.",
  },
  {
    id: "microsoft-careers",
    title: "Microsoft Careers",
    category: "Job search",
    url: "https://careers.microsoft.com/",
    body: "Search current SWE roles and locations; verify requirements from each vacancy.",
  },
  {
    id: "amazon-careers",
    title: "Amazon Jobs",
    category: "Job search",
    url: "https://www.amazon.jobs/",
    body: "Search roles and consult employer interview preparation information for the actual role.",
  },
  {
    id: "uscis",
    title: "USCIS working in the United States",
    category: "Relocation research",
    url: "https://www.uscis.gov/working-in-the-united-states",
    body: "Official starting point for work-authorisation research. Record your circumstances and seek qualified advice where needed; no eligibility is assumed.",
  },
  {
    id: "github",
    title: "GitHub profile documentation",
    category: "Career assets",
    url: "https://docs.github.com/en/account-and-profile",
    body: "Update your profile and pin relevant projects with clear READMEs, demonstrations and your contribution.",
  },
  {
    id: "overleaf",
    title: "Overleaf documentation",
    category: "Career assets",
    url: "https://www.overleaf.com/learn",
    body: "Keep your LaTeX workflow and link source projects to exact PDF versions in Assets.",
  },
];
