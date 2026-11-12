"""从 GitHub 事件和 Git 差异选择原生检查，不读取服务端配置。"""

import json
import os
from pathlib import Path
import re
import subprocess


def platforms(paths):
    common = any(path.startswith(("contracts/native-bootstrap/", "contracts/ui-parity/", "scripts/native/", "IM-APP-server/")) or path == ".github/workflows/native-checks.yml" for path in paths)
    return {
        "android": common or any(path.startswith("IM-APP-android/") for path in paths),
        "ios": common or any(path.startswith("IM-APP-ios/") for path in paths),
    }


def main():
    if os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        selection = {"android": True, "ios": True}
    else:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
        pr = event["pull_request"]
        refs = [pr["base"]["sha"], pr["head"]["sha"]]
        if not all(re.fullmatch(r"[0-9a-f]{40,64}", ref) for ref in refs):
            raise ValueError("Invalid pull request revision")
        paths = subprocess.check_output(["git", "diff", "--name-only", *refs, "--"], text=True).splitlines()
        selection = platforms(paths)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        for key, value in selection.items():
            output.write(f"{key}={str(value).lower()}\n")
    print(json.dumps(selection))


if __name__ == "__main__":
    main()
