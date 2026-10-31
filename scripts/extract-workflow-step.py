#!/usr/bin/env python3
"""Print the body of one workflow step, so it can be run locally.

The two workflow steps that guard the release path are the ones that can rot
silently: a broken tag gate only shows up when someone pushes a tag, which is
exactly when a failure is most expensive. This script exists so the same body
GitHub runs can be executed on a laptop:

    python scripts/extract-workflow-step.py .github/workflows/release.yml "Publish release assets"

Pass --local to also rewrite the GitHub expressions into shell variables, so
the body runs under bash without GitHub in the picture. The rewrite is
deliberately narrow: an expression whose last path segment is "tarball"
becomes the TARBALL environment variable. Anything else is left alone,
because guessing wrong would hide the very error the body is meant to expose.

Exit code is 1 when the workflow file or the step name is not found, so a typo
in a test cannot silently produce an empty script that "passes".
"""
import re
import sys

import yaml

EXPRESSION = re.compile(r"\$\{\{\s*([^}]+?)\s*\}\}")
DOLLAR = chr(36)


def localise(body):
    """Rewrite the expressions a local run cannot resolve.

    Only the tarball path is used by the release steps before any gh call, and
    it is already the step's own output variable, so mapping it to TARBALL is
    faithful. Everything else stays verbatim and fails loudly.
    """
    def replace(match):
        path = match.group(1).strip()
        last = path.rsplit(".", 1)[-1]
        if last == "tarball":
            return DOLLAR + "{TARBALL:-}"
        return match.group(0)

    return EXPRESSION.sub(replace, body)


def main(argv):
    local = "--local" in argv[1:]
    args = [a for a in argv[1:] if a != "--local"]
    if len(args) != 2:
        sys.stderr.write("usage: extract-workflow-step.py [--local] <workflow.yml> <step name>\n")
        return 2
    path, wanted = args
    with open(path, "r", encoding="utf-8") as handle:
        docs = list(yaml.safe_load_all(handle))
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        for job in (doc.get("jobs") or {}).values():
            for step in job.get("steps") or []:
                if step.get("name") == wanted:
                    body = step.get("run")
                    if not body:
                        sys.stderr.write("step %r has no run: body\n" % wanted)
                        return 1
                    if local:
                        body = localise(body)
                    sys.stdout.write(body)
                    if not body.endswith("\n"):
                        sys.stdout.write("\n")
                    return 0
    sys.stderr.write("no step named %r in %s\n" % (wanted, path))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
