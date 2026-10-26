// Self-test of support/no-skips-reporter.ts, run before the suite by
// `test:e2e` (like `scripts/no-skips.sh --self-test` before go test): a
// gate that cannot fail is no gate. Node runs this file directly.
import { spawnSync } from "node:child_process";

interface Case {
  name: string;
  env: Record<string, string>;
  exit: number;
  output: string;
}

const cases: Case[] = [
  { name: "all pass", env: {}, exit: 0, output: "no-skips: ok" },
  {
    name: "test.skip",
    env: { SELFTEST_SKIP: "1" },
    exit: 1,
    output: "sample.spec.ts › skips when SELFTEST_SKIP is set",
  },
  {
    name: "test.fixme",
    env: { SELFTEST_FIXME: "1" },
    exit: 1,
    output: "sample.spec.ts › is fixme when SELFTEST_FIXME is set",
  },
  {
    name: "a failure",
    env: { SELFTEST_FAIL: "1" },
    exit: 1,
    output: "1 failed",
  },
];

let failed = false;
for (const c of cases) {
  const run = spawnSync(
    "playwright",
    ["test", "--config", "selftest/playwright.config.ts"],
    {
      encoding: "utf8",
      env: { ...process.env, ...c.env, FORCE_COLOR: "0" },
    },
  );
  const output = `${run.stdout}${run.stderr}`;
  if (run.status !== c.exit || !output.includes(c.output)) {
    failed = true;
    console.error(
      `no-skips self-test [${c.name}]: want exit ${c.exit} and "${c.output}", ` +
        `got exit ${String(run.status)}\n${output}`,
    );
  }
}
if (failed) process.exit(1);
console.log(
  "no-skips self-test: ok (pass, test.skip, test.fixme and failure detected)",
);
