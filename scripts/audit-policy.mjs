import { spawnSync } from 'node:child_process';

const REVIEW_EXPIRES_ON = '2026-10-01';
const ACCEPTED_ADVISORY_URL = 'https://github.com/advisories/GHSA-jmr9-qjv8-65gv';
const ACCEPTED_HIGH_FINDINGS = new Set([
  '@gajae-code/coding-agent',
  '@puppeteer/browsers',
  'extract-zip',
  'puppeteer-core',
]);

function fail(message) {
  console.error(`Audit policy failed: ${message}`);
  process.exitCode = 1;
}

function findingReferences(finding) {
  return finding.via.map((entry) => (typeof entry === 'string' ? entry : entry.url));
}

function hasOnlyReferences(finding, expected) {
  const actual = new Set(findingReferences(finding));
  return actual.size === expected.size && [...expected].every((entry) => actual.has(entry));
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const audit = spawnSync(npm, ['audit', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

if (audit.error) {
  fail(`could not run npm audit: ${audit.error.message}`);
} else if (![0, 1].includes(audit.status)) {
  fail(`npm audit exited with status ${audit.status}`);
} else {
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    fail('npm audit did not produce valid JSON');
  }

  if (report?.auditReportVersion !== 2 || !report.vulnerabilities) {
    fail('npm audit JSON does not contain an audit report version 2 vulnerability list');
  } else {
    const findings = Object.entries(report.vulnerabilities);
    for (const [name, finding] of findings) {
      console.log(`${finding.severity}: ${name} (${findingReferences(finding).join(', ')})`);
    }

    const today = new Date().toISOString().slice(0, 10);
    if (today > REVIEW_EXPIRES_ON) {
      fail(`the accepted extract-zip finding expired on ${REVIEW_EXPIRES_ON}`);
    }

    const highOrCritical = findings.filter(([, finding]) => (
      finding.severity === 'high' || finding.severity === 'critical'
    ));
    const unexpected = highOrCritical.filter(([name, finding]) => (
      finding.severity !== 'high' || !ACCEPTED_HIGH_FINDINGS.has(name)
    ));

    const extractZip = report.vulnerabilities['extract-zip'];
    const browsers = report.vulnerabilities['@puppeteer/browsers'];
    const puppeteerCore = report.vulnerabilities['puppeteer-core'];
    const codingAgent = report.vulnerabilities['@gajae-code/coding-agent'];
    const acceptedChainMatches = highOrCritical.length === ACCEPTED_HIGH_FINDINGS.size
      && ACCEPTED_HIGH_FINDINGS.size === new Set(highOrCritical.map(([name]) => name)).size
      && [...ACCEPTED_HIGH_FINDINGS].every((name) => report.vulnerabilities[name]?.severity === 'high')
      && extractZip.fixAvailable === false
      && browsers.fixAvailable === false
      && codingAgent.fixAvailable === false
      && hasOnlyReferences(extractZip, new Set([ACCEPTED_ADVISORY_URL]))
      && hasOnlyReferences(browsers, new Set(['extract-zip']))
      && hasOnlyReferences(puppeteerCore, new Set(['@puppeteer/browsers']))
      && hasOnlyReferences(codingAgent, new Set(['@puppeteer/browsers', 'puppeteer-core']));

    if (unexpected.length > 0 || !acceptedChainMatches) {
      const names = unexpected.map(([name]) => name);
      if (!acceptedChainMatches) names.push('accepted extract-zip chain changed');
      fail(`unexpected high/critical finding: ${names.join(', ')}`);
    } else {
      console.log(
        `Accepted until ${REVIEW_EXPIRES_ON}: ${ACCEPTED_ADVISORY_URL} through @gajae-code/coding-agent -> @puppeteer/browsers -> extract-zip.`,
      );
    }
  }
}
