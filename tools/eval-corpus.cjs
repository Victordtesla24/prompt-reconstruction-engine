'use strict';
/** Fixed evaluation corpus — coding + non-coding tasks for precision and model evals. */
module.exports = {
  coding: [
    { id: 'code-simple-edit', raw: '1. Add a retry wrapper around fetch calls in api/client.ts with exponential backoff.\n2. Log each retry attempt with the request ID.\n- Must not retry on 4xx responses.' },
    { id: 'code-multi-file', raw: '1. Add a /health endpoint returning JSON status.\n2. Wire it into the Express router and add an integration test.\n3. Update the README with curl examples.\n- Use TypeScript only.\n- Must not expose internal stack traces.' },
    { id: 'code-debug', raw: '1. Fix the flaky test in payments.test.ts that fails on CI.\n2. Add a regression test proving the race is gone.\n- Never disable the test instead of fixing it.' },
    { id: 'code-ui', raw: '1. Build a responsive settings panel with dark mode toggle.\n2. Match existing gold/glass aesthetic.\n- Must meet WCAG AA contrast.\n- Do not break keyboard navigation.' },
    { id: 'code-deploy', raw: '1. Add a GitHub Actions workflow that runs npm test and deploys to Firebase Hosting on main.\n2. Fail the job if lint or tests fail.\n- Must not commit secrets to the repo.' }
  ],
  nonCoding: [
    { id: 'write-summary', raw: 'Incident report: checkout latency rose from 220ms to 4.8s between 09:10 and 09:42 UTC after cache nodes in us-east were evicted by a misconfigured deploy. 18% of checkout attempts timed out; no payment data was lost. Remediation completed: rolled back cache config, warmed cache, added deploy guard.\n1. Summarize the incident report into executive bullets.\n2. Include root cause, impact, and remediation.\n- Must not speculate beyond the evidence.' },
    { id: 'analysis-compare', raw: 'Vendor proposals: Alpha costs $42k/year, ships in 4 weeks, low integration risk, limited analytics. Beta costs $30k/year, ships in 10 weeks, medium integration risk, strong analytics. Gamma costs $55k/year, ships in 6 weeks, high integration risk, best compliance package.\n1. Compare the three vendor proposals on cost, risk, and time-to-value.\n2. Recommend one option with explicit trade-offs.\n- Never use vague language like "probably better".' },
    { id: 'transform-data', raw: 'CSV export:\nid,email,total\n1,ada@example.com,42.50\n2,,18.00\n3,lin@example.com,not-a-number\n1,duplicate@example.com,20.00\n1. Convert the CSV export into a normalized JSON schema.\n2. Validate every row and list invalid records separately.\n- Must not drop rows silently.' }
  ],
  browser: {
    productionUrl: 'https://prompt-reconstruction-engine.web.app/?final=1782434252',
    localFile: 'file://' + require('path').resolve(__dirname, '../public/index.html'),
    sampleRaw: '1. Build a rate limiter for the payments API.\n2. Add structured logging with request IDs.\n- The service must not log secrets.'
  }
};
