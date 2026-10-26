// A Playwright reporter that fails the run when any test was skipped: the
// e2e counterpart of scripts/no-skips.sh, which does the same for go test.
// test.skip(), test.fixme() and a test that never ran because an earlier
// one in a serial group failed all end as "skipped", and none of them
// proved anything, so none may pass as green.
import type {
  FullResult,
  Reporter,
  Suite,
  TestCase,
} from "@playwright/test/reporter";

export default class NoSkipsReporter implements Reporter {
  private root: Suite | undefined;

  onBegin(_config: unknown, suite: Suite): void {
    this.root = suite;
  }

  printsToStdio(): boolean {
    // The list reporter prints the results; this one adds a line at the end.
    return false;
  }

  // Async because Playwright only reads a status override from a promise.
  // eslint-disable-next-line @typescript-eslint/require-await
  async onEnd(
    result: FullResult,
  ): Promise<{ status: FullResult["status"] } | undefined> {
    const tests: TestCase[] = this.root?.allTests() ?? [];
    const skipped = tests.filter((test) => test.outcome() === "skipped");
    if (skipped.length > 0) {
      console.log("no-skips: these tests were skipped, so the gate fails:");
      for (const test of skipped) {
        console.log(`  ${test.titlePath().filter(Boolean).join(" › ")}`);
      }
      return { status: "failed" };
    }
    if (result.status === "passed") {
      console.log(
        `no-skips: ok, no test was skipped (${tests.length} tests ran)`,
      );
    }
    return undefined;
  }
}
