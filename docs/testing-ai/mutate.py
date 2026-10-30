#!/usr/bin/env python3
"""Run mutants: each spec breaks one line of production code, runs the
given test files, and restores the file with git checkout.
usage: python3 docs/testing-ai/mutate.py specs.json   (run inside the repository)
         (list of {label, pkg, file, old, new, tests})
"""
import json, subprocess, sys, os
ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
specs = json.load(open(sys.argv[1]))
env = dict(os.environ)
results = []
for s in specs:
    path = os.path.join(ROOT, s["pkg"], s["file"])
    src = open(path).read()
    n = src.count(s["old"])
    if n != 1:
        print(f"SKIP {s['label']}: old occurs {n} times"); results.append((s['label'],'SKIP')); continue
    open(path, "w").write(src.replace(s["old"], s["new"]))
    try:
        # The exit code decides: a crashed worker (an infinite redirect,
        # say) prints no "failed" line but still exits non-zero.
        cmd = f"source ~/.nvm/nvm.sh >/dev/null; nvm use 24 >/dev/null; cd {os.path.join(ROOT, s['pkg'])} && npx vitest run {' '.join(s['tests'])} >/dev/null 2>&1"
        try:
            code = subprocess.run(["bash", "-c", cmd], timeout=300).returncode
        except subprocess.TimeoutExpired:
            code = 124
        status = "KILLED" if code != 0 else "SURVIVED"
    finally:
        subprocess.run(["git", "-C", ROOT, "checkout", "--", os.path.join(s["pkg"], s["file"])], check=True)
    print(f"{status} {s['label']}")
    results.append((s['label'], status))
# production must be byte-identical
d = subprocess.run(["bash","-c", f"cd {ROOT} && git diff --stat -- ':!*.test.ts' ':!*.test.tsx' ':!apps/admin/src/test' ':!apps/admin/src/vitest.setup.ts' ':!apps/admin/vite.config.ts' ':!apps/admin/package.json' ':!pnpm-lock.yaml' ':!pnpm-workspace.yaml'"], capture_output=True, text=True).stdout
print("PRODUCTION DIFF:", d.strip() or "none")
